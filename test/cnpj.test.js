// Ponte local para a base de CNPJ (src/cnpj.js) com a serialização de parâmetros do postgres.js, o driver usado no Docker
import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { criarCnpj } from '../src/cnpj.js'
import { criarBancoCnpj } from './cnpj-fixture.js'

// O postgres.js pergunta ao servidor o tipo de cada parâmetro e passa json/jsonb por JSON.stringify, mesmo quando o
// valor já é uma string. O PGlite deixa a string como está, então os outros testes não pegam essa diferença.
const comoPostgresJs = (db) => async (sql, params) => {
  const { queryParams } = await db.describeQuery(sql)
  const valores = params.map((v, i) => ([114, 3802].includes(queryParams[i].dataTypeID) ? JSON.stringify(v) : v))
  return (await db.query(sql, valores)).rows
}

let cnpj
before(async () => {
  cnpj = criarCnpj(comoPostgresJs(await criarBancoCnpj()))
})

test('busca manda os filtros como objeto JSON para o banco', async () => {
  const r = await cnpj.rpc('buscar_empresas', { filtros: { municipios: [7107] }, pagina: 1, por_pagina: 5 })
  assert.equal(r.total, 4)
  await assert.rejects(cnpj.rpc('buscar_empresas', { filtros: [1, 2] }), /objeto/)
})

test('detalhe, referências e municípios também passam pelo driver do Docker', async () => {
  assert.equal((await cnpj.rpc('cnpj_detalhe', { p_cnpj: '22222222000103' })).socios.length, 1)
  assert.equal((await cnpj.rpc('cnpj_referencias')).cnaes.length, 4)
  assert.equal((await cnpj.rpc('cnpj_municipios', { p_uf: 'SP' })).length, 2)
})
