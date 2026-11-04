// Roda a migration de verdade num Postgres em memória (PGlite) com dados fictícios no layout da Receita
import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { criarBancoCnpj } from './cnpj-fixture.js'

let db
before(async () => {
  db = await criarBancoCnpj()
})

const buscar = async (filtros, pagina = 1, porPagina = 50) =>
  (await db.query('select public.buscar_empresas($1::jsonb, $2, $3) as r', [JSON.stringify(filtros), pagina, porPagina])).rows[0].r
const cnpjs = async (filtros) => (await buscar(filtros)).itens.map((i) => i.cnpj).sort()

const SORRISO = '11111111000101'
const SORRISO_FILIAL = '11111111000202'
const BOM_PRATO = '22222222000103'
const MEI = '33333333000104'
const INDUSTRIA = '44444444000105'

test('filtra por cidade, bairro (sem acento e sem caixa) e UF', async () => {
  assert.deepEqual(await cnpjs({ municipios: [7107] }), [SORRISO, SORRISO_FILIAL, MEI, INDUSTRIA])
  assert.deepEqual(await cnpjs({ municipios: [7107], bairros: ['vila mariána'] }), [SORRISO, MEI])
  assert.deepEqual(await cnpjs({ municipios: [7107, 6291], bairros: ['centro'] }), [BOM_PRATO])
  assert.deepEqual(await cnpjs({ ufs: ['RJ'] }), [])
})

test('filtra por CNAE principal e, quando pedido, pelo secundário', async () => {
  assert.deepEqual(await cnpjs({ cnaes: [8630504] }), [SORRISO, SORRISO_FILIAL])
  assert.deepEqual(await cnpjs({ cnaes: [8630504], incluir_secundarios: true }), [SORRISO, SORRISO_FILIAL, BOM_PRATO])
})

test('filtra por situação, porte, matriz/filial, Simples, MEI e natureza jurídica', async () => {
  assert.deepEqual(await cnpjs({ situacoes: [2], municipios: [7107] }), [SORRISO, SORRISO_FILIAL, MEI])
  assert.deepEqual(await cnpjs({ situacoes: [4, 8] }), [BOM_PRATO, INDUSTRIA])
  assert.deepEqual(await cnpjs({ portes: [3] }), [BOM_PRATO])
  assert.deepEqual(await cnpjs({ matriz: 'filial' }), [SORRISO_FILIAL])
  assert.deepEqual(await cnpjs({ simples: 'sim' }), [SORRISO, SORRISO_FILIAL, BOM_PRATO, MEI])
  assert.deepEqual(await cnpjs({ mei: 'sim' }), [MEI])
  assert.deepEqual(await cnpjs({ mei: 'nao', simples: 'nao' }), [INDUSTRIA])
  assert.deepEqual(await cnpjs({ naturezas: [2135] }), [MEI])
})

test('filtra por data de abertura e capital social', async () => {
  assert.deepEqual(await cnpjs({ abertura_de: '2015-01-01' }), [SORRISO, SORRISO_FILIAL, MEI])
  assert.deepEqual(await cnpjs({ abertura_ate: '2000-01-01' }), [INDUSTRIA])
  assert.deepEqual(await cnpjs({ capital_min: 100000 }), [BOM_PRATO, INDUSTRIA])
  assert.deepEqual(await cnpjs({ capital_max: 1000 }), [MEI])
})

test('filtra por contato: telefone, celular, e-mail e e-mail de contabilidade', async () => {
  assert.deepEqual(await cnpjs({ com_celular: true }), [SORRISO])
  assert.deepEqual(await cnpjs({ com_telefone: true }), [SORRISO, SORRISO_FILIAL, BOM_PRATO])
  assert.deepEqual(await cnpjs({ com_email: true }), [SORRISO, BOM_PRATO, MEI, INDUSTRIA])
  // BOM_PRATO tem "contabil" no endereço; MEI e INDUSTRIA dividem o mesmo e-mail (limite do teste = 2 empresas)
  assert.deepEqual(await cnpjs({ com_email: true, ocultar_email_contabilidade: true }), [SORRISO])
})

test('filtra por sócio fundador e faixa etária do sócio principal', async () => {
  assert.deepEqual(await cnpjs({ com_socio_fundador: true }), [SORRISO, SORRISO_FILIAL, INDUSTRIA])
  assert.deepEqual(await cnpjs({ faixas_socio: [4] }), [SORRISO, SORRISO_FILIAL])
  assert.deepEqual(await cnpjs({ faixas_socio: [6] }), [BOM_PRATO])
})

test('devolve os campos da listagem já tratados e pagina', async () => {
  const r = await buscar({ cnaes: [8630504] })
  const s = r.itens.find((i) => i.cnpj === SORRISO)
  assert.equal(s.razao_social, 'CLINICA SORRISO LTDA')
  assert.equal(s.cnae_descricao, 'Atividade odontológica')
  assert.equal(s.municipio_nome, 'SAO PAULO')
  assert.equal(s.data_inicio, '2015-03-10')
  assert.equal(s.capital_social, 50000)
  assert.deepEqual(s.telefones, [{ numero: '11987654321', tipo: 'celular' }])
  assert.equal(s.email_contabilidade, false)
  const p = await buscar({ municipios: [7107] }, 2, 3)
  assert.equal(p.total, 4)
  assert.equal(p.itens.length, 1)
})

