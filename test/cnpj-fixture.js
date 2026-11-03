// Banco Postgres em memória com a migration aplicada e dados fictícios no layout dos arquivos da Receita.
// Usado nos testes e pelo servidor local de demonstração (sem nome nem documento de pessoa real).
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS = new URL('../db-local/migrations/', import.meta.url)

const lookups = {
  cnaes_raw: [
    ['8630504', 'Atividade odontológica'],
    ['5620104', 'Fornecimento de alimentos preparados preponderantemente para consumo domiciliar'],
    ['4721102', 'Padaria e confeitaria com predominância de revenda'],
    ['6920601', 'Atividades de contabilidade'],
  ],
  naturezas_raw: [
    ['2062', 'Sociedade Empresária Limitada'],
    ['2135', 'Empresário (Individual)'],
    ['2054', 'Sociedade Anônima Fechada'],
  ],
  municipios_raw: [
    ['7107', 'SAO PAULO'],
    ['6291', 'CAMPINAS'],
  ],
  qualificacoes_raw: [
    ['49', 'Sócio-Administrador'],
    ['22', 'Sócio'],
  ],
}

const empresas = [
  ['11111111', 'CLINICA SORRISO LTDA', '2062', '49', '50000,00', '01', ''],
  ['22222222', 'RESTAURANTE BOM PRATO LTDA', '2062', '49', '200000,00', '03', ''],
  ['33333333', 'EMPRESARIO EXEMPLO MEI', '2135', '50', '1000,00', '01', ''],
  ['44444444', 'INDUSTRIA EXEMPLO S.A.', '2054', '10', '10000000,00', '05', ''],
]

const simples = [
  ['11111111', 'S', '20150310', '', 'N', '', ''],
  ['22222222', 'S', '20101010', '', 'N', '', ''],
  ['33333333', 'S', '20220505', '', 'S', '20220505', ''],
  ['44444444', 'N', '', '', 'N', '', ''],
]

const socios = [
  ['11111111', '2', 'SOCIA FICTICIA A', '***111111**', '49', '20150310', '', '', '', '', '4'],
  ['11111111', '2', 'SOCIO FICTICIO B', '***222222**', '22', '20180101', '', '', '', '', '3'],
  ['22222222', '2', 'SOCIA FICTICIA C', '***333333**', '49', '20190101', '', '', '', '', '6'],
  ['44444444', '1', 'HOLDING FICTICIA S.A.', '99999999000199', '22', '19900101', '', '', '', '', '0'],
]

// cnpj_basico, ordem, dv, matriz(1)/filial(2), fantasia, situação, data situação, início, cnae, secundários, bairro, cep, uf, município, ddd1, tel1, ddd2, tel2, email
const est = (b, o, dv, ident, fantasia, sit, dataSit, inicio, cnae, sec, bairro, cep, uf, mun, ddd1, tel1, ddd2, tel2, email) => [
  b, o, dv, ident, fantasia, sit, dataSit, '00', '', '', inicio, cnae, sec, 'RUA', 'EXEMPLO', '100', '', bairro, cep, uf, mun, ddd1, tel1, ddd2, tel2, '', '', email, '', '',
]
const estabelecimentos = [
  est('11111111', '0001', '01', '1', 'SORRISO', '02', '20150310', '20150310', '8630504', '', 'VILA MARIANA', '04101000', 'SP', '7107', '11', '987654321', '', '', 'contato@sorriso.com.br'),
  est('11111111', '0002', '02', '2', 'SORRISO MOEMA', '02', '20200101', '20200101', '8630504', '', 'MOEMA', '04077000', 'SP', '7107', '11', '33334444', '', '', ''),
  est('22222222', '0001', '03', '1', 'BOM PRATO', '04', '20230101', '20101010', '5620104', '8630504,4721102', 'Centro', '13010000', 'SP', '6291', '19', '32323232', '19', '32323232', 'fiscal@contabilxyz.com.br'),
  est('33333333', '0001', '04', '1', '', '02', '20220505', '20220505', '5620104', '', 'Vila Mariana', '04101001', 'SP', '7107', '', '', '', '', 'Contato@Compartilhado.com'),
  est('44444444', '0001', '05', '1', 'INDUSTRIA', '08', '00000000', '19900101', '6920601', '', 'CENTRO INDUSTRIAL', '', 'SP', '7107', '', '', '', '', 'contato@compartilhado.com'),
]

export async function criarBancoCnpj() {
  const db = new PGlite()
  // papéis que o Supabase já traz prontos
  await db.exec('create role anon nologin; create role authenticated nologin;')
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'))
  }
  await db.query('select cnpj_carga.criar_staging()')
  const inserir = async (tabela, linhas) => {
    for (const l of linhas) {
      await db.query(`insert into cnpj_carga.${tabela} values (${l.map((_, i) => `$${i + 1}`).join(',')})`, l)
    }
  }
  for (const [tabela, linhas] of Object.entries(lookups)) await inserir(tabela, linhas)
  await inserir('empresas_raw', empresas)
  await inserir('simples_raw', simples)
  await inserir('socios_raw', socios)
  await inserir('estabelecimentos_raw', estabelecimentos)
  // limite de 2 empresas por e-mail só para o teste; o padrão de produção é 5
  await db.query(`select cnpj_carga.montar('cnpj_novo', null, 2)`)
  await db.query(`select cnpj_carga.publicar('cnpj_novo', '2026-10')`)
  return db
}
