// Regras da função "usuarios" (supabase/functions/usuarios), com o CRM online trocado por dados em memória
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

// a função importa o supabase-js como "npm:...", que só o Deno do CRM online resolve; aqui ele vira um módulo vazio
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(especificador, contexto, proximo) {
      if (especificador.startsWith('npm:')) return { url: 'data:text/javascript,export const createClient = () => null', shortCircuit: true }
      return proximo(especificador, contexto)
    }`)}`,
)
const { criarTratador, Erro } = await import('../supabase/functions/usuarios/index.ts')

const ADMIN = '11111111-1111-4111-8111-111111111111'
const MEMBRO = '22222222-2222-4222-8222-222222222222'
const NOVO = '99999999-9999-4999-8999-999999999999'
const SITE = 'https://allmed.4him.com.br'

function crmFalso() {
  const membros = new Map([
    [ADMIN, { user_id: ADMIN, email: 'ana@x.com', nome: 'Ana', papel: 'admin', ativo: true }],
    [MEMBRO, { user_id: MEMBRO, email: 'bruno@x.com', nome: 'Bruno', papel: 'membro', ativo: true }],
  ])
  const chamadas = []
  const deps = {
    usuarioDoToken: async (t) => ({ 'token-admin': ADMIN, 'token-membro': MEMBRO })[t] ?? null,
    membro: async (id) => membros.get(id) ?? null,
    criarConta: async (email, senha, nome) => {
      chamadas.push(['criarConta', email, senha, nome])
      if (email === 'ja@existe.com') throw new Erro(422, 'Já existe uma conta com esse e-mail.')
      return NOVO
    },
    apagarConta: async (id) => chamadas.push(['apagarConta', id]),
    inserirMembro: async (m) => {
      if (m.nome === 'Falha') throw new Error('banco fora do ar')
      membros.set(m.user_id, m)
      return m
    },
    atualizarMembro: async (id, ativo) => ({ ...membros.get(id), ativo }),
    bloquearConta: async (id, sim) => chamadas.push(['bloquearConta', id, sim]),
  }
  return { tratar: criarTratador(deps), chamadas }
}

const pedido = (token, corpo, { origem = SITE, metodo = 'POST' } = {}) =>
  new Request('https://x.supabase.co/functions/v1/usuarios', {
    method: metodo,
    headers: { origin: origem, 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: metodo === 'POST' ? JSON.stringify(corpo) : undefined,
  })

test('só responde CORS para os endereços do sistema', async () => {
  const { tratar } = crmFalso()
  const pre = await tratar(pedido(null, null, { metodo: 'OPTIONS' }))
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), SITE)
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/)
  const estranho = await tratar(pedido(null, null, { metodo: 'OPTIONS', origem: 'https://evil.example.com' }))
  assert.equal(estranho.status, 403)
  assert.equal(estranho.headers.get('access-control-allow-origin'), null)
})

test('exige login e papel de admin', async () => {
  const { tratar, chamadas } = crmFalso()
  const corpo = { acao: 'criar', email: 'novo@x.com', nome: 'Novo', senha: 'senha-forte-1' }
  assert.equal((await tratar(pedido(null, corpo))).status, 401)
  assert.equal((await tratar(pedido('token-falso', corpo))).status, 401)
  const membro = await tratar(pedido('token-membro', corpo))
  assert.equal(membro.status, 403)
  assert.equal(membro.headers.get('access-control-allow-origin'), SITE)
  assert.deepEqual(chamadas, [])
})

test('admin cadastra usuário com e-mail, nome, senha inicial e papel', async () => {
  const { tratar, chamadas } = crmFalso()
  const r = await tratar(pedido('token-admin', { acao: 'criar', email: '  Novo@X.com ', nome: ' Novo Usuário ', senha: 'senha-forte-1', papel: 'membro', ativo: false, user_id: ADMIN }))
  assert.equal(r.status, 201)
  // só os campos permitidos entram; "ativo" e "user_id" mandados no pedido são ignorados
  assert.deepEqual(await r.json(), { user_id: NOVO, email: 'novo@x.com', nome: 'Novo Usuário', papel: 'membro', ativo: true })
  assert.deepEqual(chamadas, [['criarConta', 'novo@x.com', 'senha-forte-1', 'Novo Usuário']])
})

test('recusa cadastro com dado inválido sem criar conta', async () => {
  const { tratar, chamadas } = crmFalso()
  for (const corpo of [
    { email: 'sem-arroba', nome: 'X', senha: 'senha-forte-1' },
    { email: 'a@b.com', nome: '', senha: 'senha-forte-1' },
    { email: 'a@b.com', nome: 'X', senha: 'curta' },
    { email: 'a@b.com', nome: 'X', senha: 'senha-forte-1', papel: 'dono' },
  ]) {
    const r = await tratar(pedido('token-admin', { acao: 'criar', ...corpo }))
    assert.equal(r.status, 422, JSON.stringify(corpo))
    assert.equal(typeof (await r.json()).erro, 'string')
  }
  assert.deepEqual(chamadas, [])
})

test('e-mail já cadastrado vira mensagem clara; falha ao gravar o membro desfaz a conta criada', async () => {
  const { tratar, chamadas } = crmFalso()
  const repetido = await tratar(pedido('token-admin', { acao: 'criar', email: 'ja@existe.com', nome: 'X', senha: 'senha-forte-1' }))
  assert.equal(repetido.status, 422)
  assert.match((await repetido.json()).erro, /Já existe/)
  const falha = await tratar(pedido('token-admin', { acao: 'criar', email: 'f@x.com', nome: 'Falha', senha: 'senha-forte-1' }))
  assert.equal(falha.status, 500)
  assert.doesNotMatch((await falha.json()).erro, /banco fora do ar/)
  assert.deepEqual(chamadas.at(-1), ['apagarConta', NOVO])
})

test('admin desativa e reativa, mas não a própria conta', async () => {
  const { tratar, chamadas } = crmFalso()
  const des = await tratar(pedido('token-admin', { acao: 'desativar', user_id: MEMBRO }))
  assert.equal(des.status, 200)
  assert.equal((await des.json()).ativo, false)
  assert.equal((await tratar(pedido('token-admin', { acao: 'reativar', user_id: MEMBRO }))).status, 200)
  assert.deepEqual(chamadas, [['bloquearConta', MEMBRO, true], ['bloquearConta', MEMBRO, false]])
  assert.equal((await tratar(pedido('token-admin', { acao: 'desativar', user_id: ADMIN }))).status, 422)
  assert.equal((await tratar(pedido('token-admin', { acao: 'desativar', user_id: 'nao-e-uuid' }))).status, 422)
  assert.equal((await tratar(pedido('token-admin', { acao: 'desativar', user_id: NOVO }))).status, 404)
  assert.equal((await tratar(pedido('token-admin', { acao: 'apagar_tudo' }))).status, 422)
})
