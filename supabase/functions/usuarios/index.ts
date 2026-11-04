// Função do CRM online (Supabase Edge Function) dos usuários da equipe:
//   - um admin cadastra (nome, e-mail, papel), desativa e reativa;
//   - quem foi cadastrado faz o primeiro acesso sem login: digita o e-mail e cria a própria senha, uma vez só.
// A chave secreta vem do ambiente da função (SUPABASE_SECRET_KEYS) e nunca vai para o navegador. A verificação de JWT
// da plataforma fica desligada porque o primeiro acesso é sem login; as ações de admin conferem o login aqui, no Auth.
// Instalação: INSTALAR.md, "Usuários da equipe". Regras testadas em test/usuarios.test.js.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

const ORIGENS = ['https://allmed.4him.com.br', 'https://all-med.pages.dev', 'http://localhost:3000']
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAPEIS = ['admin', 'membro']
// mensagem única: não diz se o e-mail existe, já foi ativado ou está desativado
const SEM_PENDENTE = 'Não há primeiro acesso pendente para esse e-mail. Confira o e-mail ou fale com o administrador.'
const LIMITE = { tentativas: 10, janelaMs: 15 * 60_000 }

type Membro = { user_id: string; email: string; nome: string; papel: string; ativo: boolean; ativado_em?: string | null }
type Deps = {
  usuarioDoToken: (token: string) => Promise<string | null>
  membro: (userId: string) => Promise<Membro | null>
  membroPorEmail: (email: string) => Promise<Membro | null>
  criarConta: (email: string, nome: string) => Promise<string>
  apagarConta: (userId: string) => Promise<unknown>
  inserirMembro: (m: Membro) => Promise<Membro>
  atualizarMembro: (userId: string, ativo: boolean) => Promise<Membro>
  bloquearConta: (userId: string, bloquear: boolean) => Promise<unknown>
  reivindicar: (userId: string) => Promise<boolean>
  definirSenha: (userId: string, senha: string) => Promise<unknown>
  desfazerAtivacao: (userId: string) => Promise<unknown>
}

// erro com mensagem que pode ir para a tela; qualquer outro vira "não foi possível concluir"
export class Erro extends Error {
  status: number
  constructor(status: number, mensagem: string) {
    super(mensagem)
    this.status = status
  }
}

const emailDe = (c: Record<string, unknown>) => {
  const email = String(c.email ?? '').trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 200) throw new Erro(422, 'Informe um e-mail válido.')
  return email
}

// allowlist: do pedido de cadastro só saem estes três campos (contra mass assignment); senha não entra
function validarNovo(c: Record<string, unknown>) {
  const nome = String(c.nome ?? '').trim()
  const papel = String(c.papel ?? 'membro')
  const email = emailDe(c)
  if (!nome || nome.length > 100) throw new Erro(422, 'Informe o nome (até 100 letras).')
  if (!PAPEIS.includes(papel)) throw new Erro(422, 'Papel inválido.')
  return { email, nome, papel }
}

function validarSenha(senha: unknown) {
  const s = String(senha ?? '')
  if (s.length < 8 || s.length > 72) throw new Erro(422, 'A senha precisa ter de 8 a 72 caracteres.')
  return s
}

