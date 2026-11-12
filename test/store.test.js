import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { NotFoundError, ValidationError, createStore, validarBusca } from '../src/store.js'

const arquivo = () => join(mkdtempSync(join(tmpdir(), 'crm-store-')), 'local.json')

test('valida parâmetros da busca no Maps', () => {
  const b = validarBusca({ keywords: 'dentistas em Campinas\n\n academias em Sorocaba ' })
  assert.deepEqual(b.keywords, ['dentistas em Campinas', 'academias em Sorocaba'])
  assert.equal(b.lang, 'pt')
  assert.equal(b.depth, 1)
  assert.equal(b.max_minutos, 10)
  assert.equal(b.nome, 'dentistas em Campinas')
  assert.throws(() => validarBusca({ keywords: '' }), ValidationError)
  assert.throws(() => validarBusca({ keywords: 'x', lang: 'portugues' }), ValidationError)
  assert.throws(() => validarBusca({ keywords: 'x', depth: 50 }), ValidationError)
  assert.throws(() => validarBusca(null), ValidationError)
})

test('guarda o resultado da busca até ser enviado e persiste em disco', () => {
  const file = arquivo()
  const s = createStore(file)
  const b = s.createBusca(validarBusca({ keywords: 'x' }), 'job-1')
  assert.equal(b.status, 'pendente')
  assert.equal('leads' in b, false)
  assert.deepEqual(s.buscasAtivas().map((x) => x.id), [b.id])
  assert.throws(() => s.marcarEnviados(b.id, { place_ids: ['a'], novos: 1 }), /não terminou/)

  s.updateBusca(b.id, { status: 'importado', encontrados: 2, leads: [{ nome: 'A', place_id: 'a' }, { nome: 'B', place_id: 'b' }] })
  assert.equal(s.buscasAtivas().length, 0)
  assert.equal(s.leadsDaBusca(b.id).length, 2)

  const recarregado = createStore(file)
  assert.equal(recarregado.listBuscas().itens[0].status, 'importado')
  assert.equal(recarregado.leadsDaBusca(b.id).length, 2)
  assert.throws(() => recarregado.leadsDaBusca(crypto.randomUUID()), NotFoundError)
})

test('marca quais empresas da busca já foram mandadas ao kanban, uma parte de cada vez', () => {
  const file = arquivo()
  const s = createStore(file)
  const b = s.createBusca(validarBusca({ keywords: 'x' }), 'job-1')
  s.updateBusca(b.id, { status: 'importado', encontrados: 3, leads: ['a', 'b', 'c'].map((p) => ({ nome: p.toUpperCase(), place_id: p })) })
  assert.deepEqual(s.leadsDaBusca(b.id).map((l) => l.enviado), [false, false, false])

  assert.throws(() => s.marcarEnviados(b.id, { place_ids: ['x'], novos: 0 }), /não é desta busca/)
  assert.throws(() => s.marcarEnviados(b.id, { place_ids: ['a'], novos: 2 }), ValidationError)
  assert.throws(() => s.marcarEnviados(b.id, { place_ids: [], novos: 0 }), ValidationError)
  assert.throws(() => s.marcarEnviados(b.id, { place_ids: 'a', novos: 1 }), ValidationError)

  // o que já estava no CRM conta como enviado, mas não como novo
  const r = s.marcarEnviados(b.id, { place_ids: ['a', 'b'], novos: 1, status: 'pendente' })
  assert.equal(r.enviados, 1)
  assert.equal(r.status, 'importado')
  assert.equal('enviados_ids' in r, false)
  assert.equal(s.marcarEnviados(b.id, { place_ids: ['b', 'c'], novos: 1 }).enviados, 2)
  assert.deepEqual(s.leadsDaBusca(b.id).map((l) => l.enviado), [true, true, true])
  assert.deepEqual(createStore(file).leadsDaBusca(b.id).map((l) => l.enviado), [true, true, true])
})

test('a busca sai do PC depois que o resultado foi guardado no CRM online, ou quando falhou; a que está rodando fica', () => {
  const file = arquivo()
  const s = createStore(file)
  const rodando = s.createBusca(validarBusca({ keywords: 'x' }), 'job-1')
  assert.throws(() => s.removerBusca(rodando.id), /rodando/)
  const pronta = s.createBusca(validarBusca({ keywords: 'y' }), 'job-2')
  s.updateBusca(pronta.id, { status: 'importado', encontrados: 1, leads: [{ nome: 'A', place_id: 'a' }] })
  const falhou = s.createBusca(validarBusca({ keywords: 'z' }), 'job-3')
  s.updateBusca(falhou.id, { status: 'falhou', erro: 'o scraper marcou o job como falho' })
  s.removerBusca(pronta.id)
  s.removerBusca(falhou.id)
  assert.deepEqual(createStore(file).listBuscas().itens.map((b) => b.id), [rodando.id])
  assert.throws(() => s.removerBusca(pronta.id), NotFoundError)
})
