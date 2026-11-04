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
const PENDENTE = '33333333-3333-4333-8333-333333333333' // cadastrado, ainda sem primeiro acesso
const BLOQUEADO = '44444444-4444-4444-8444-444444444444' // cadastrado e desativado antes do primeiro acesso
const NOVO = '99999999-9999-4999-8999-999999999999'
const SITE = 'https://allmed.4him.com.br'
const PENDENTE_MSG = /Não há primeiro acesso pendente/

function crmFalso() {
  const membros = new Map(
    [
      { user_id: ADMIN, email: 'ana@x.com', nome: 'Ana', papel: 'admin', ativo: true, ativado_em: '2026-11-01' },
      { user_id: MEMBRO, email: 'bruno@x.com', nome: 'Bruno', papel: 'membro', ativo: true, ativado_em: '2026-11-01' },
      { user_id: PENDENTE, email: 'carlos@x.com', nome: 'Carlos', papel: 'membro', ativo: true, ativado_em: null },
      { user_id: BLOQUEADO, email: 'dani@x.com', nome: 'Dani', papel: 'membro', ativo: false, ativado_em: null },
    ].map((m) => [m.user_id, m]),
  )
  const chamadas = []
  const falhas = new Set()
  const deps = {
    usuarioDoToken: async (t) => ({ 'token-admin': ADMIN, 'token-membro': MEMBRO })[t] ?? null,
    membro: async (id) => membros.get(id) ?? null,
    membroPorEmail: async (email) => [...membros.values()].find((m) => m.email === email) ?? null,
    criarConta: async (email, nome) => {
      chamadas.push(['criarConta', email, nome])
      if (email === 'ja@existe.com') throw new Erro(422, 'Já existe uma conta com esse e-mail.')
      return NOVO
    },
    apagarConta: async (id) => chamadas.push(['apagarConta', id]),
    inserirMembro: async (m) => {
      if (m.nome === 'Falha') throw new Error('banco fora do ar')
      membros.set(m.user_id, { ...m, ativado_em: null })
      return membros.get(m.user_id)
    },
    atualizarMembro: async (id, ativo) => ({ ...membros.get(id), ativo }),
    bloquearConta: async (id, sim) => chamadas.push(['bloquearConta', id, sim]),
    // marca o primeiro acesso só se ninguém marcou antes (no banco: update ... where ativado_em is null)
    reivindicar: async (id) => {
      chamadas.push(['reivindicar', id])
      if (falhas.has('corrida')) return false
      const m = membros.get(id)
      if (m.ativado_em) return false
      m.ativado_em = '2026-11-03'
      return true
    },
    definirSenha: async (id, senha) => {
      chamadas.push(['definirSenha', id, senha])
      if (falhas.has('senha')) throw new Error('auth fora do ar')
    },
    desfazerAtivacao: async (id) => {
      chamadas.push(['desfazerAtivacao', id])
      membros.get(id).ativado_em = null
    },
  }
  return { tratar: criarTratador(deps), chamadas, falhas, membros }
}

