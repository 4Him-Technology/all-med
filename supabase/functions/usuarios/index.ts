// Função do CRM online (Supabase Edge Function) que cadastra, desativa e reativa os usuários da equipe.
// Só um admin ativo usa. A chave secreta vem do ambiente da função (SUPABASE_SECRET_KEYS) e nunca vai para o navegador;
// o login de quem chama é conferido pela plataforma (verify_jwt) e de novo aqui, no Auth.
// Instalação: INSTALAR.md, "Usuários da equipe". Regras testadas em test/usuarios.test.js.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

const ORIGENS = ['https://allmed.4him.com.br', 'https://all-med.pages.dev', 'http://localhost:3000']
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAPEIS = ['admin', 'membro']

type Membro = { user_id: string; email: string; nome: string; papel: string; ativo: boolean }
type Deps = {
  usuarioDoToken: (token: string) => Promise<string | null>
  membro: (userId: string) => Promise<Membro | null>
  criarConta: (email: string, senha: string, nome: string) => Promise<string>
  apagarConta: (userId: string) => Promise<unknown>
  inserirMembro: (m: Membro) => Promise<Membro>
  atualizarMembro: (userId: string, ativo: boolean) => Promise<Membro>
  bloquearConta: (userId: string, bloquear: boolean) => Promise<unknown>
}

// erro com mensagem que pode ir para a tela; qualquer outro vira "não foi possível concluir"
export class Erro extends Error {
  status: number
  constructor(status: number, mensagem: string) {
    super(mensagem)
    this.status = status
  }
}

// allowlist: do pedido só saem estes quatro campos (contra mass assignment)
function validarNovo(c: Record<string, unknown>) {
  const email = String(c.email ?? '').trim().toLowerCase()
  const nome = String(c.nome ?? '').trim()
  const senha = String(c.senha ?? '')
  const papel = String(c.papel ?? 'membro')
  if (!EMAIL.test(email) || email.length > 200) throw new Erro(422, 'Informe um e-mail válido.')
  if (!nome || nome.length > 100) throw new Erro(422, 'Informe o nome (até 100 letras).')
  if (senha.length < 8 || senha.length > 72) throw new Erro(422, 'A senha inicial precisa ter de 8 a 72 caracteres.')
  if (!PAPEIS.includes(papel)) throw new Erro(422, 'Papel inválido.')
  return { email, nome, senha, papel }
}

export function criarTratador(deps: Deps, origens = ORIGENS) {
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
      const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '')
      const quem = token ? await deps.usuarioDoToken(token) : null
      if (!quem) return responder(401, { erro: 'Sua sessão expirou. Entre de novo.' })
      const eu = await deps.membro(quem)
      if (!eu?.ativo || eu.papel !== 'admin') return responder(403, { erro: 'Só administradores cadastram usuários.' })

      let corpo: Record<string, unknown>
      try {
        corpo = await req.json()
      } catch {
        return responder(422, { erro: 'Pedido inválido.' })
      }

      if (corpo?.acao === 'criar') {
        const n = validarNovo(corpo)
        const id = await deps.criarConta(n.email, n.senha, n.nome)
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
  const CAMPOS = 'user_id,email,nome,papel,ativo'

  deno.serve(
    criarTratador({
      usuarioDoToken: async (t) => (await admin.auth.getUser(t)).data.user?.id ?? null,
      membro: async (id) => ok(await admin.from('membros').select(CAMPOS).eq('user_id', id).maybeSingle()) as Membro | null,
      criarConta: async (email, senha, nome) => {
        const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } })
        if (error?.code === 'email_exists' || error?.status === 422) throw new Erro(422, 'Já existe uma conta com esse e-mail.')
        if (error) throw new Error(error.message)
        return data.user.id
      },
      apagarConta: async (id) => admin.auth.admin.deleteUser(id),
      inserirMembro: async (m) => ok(await admin.from('membros').insert(m).select(CAMPOS).single()) as Membro,
      atualizarMembro: async (id, ativo) => ok(await admin.from('membros').update({ ativo }).eq('user_id', id).select(CAMPOS).single()) as Membro,
      bloquearConta: async (id, bloquear) => ok(await admin.auth.admin.updateUserById(id, { ban_duration: bloquear ? '876000h' : 'none' })),
    }),
  )
}
