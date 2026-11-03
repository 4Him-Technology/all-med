import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { consultaPglite, criarCnpj } from '../src/cnpj.js'
import { createScraperClient } from '../src/scraper.js'
import { createApp } from '../src/server.js'
import { createStore } from '../src/store.js'
import { criarBancoCnpj } from './cnpj-fixture.js'
import { createFakeScraper } from './fake-scraper.js'

const silencioso = { info() {}, error() {} }
const publicDir = fileURLToPath(new URL('../public', import.meta.url))
const config = { supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'sb_publishable_teste', urlWeb: 'https://crm.exemplo.com' }
let dir
let fake
let app
let base

const ouvir = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)))

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'crm-api-'))
  fake = createFakeScraper()
  const portaFake = await ouvir(fake)
  app = createApp({
    store: createStore(join(dir, 'local.json')),
    scraper: createScraperClient(`http://127.0.0.1:${portaFake}`),
    cnpj: criarCnpj(consultaPglite(await criarBancoCnpj())),
    publicDir,
    log: silencioso,
    config,
  })
  base = `http://127.0.0.1:${await ouvir(app.server)}`
})

after(() => {
  app.server.close()
  fake.close()
  rmSync(dir, { recursive: true, force: true })
})

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body && JSON.stringify(body),
  })
  return { status: res.status, json: res.status === 204 ? null : await res.json() }
}

// fetch normaliza o caminho e não deixa trocar o Host, então alguns casos usam http.request
const cru = (porta, path, headers = {}) =>
  new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: porta, path, headers }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
      .on('error', reject)
      .end()
  })

const buscaPorId = async (id) => (await req('/api/buscas')).json.itens.find((b) => b.id === id)

test('busca no Maps fica guardada no PC até a tela enviar ao kanban online', async () => {
  const criada = await req('/api/buscas', { method: 'POST', body: { keywords: 'dentistas em Campinas', max_minutos: 5 } })
  assert.equal(criada.status, 201)
  assert.equal(criada.json.status, 'pendente')

  await app.poller.tick()
  assert.equal((await buscaPorId(criada.json.id)).status, 'executando')
  await app.poller.tick()
  const busca = await buscaPorId(criada.json.id)
  assert.equal(busca.status, 'importado')
  assert.equal(busca.encontrados, 4)
  assert.equal('leads' in busca, false)

  const leads = await req(`/api/buscas/${criada.json.id}/leads`)
  assert.equal(leads.json.length, 4)
  assert.ok(leads.json.every((l) => l.place_id && l.nome))

  const escolhidos = leads.json.slice(0, 3).map((l) => l.place_id)
  assert.equal((await req(`/api/buscas/${criada.json.id}`, { method: 'PATCH', body: { place_ids: escolhidos, novos: 3 } })).json.enviados, 3)
  assert.deepEqual((await req(`/api/buscas/${criada.json.id}/leads`)).json.map((l) => l.enviado), [true, true, true, false])
  assert.equal((await req(`/api/buscas/${criada.json.id}`, { method: 'PATCH', body: { place_ids: ['nao-existe'], novos: 0 } })).status, 422)
  assert.equal((await req(`/api/buscas/${crypto.randomUUID()}/leads`)).status, 404)
  assert.equal((await req('/api/buscas/123/leads')).status, 404)
})

test('prospecção chama só as funções liberadas da base de CNPJ', async () => {
  const r = await req('/api/rpc/buscar_empresas', { method: 'POST', body: { filtros: { municipios: [7107], situacoes: [2] } } })
  assert.equal(r.status, 200)
  assert.equal(r.json.total, 3)
  const detalhe = await req('/api/rpc/cnpj_detalhe', { method: 'POST', body: { p_cnpj: r.json.itens[0].cnpj } })
  assert.equal(detalhe.json.socios.length, 2)
  assert.equal((await req('/api/rpc/cnpj_municipios', { method: 'POST', body: { p_uf: 'SP' } })).json.length, 2)
  assert.equal((await req('/api/rpc/buscar_empresas', { method: 'POST', body: { por_pagina: 999 } })).status, 422)
  assert.equal((await req('/api/rpc/apagar_tudo', { method: 'POST', body: {} })).status, 404)
})

test('valida entrada sem vazar detalhes internos', async () => {
  const vazio = await req('/api/buscas', { method: 'POST', body: { keywords: '' } })
  assert.equal(vazio.status, 422)
  assert.equal(typeof vazio.json.erro, 'string')
  const texto = await fetch(`${base}/api/buscas`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
  assert.equal(texto.status, 415)
  const quebrado = await fetch(`${base}/api/buscas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{x' })
  assert.equal(quebrado.status, 422)
  assert.equal((await req('/api/leads')).status, 404)
})

test('entrega a config do Supabase com a chave pública e a CSP liberando só esse projeto', async () => {
  const res = await fetch(`${base}/config.js`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /javascript/)
  const texto = await res.text()
  assert.match(texto, /"supabaseUrl":"https:\/\/abc\.supabase\.co"/)
  assert.match(texto, /"local":true/)
  assert.match(res.headers.get('content-security-policy'), /connect-src 'self' https:\/\/abc\.supabase\.co/)
})

test('serve o front com security headers e bloqueia path traversal e Host estranho', async () => {
  const res = await fetch(`${base}/`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/)
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  const porta = app.server.address().port
  assert.equal(await cru(porta, '/..%2f..%2fpackage.json'), 404)
  assert.equal(await cru(porta, '/api/buscas', { host: 'evil.example.com' }), 403)
})

test('scraper fora do ar responde 502 com mensagem amigável', async () => {
  const fora = createApp({
    store: createStore(join(dir, 'fora.json')),
    scraper: { criarJob: async () => Promise.reject(new Error('ECONNREFUSED')) },
    publicDir,
    log: silencioso,
  })
  const porta = await ouvir(fora.server)
  const res = await fetch(`http://127.0.0.1:${porta}/api/buscas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keywords: 'x' }),
  })
  fora.server.close()
  assert.equal(res.status, 502)
  assert.match((await res.json()).erro, /scraper/i)
})
