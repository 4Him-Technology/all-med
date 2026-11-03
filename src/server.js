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

// config: { supabaseUrl, supabaseKey, urlWeb } (só a chave pública; ver validarConfigSupabase)
export function createApp({ store, scraper, cnpj, publicDir, log, config = null, hostsPermitidos = ['localhost', '127.0.0.1'] }) {
  const poller = createPoller({ store, scraper, log })
  const seguranca = cabecalhosSeguranca(config?.supabaseUrl)
  const configJs = `export default ${JSON.stringify({ ...config, local: true })}\n`

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

  const responder = (res, status, body) => {
    if (body === undefined || status === 204) return res.writeHead(status, seguranca).end()
    res.writeHead(status, { ...seguranca, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(body))
  }

  const server = createServer(async (req, res) => {
    // protege contra DNS rebinding: o servidor local não tem login e só deve atender o próprio PC
    const host = String(req.headers.host ?? '').replace(/:\d+$/, '')
    if (!hostsPermitidos.includes(host)) return responder(res, 403, { erro: 'Host não permitido' })

    const url = new URL(req.url, 'http://localhost')
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const [metodo, padrao, handler] of rotas) {
          const m = url.pathname.match(padrao)
          if (!m || metodo !== req.method) continue
          const [status, body] = await handler(req, url, m[1])
          return responder(res, status, body)
        }
        return responder(res, 404, { erro: 'Rota não encontrada' })
      }
      // config gerada a partir do .env; tem prioridade sobre um config.js de build que esteja na pasta
      if (req.method === 'GET' && url.pathname === '/config.js') {
        return res.writeHead(200, { ...seguranca, 'content-type': MIME['.js'], 'cache-control': 'no-store' }).end(configJs)
      }
      if (req.method === 'GET' && (await estatico(res, url.pathname))) return
      return responder(res, 404, { erro: 'Não encontrado' })
    } catch (err) {
      if (err instanceof ValidationError) return responder(res, 422, { erro: err.message })
      if (err instanceof NotFoundError) return responder(res, 404, { erro: err.message })
      if (err instanceof HttpError) return responder(res, err.status, { erro: err.message })
      log.error(`${req.method} ${url.pathname}: ${err.stack}`)
      return responder(res, 500, { erro: 'Erro interno' })
    }
  })

  return { server, poller }
}
