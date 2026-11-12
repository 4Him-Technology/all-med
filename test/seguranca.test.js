import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cabecalhosSeguranca, criarVerificadorSupabase, validarConfigSupabase, validarUrlPc } from '../src/seguranca.js'

const jwt = (role) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`

test('só aceita a chave pública do Supabase no navegador', () => {
  const url = 'https://abc.supabase.co'
  assert.deepEqual(validarConfigSupabase({ url, chave: 'sb_publishable_123' }), { supabaseUrl: url, supabaseKey: 'sb_publishable_123' })
  assert.equal(validarConfigSupabase({ url, chave: jwt('anon') }).supabaseUrl, url)
  assert.throws(() => validarConfigSupabase({ url, chave: 'sb_secret_123' }), /secreta/)
  assert.throws(() => validarConfigSupabase({ url, chave: jwt('service_role') }), /secreta/)
  assert.throws(() => validarConfigSupabase({ url: 'http://abc.supabase.co', chave: 'sb_publishable_1' }), /https/)
  assert.throws(() => validarConfigSupabase({ url }), /juntos/)
  assert.equal(validarConfigSupabase({}), null)
})

test('CSP libera só o próprio site, o CDN fixo do supabase-js e o projeto Supabase', () => {
  const csp = cabecalhosSeguranca('https://abc.supabase.co')['content-security-policy']
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net;/)
  assert.match(csp, /connect-src 'self' https:\/\/abc\.supabase\.co wss:\/\/abc\.supabase\.co;/)
  assert.match(csp, /font-src https:\/\/fonts\.gstatic\.com;/)
  assert.match(cabecalhosSeguranca()['content-security-policy'], /connect-src 'self';/)
})

test('site na internet: CSP libera o endereço do PC, que precisa ser https', () => {
  const csp = cabecalhosSeguranca('https://abc.supabase.co', 'https://pc.exemplo.com')['content-security-policy']
  assert.match(csp, /connect-src 'self' https:\/\/abc\.supabase\.co wss:\/\/abc\.supabase\.co https:\/\/pc\.exemplo\.com;/)
  assert.equal(validarUrlPc('https://pc.exemplo.com/'), 'https://pc.exemplo.com')
  assert.equal(validarUrlPc(''), null)
  assert.throws(() => validarUrlPc('http://pc.exemplo.com'), /https/)
})

test('confere o login e as telas da pessoa no CRM online, e guarda a resposta por um tempo', async () => {
  const BOM = 'aaa.bbb.ccc'
  const chamadas = []
  const fetchFalso = async (url, init) => {
    chamadas.push(String(url))
    assert.equal(init.headers.apikey, 'sb_publishable_x')
    if (init.headers.authorization !== `Bearer ${BOM}`) return new Response('{}', { status: 401 })
    return new Response(JSON.stringify(String(url).endsWith('/auth/v1/user') ? { id: 'u1', email: 'a@b.com' } : ['prospeccao', 'buscas']))
  }
  const verificar = criarVerificadorSupabase({ supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'sb_publishable_x', fetchImpl: fetchFalso })
  assert.deepEqual(await verificar(BOM), { id: 'u1', telas: ['prospeccao', 'buscas'] })
  assert.deepEqual(await verificar(BOM), { id: 'u1', telas: ['prospeccao', 'buscas'] })
  assert.deepEqual(chamadas.sort(), ['https://abc.supabase.co/auth/v1/user', 'https://abc.supabase.co/rest/v1/rpc/minhas_telas'])
  assert.equal(await verificar('ddd.eee.fff'), null)
  // o que nem tem formato de token não chega a consultar o CRM
  assert.equal(await verificar('nao-e-token'), null)
  assert.equal(await verificar(undefined), null)
  assert.equal(chamadas.length, 4)
})

test('sem conseguir ler as telas (CRM fora do ar ou sem a migration de acessos), não libera e tenta de novo na próxima', async () => {
  let telas = 404
  const fetchFalso = async (url) => (String(url).endsWith('/auth/v1/user') ? new Response(JSON.stringify({ id: 'u1' })) : telas === 200 ? new Response('["buscas"]') : new Response('{}', { status: telas }))
  const verificar = criarVerificadorSupabase({ supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'sb_publishable_x', fetchImpl: fetchFalso })
  await assert.rejects(verificar('aaa.bbb.ccc'), /minhas_telas/)
  telas = 200
  assert.deepEqual(await verificar('aaa.bbb.ccc'), { id: 'u1', telas: ['buscas'] })
})

test('CSP libera o mapa da aba Google Maps: CSS do Leaflet no CDN fixo e os tiles do OpenStreetMap', () => {
  const csp = cabecalhosSeguranca()['content-security-policy']
  assert.match(csp, /style-src 'self' https:\/\/fonts\.googleapis\.com https:\/\/cdn\.jsdelivr\.net;/)
  assert.match(csp, /img-src 'self' data: https:\/\/tile\.openstreetmap\.org;/)
})