test('aguenta data e CNAE vazios ou inválidos vindos da Receita', async () => {
  const [r] = (await buscar({ naturezas: [2054] })).itens
  assert.equal(r.cnpj, INDUSTRIA)
  assert.equal(r.data_situacao, null)
})

test('rejeita paginação abusiva e filtro mal formado', async () => {
  await assert.rejects(buscar({}, 1, 500), /por_pagina/)
  await assert.rejects(db.query(`select public.buscar_empresas('[1,2]'::jsonb)`), /objeto/)
})

test('detalhe traz sócios e atividades secundárias', async () => {
  const d = (await db.query('select public.cnpj_detalhe($1) as r', [BOM_PRATO])).rows[0].r
  assert.deepEqual(
    d.cnaes_secundarios.map((c) => c.codigo),
    [4721102, 8630504],
  )
  assert.equal(d.socios.length, 1)
  assert.equal(d.socios[0].qualificacao, 'Sócio-Administrador')
  assert.equal(d.socios[0].faixa_etaria, '51 a 60 anos')
  assert.equal((await db.query(`select public.cnpj_detalhe('00000000000000') as r`)).rows[0].r, null)
})

test('referências para montar os filtros na tela', async () => {
  const r = (await db.query('select public.cnpj_referencias() as r')).rows[0].r
  assert.equal(r.cnaes.length, 4)
  assert.equal(r.carga.mes_referencia, '2026-10')
  const m = (await db.query(`select public.cnpj_municipios('SP') as r`)).rows[0].r
  assert.deepEqual(m, [
    { codigo: 6291, nome: 'CAMPINAS', uf: 'SP' },
    { codigo: 7107, nome: 'SAO PAULO', uf: 'SP' },
  ])
  // sem estado: todas as cidades que têm empresa na base, para digitar a cidade direto
  assert.equal((await db.query('select public.cnpj_municipios(null) as r')).rows[0].r.length, 2)
  await assert.rejects(db.query(`select public.cnpj_municipios('São Paulo')`), /uf inválida/)
})

test('anon não executa as funções; authenticated executa', async () => {
  await db.exec('set role anon')
  await assert.rejects(db.query(`select public.buscar_empresas('{}'::jsonb)`), /permission denied/)
  await db.exec('reset role; set role authenticated')
  assert.equal((await db.query(`select public.buscar_empresas('{}'::jsonb) as r`)).rows[0].r.total, 5)
  await assert.rejects(db.query('select * from cnpj.estabelecimentos'), /permission denied/)
  await db.exec('reset role')
})

test('montagem descarta linhas repetidas da Receita (estabelecimento, empresa e Simples)', async () => {
  const banco = await criarBancoCnpj()
  const repetir = (tabela, onde) => banco.query(`insert into cnpj_carga.${tabela} select * from cnpj_carga.${tabela} where ${onde}`)
  await repetir('estabelecimentos_raw', `cnpj_basico = '11111111' and cnpj_ordem = '0002'`)
  await repetir('empresas_raw', `cnpj_basico = '22222222'`)
  await repetir('simples_raw', `cnpj_basico = '33333333'`)
  await repetir('socios_raw', `cnpj_basico = '11111111'`)
  await banco.query(`select cnpj_carga.montar('cnpj_novo', null, 2)`)
  await banco.query(`select cnpj_carga.publicar('cnpj_novo', '2026-11')`)
  const linhas = (await banco.query('select cnpj, razao_social, mei from cnpj.estabelecimentos order by cnpj')).rows
  assert.deepEqual(linhas.map((l) => l.cnpj), [SORRISO, SORRISO_FILIAL, BOM_PRATO, MEI, INDUSTRIA])
  assert.equal(linhas.find((l) => l.cnpj === MEI).mei, true)
  assert.equal((await banco.query(`select count(*)::int as n from cnpj.socios where cnpj_basico = '11111111'`)).rows[0].n, 2)
  // toda tabela da base nasce com RLS ligada (o acesso é só pelas funções public.*)
  const semRls = (await banco.query(`select relname from pg_class where relnamespace = 'cnpj'::regnamespace and relkind = 'r' and not relrowsecurity`)).rows
  assert.deepEqual(semRls, [])
})

test('com estados escolhidos, empresas de fora não entram na montagem', async () => {
  const banco = await criarBancoCnpj()
  await banco.query(`insert into cnpj_carga.empresas_raw values ('55555555', 'EMPRESA SEM ESTABELECIMENTO EM SP', '2062', '49', '1,00', '01', '')`)
  await banco.query(`select cnpj_carga.montar('cnpj_novo', array['SP'], 2)`)
  await banco.query(`select cnpj_carga.publicar('cnpj_novo', '2026-11')`)
  assert.equal((await banco.query('select count(*)::int as n from cnpj.estabelecimentos')).rows[0].n, 5)
})

test('nova carga troca a base e guarda a anterior para rollback', async () => {
  await db.query(`select cnpj_carga.montar('cnpj_novo', array['RJ'], 2)`)
  await db.query(`select cnpj_carga.publicar('cnpj_novo', '2026-11')`)
  assert.equal((await buscar({})).total, 0)
  await db.query('select cnpj_carga.reverter()')
  assert.equal((await buscar({})).total, 5)
})