export function criarTratador(deps: Deps, origens = ORIGENS) {
  // shortcut: contagem em memória, por instância da função; vale como freio, não como garantia. Trocar por uma tabela
  // de tentativas se o primeiro acesso começar a ser atacado.
  const tentativas = new Map<string, { inicio: number; n: number }>()
  const excedeu = (ip: string) => {
    const agora = Date.now()
    const t = tentativas.get(ip)
    if (t && t.inicio + LIMITE.janelaMs > agora) return ++t.n > LIMITE.tentativas
    if (tentativas.size >= 10_000) tentativas.clear()
    tentativas.set(ip, { inicio: agora, n: 1 })
    return false
  }

  return async (req: Request): Promise<Response> => {
    const origem = req.headers.get('origin') ?? ''
    const cors: Record<string, string> = origens.includes(origem) ? { 'access-control-allow-origin': origem, vary: 'Origin' } : {}
    const responder = (status: number, corpo: unknown) =>
      new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

    if (req.method === 'OPTIONS') {
      if (!cors['access-control-allow-origin']) return responder(403, { erro: 'Origem não permitida' })
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-max-age': '600' },
      })
    }
    if (req.method !== 'POST') return responder(405, { erro: 'Use POST' })

    try {
      let corpo: Record<string, unknown>
      try {
        corpo = await req.json()
      } catch {
        return responder(422, { erro: 'Pedido inválido.' })
      }

      // ---------- primeiro acesso: sem login ----------
      if (corpo?.acao === 'primeiro_acesso') {
        const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'sem-ip'
        if (excedeu(ip)) return responder(429, { erro: 'Muitas tentativas. Espere alguns minutos e tente de novo.' })
        const senha = validarSenha(corpo.senha)
        const m = await deps.membroPorEmail(emailDe(corpo))
        if (!m?.ativo || m.ativado_em) return responder(422, { erro: SEM_PENDENTE })
        // marca antes de gravar a senha, só se ninguém marcou: dois pedidos ao mesmo tempo não criam duas senhas
        if (!(await deps.reivindicar(m.user_id))) return responder(422, { erro: SEM_PENDENTE })
        try {
          await deps.definirSenha(m.user_id, senha)
        } catch (err) {
          await deps.desfazerAtivacao(m.user_id)
          throw err
        }
        return responder(200, { ok: true })
      }

      // ---------- ações de admin: com login ----------
      const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '')
      const quem = token ? await deps.usuarioDoToken(token) : null
      if (!quem) return responder(401, { erro: 'Sua sessão expirou. Entre de novo.' })
      const eu = await deps.membro(quem)
      if (!eu?.ativo || eu.papel !== 'admin') return responder(403, { erro: 'Só administradores cadastram usuários.' })

      if (corpo?.acao === 'criar') {
        const n = validarNovo(corpo)
        const id = await deps.criarConta(n.email, n.nome)
        try {
          return responder(201, await deps.inserirMembro({ user_id: id, email: n.email, nome: n.nome, papel: n.papel, ativo: true }))
        } catch (err) {
          // conta sem membro não entra em nada e prenderia o e-mail: desfaz
          await deps.apagarConta(id)
          throw err
        }
      }

      if (corpo?.acao === 'desativar' || corpo?.acao === 'reativar') {
        const id = String(corpo.user_id ?? '')
        if (!UUID.test(id)) return responder(422, { erro: 'Usuário inválido.' })
        const ativo = corpo.acao === 'reativar'
        if (!ativo && id === quem) return responder(422, { erro: 'Você não pode desativar a própria conta.' })
        if (!(await deps.membro(id))) return responder(404, { erro: 'Usuário não encontrado.' })
        // bloquear a conta derruba o login; desativar o membro tira o acesso aos leads
        await deps.bloquearConta(id, !ativo)
        return responder(200, await deps.atualizarMembro(id, ativo))
      }

      return responder(422, { erro: 'Ação desconhecida.' })
    } catch (err) {
      if (err instanceof Erro) return responder(err.status, { erro: err.message })
      // sem e-mail nem senha no log
      console.error('usuarios:', err instanceof Error ? err.message : String(err))
      return responder(500, { erro: 'Não foi possível concluir. Tente de novo.' })
    }
  }
}

// No CRM online (Deno). Fora dele (testes no Node) só as regras acima são usadas.
const deno = (globalThis as { Deno?: { env: { get(n: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): unknown } }).Deno
if (deno) {
  const secretas = JSON.parse(deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
  const chave: string = secretas.default ?? deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const admin = createClient(deno.env.get('SUPABASE_URL') ?? '', chave, { auth: { persistSession: false, autoRefreshToken: false } })
  const ok = ({ data, error }: { data: unknown; error: { message: string } | null }) => {
    if (error) throw new Error(error.message)
    return data
  }
  const CAMPOS = 'user_id,email,nome,papel,ativo,ativado_em'

  deno.serve(
    criarTratador({
      usuarioDoToken: async (t) => (await admin.auth.getUser(t)).data.user?.id ?? null,
      membro: async (id) => ok(await admin.from('membros').select(CAMPOS).eq('user_id', id).maybeSingle()) as Membro | null,
      membroPorEmail: async (email) => ok(await admin.from('membros').select(CAMPOS).eq('email', email).maybeSingle()) as Membro | null,
      // sem senha: ela é criada pela própria pessoa no primeiro acesso
      criarConta: async (email, nome) => {
        const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { nome } })
        if (error?.code === 'email_exists' || error?.status === 422) throw new Erro(422, 'Já existe uma conta com esse e-mail.')
        if (error) throw new Error(error.message)
        return data.user.id
      },
      apagarConta: async (id) => admin.auth.admin.deleteUser(id),
      inserirMembro: async (m) => ok(await admin.from('membros').insert(m).select(CAMPOS).single()) as Membro,
      atualizarMembro: async (id, ativo) => ok(await admin.from('membros').update({ ativo }).eq('user_id', id).select(CAMPOS).single()) as Membro,
      bloquearConta: async (id, bloquear) => ok(await admin.auth.admin.updateUserById(id, { ban_duration: bloquear ? '876000h' : 'none' })),
      reivindicar: async (id) => {
        const linhas = ok(await admin.from('membros').update({ ativado_em: new Date().toISOString() }).eq('user_id', id).is('ativado_em', null).eq('ativo', true).select('user_id')) as unknown[]
        return linhas.length === 1
      },
      definirSenha: async (id, senha) => ok(await admin.auth.admin.updateUserById(id, { password: senha })),
      desfazerAtivacao: async (id) => ok(await admin.from('membros').update({ ativado_em: null }).eq('user_id', id).select('user_id')),
    }),
  )
}