const pedido = (token, corpo, { origem = SITE, metodo = 'POST', ip = '203.0.113.1' } = {}) =>
  new Request('https://x.supabase.co/functions/v1/usuarios', {
    method: metodo,
    headers: { origin: origem, 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token && { authorization: `Bearer ${token}` }) },
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

test('cadastrar, desativar e reativar exigem login de admin', async () => {
  const { tratar, chamadas } = crmFalso()
  const corpo = { acao: 'criar', email: 'novo@x.com', nome: 'Novo' }
  assert.equal((await tratar(pedido(null, corpo))).status, 401)
  assert.equal((await tratar(pedido('token-falso', corpo))).status, 401)
  const membro = await tratar(pedido('token-membro', corpo))
  assert.equal(membro.status, 403)
  assert.equal(membro.headers.get('access-control-allow-origin'), SITE)
  assert.equal((await tratar(pedido('token-membro', { acao: 'desativar', user_id: ADMIN }))).status, 403)
  assert.deepEqual(chamadas, [])
})

test('admin cadastra com nome, e-mail e papel; a senha fica para a pessoa criar', async () => {
  const { tratar, chamadas } = crmFalso()
  const r = await tratar(pedido('token-admin', { acao: 'criar', email: '  Novo@X.com ', nome: ' Novo Usuário ', papel: 'membro', senha: 'escolhida-pelo-admin', ativo: false, user_id: ADMIN }))
  assert.equal(r.status, 201)
  // só os campos permitidos entram: senha, "ativo" e "user_id" mandados no pedido são ignorados
  assert.deepEqual(await r.json(), { user_id: NOVO, email: 'novo@x.com', nome: 'Novo Usuário', papel: 'membro', ativo: true, ativado_em: null })
  assert.deepEqual(chamadas, [['criarConta', 'novo@x.com', 'Novo Usuário']])
})

test('recusa cadastro com dado inválido sem criar conta', async () => {
  const { tratar, chamadas } = crmFalso()
  for (const corpo of [{ email: 'sem-arroba', nome: 'X' }, { email: 'a@b.com', nome: '' }, { email: 'a@b.com', nome: 'X', papel: 'dono' }]) {
    const r = await tratar(pedido('token-admin', { acao: 'criar', ...corpo }))
    assert.equal(r.status, 422, JSON.stringify(corpo))
    assert.equal(typeof (await r.json()).erro, 'string')
  }
  assert.deepEqual(chamadas, [])
})

test('e-mail já cadastrado vira mensagem clara; falha ao gravar o membro desfaz a conta criada', async () => {
  const { tratar, chamadas } = crmFalso()
  const repetido = await tratar(pedido('token-admin', { acao: 'criar', email: 'ja@existe.com', nome: 'X' }))
  assert.equal(repetido.status, 422)
  assert.match((await repetido.json()).erro, /Já existe/)
  const falha = await tratar(pedido('token-admin', { acao: 'criar', email: 'f@x.com', nome: 'Falha' }))
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

test('primeiro acesso: a pessoa cadastrada digita o e-mail e cria a senha, uma vez só e sem login', async () => {
  const { tratar, chamadas } = crmFalso()
  const r = await tratar(pedido(null, { acao: 'primeiro_acesso', email: ' Carlos@X.com ', senha: 'senha-forte-1' }))
  assert.equal(r.status, 200)
  assert.deepEqual(chamadas, [['reivindicar', PENDENTE], ['definirSenha', PENDENTE, 'senha-forte-1']])
  // de novo, com o mesmo e-mail: já foi feito, a senha só muda logado
  const repetido = await tratar(pedido(null, { acao: 'primeiro_acesso', email: 'carlos@x.com', senha: 'outra-senha-1' }))
  assert.equal(repetido.status, 422)
  assert.match((await repetido.json()).erro, PENDENTE_MSG)
  assert.equal(chamadas.length, 2)
})

test('primeiro acesso recusa com a mesma mensagem e-mail desconhecido, já ativado ou desativado', async () => {
  const { tratar, chamadas } = crmFalso()
  for (const email of ['ninguem@x.com', 'bruno@x.com', 'dani@x.com']) {
    const r = await tratar(pedido(null, { acao: 'primeiro_acesso', email, senha: 'senha-forte-1' }))
    assert.equal(r.status, 422, email)
    assert.match((await r.json()).erro, PENDENTE_MSG, email)
  }
  const curta = await tratar(pedido(null, { acao: 'primeiro_acesso', email: 'carlos@x.com', senha: 'curta' }))
  assert.equal(curta.status, 422)
  assert.match((await curta.json()).erro, /8 a 72/)
  assert.deepEqual(chamadas, [])
})

test('primeiro acesso: corrida perde, e falha ao gravar a senha deixa o acesso pendente de novo', async () => {
  const { tratar, chamadas, falhas, membros } = crmFalso()
  falhas.add('corrida')
  assert.equal((await tratar(pedido(null, { acao: 'primeiro_acesso', email: 'carlos@x.com', senha: 'senha-forte-1' }))).status, 422)
  falhas.delete('corrida')
  falhas.add('senha')
  const r = await tratar(pedido(null, { acao: 'primeiro_acesso', email: 'carlos@x.com', senha: 'senha-forte-1' }))
  assert.equal(r.status, 500)
  assert.deepEqual(chamadas.at(-1), ['desfazerAtivacao', PENDENTE])
  assert.equal(membros.get(PENDENTE).ativado_em, null)
})

test('primeiro acesso limita tentativas por endereço', async () => {
  const { tratar } = crmFalso()
  const status = []
  for (let i = 0; i < 11; i++) status.push((await tratar(pedido(null, { acao: 'primeiro_acesso', email: `x${i}@x.com`, senha: 'senha-forte-1' }))).status)
  assert.deepEqual(status, [...Array(10).fill(422), 429])
  // outro endereço segue livre
  assert.equal((await tratar(pedido(null, { acao: 'primeiro_acesso', email: 'y@x.com', senha: 'senha-forte-1' }, { ip: '203.0.113.2' }))).status, 422)
})
