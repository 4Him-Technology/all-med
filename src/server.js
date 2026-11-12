// Servidor local do PC: a tela, a prospecção na base de CNPJ (Postgres do Docker) e as buscas no Google Maps.
// O CRM (leads, kanban, histórico) não passa por aqui: o navegador fala direto com o Supabase.
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { createPoller } from './scraper.js'
import { cabecalhosSeguranca } from './seguranca.js'
import { NotFoundError, ValidationError, validarBusca } from './store.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMITE_CORPO = 1_000_000
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' }

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function corpo(req) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Envie JSON (content-type: application/json)')
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > LIMITE_CORPO) throw new HttpError(413, 'Corpo da requisição muito grande')
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new ValidationError('JSON inválido')
  }
}

const uuid = (id) => {
  if (!UUID.test(id)) throw new NotFoundError('recurso não encontrado')
  return id
}

const LOCAIS = new Set(['localhost', '127.0.0.1'])
const NOME_TELA = { prospeccao: 'Prospecção', buscas: 'Google Maps' }
const PREFLIGHT = { 'access-control-allow-methods': 'GET, POST, PATCH, DELETE', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' }

// config: { supabaseUrl, supabaseKey, urlWeb } (só a chave pública; ver validarConfigSupabase)
// autenticar: (token) => usuário ou null; com ele, toda chamada da API exige o login do CRM (é o que deixa abrir o PC pelo túnel)
// origensWeb: endereços do site na internet que podem chamar a API do PC (CORS)
export function createApp({ store, scraper, cnpj, publicDir, log, config = null, hostsPermitidos = ['localhost', '127.0.0.1'], autenticar = null, origensWeb = [], limite = { max: 300, janelaMs: 60_000 } }) {
  const poller = createPoller({ store, scraper, log })
  const seguranca = cabecalhosSeguranca(config?.supabaseUrl)
  const configJs = `export default ${JSON.stringify({ ...config, local: true })}\n`

  // janela fixa por endereço; quem chega pelo túnel traz o IP de verdade em cf-connecting-ip
  const chamadas = new Map()
  function excedeu(req) {
    const ip = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress)
    const agora = Date.now()
    const c = chamadas.get(ip)
    if (c && c.inicio + limite.janelaMs > agora) return ++c.n > limite.max
    if (chamadas.size >= 10_000) chamadas.clear()
    chamadas.set(ip, { inicio: agora, n: 1 })
    return false
  }

  const rotas = [
    ['GET', /^\/api\/buscas$/, (_req, url) => [200, store.listBuscas(Object.fromEntries(url.searchParams))]],
    [
      'POST',
      /^\/api\/buscas$/,
      async (req) => {
        const busca = validarBusca(await corpo(req))
        let jobId
        try {
          jobId = await scraper.criarJob(busca)
        } catch (err) {
          log.error(`falha ao criar job no scraper: ${err.message}`)
          return [502, { erro: 'Não consegui falar com o scraper. Confira se ele está rodando (docker compose --profile maps up -d).' }]
        }
        return [201, store.createBusca(busca, jobId)]
      },
    ],
    ['GET', /^\/api\/buscas\/([^/]+)\/leads$/, (_req, _url, id) => [200, store.leadsDaBusca(uuid(id))]],
    ['PATCH', /^\/api\/buscas\/([^/]+)$/, async (req, _url, id) => [200, store.marcarEnviados(uuid(id), await corpo(req))]],
    ['DELETE', /^\/api\/buscas\/([^/]+)$/, (_req, _url, id) => (store.removerBusca(uuid(id)), [204])],
    [
      'POST',
      /^\/api\/rpc\/([a-z_]+)$/,
      async (req, _url, nome) => {
        if (!cnpj) return [503, { erro: 'Base de CNPJ não configurada. Defina CNPJ_DATABASE_URL ou CNPJ_DEMO=1.' }]
        return [200, await cnpj.rpc(nome, await corpo(req))]
      },
    ],
  ]

  async function estatico(res, pathname) {
    let arquivo
    try {
      arquivo = normalize(join(publicDir, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)))
    } catch {
      return false
    }
    if (!arquivo.startsWith(publicDir + sep)) return false
    try {
      const conteudo = await readFile(arquivo)
      res.writeHead(200, { ...seguranca, 'content-type': MIME[extname(arquivo)] ?? 'application/octet-stream' }).end(conteudo)
      return true
    } catch {
      return false
    }
  }

  const responder = (res, status, body, extra = {}) => {
    if (body === undefined || status === 204) return res.writeHead(status, { ...seguranca, ...extra }).end()
    res.writeHead(status, { ...seguranca, ...extra, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body))
  }

  // null quando pode seguir; senão a resposta de recusa. tela: a que a rota serve, conferida na lista do CRM online
  async function barrar(req, host, tela) {
    if (excedeu(req)) return [429, { erro: 'Muitas chamadas seguidas. Espere um minuto e tente de novo.' }]
    if (!autenticar) return LOCAIS.has(host) ? null : [403, { erro: 'Sem o CRM online configurado, só o próprio PC usa a prospecção.' }]
    const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '')
    try {
      const usuario = await autenticar(token)
      if (!usuario) return [401, { erro: 'Sua sessão expirou. Entre de novo para usar a prospecção.' }]
      return usuario.telas.includes(tela) ? null : [403, { erro: `Sua conta não abre a tela ${NOME_TELA[tela]}. Peça o acesso ao administrador.` }]
    } catch (err) {
      log.error(`conferir login: ${err.message}`)
      return [503, { erro: 'Não consegui conferir o seu login agora. Tente de novo em instantes.' }]
    }
  }

  const server = createServer(async (req, res) => {
    // protege contra DNS rebinding: só atende pelos nomes conhecidos (o próprio PC e, com túnel, o endereço dele)
    const host = String(req.headers.host ?? '').replace(/:\d+$/, '')
    if (!hostsPermitidos.includes(host)) return responder(res, 403, { erro: 'Host não permitido' })

    const url = new URL(req.url, 'http://localhost')
    const api = url.pathname.startsWith('/api/')
    const cors = api && origensWeb.includes(req.headers.origin) ? { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' } : {}
    try {
      if (api) {
        if (req.method === 'OPTIONS') return cors['access-control-allow-origin'] ? res.writeHead(204, { ...seguranca, ...cors, ...PREFLIGHT }).end() : responder(res, 403, { erro: 'Origem não permitida' })
        // a base de CNPJ é a Prospecção; o resto da API são as buscas do Google Maps
        const recusa = await barrar(req, host, url.pathname.startsWith('/api/rpc/') ? 'prospeccao' : 'buscas')
        if (recusa) return responder(res, ...recusa, cors)
        for (const [metodo, padrao, handler] of rotas) {
          const m = url.pathname.match(padrao)
          if (!m || metodo !== req.method) continue
          const [status, body] = await handler(req, url, m[1])
          return responder(res, status, body, cors)
        }
        return responder(res, 404, { erro: 'Rota não encontrada' }, cors)
      }
      // config gerada a partir do .env; tem prioridade sobre um config.js de build que esteja na pasta
      if (req.method === 'GET' && url.pathname === '/config.js') {
        return res.writeHead(200, { ...seguranca, 'content-type': MIME['.js'], 'cache-control': 'no-store' }).end(configJs)
      }
      if (req.method === 'GET' && (await estatico(res, url.pathname))) return
      return responder(res, 404, { erro: 'Não encontrado' })
    } catch (err) {
      if (err instanceof ValidationError) return responder(res, 422, { erro: err.message }, cors)
      if (err instanceof NotFoundError) return responder(res, 404, { erro: err.message }, cors)
      if (err instanceof HttpError) return responder(res, err.status, { erro: err.message }, cors)
      log.error(`${req.method} ${url.pathname}: ${err.stack}`)
      return responder(res, 500, { erro: 'Erro interno' }, cors)
    }
  })

  return { server, poller }
}
