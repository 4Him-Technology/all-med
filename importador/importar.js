// Carga mensal da base de CNPJ da Receita num Postgres (Supabase ou outro) que já tenha a migration aplicada.
//
//   DATABASE_URL=postgres://... node importador/importar.js [--mes 2026-10] [--ufs SP,RJ] [--min-empresas-email 5]
//
// Use a conexão direta ou o session pooler (porta 5432): o transaction pooler não aceita COPY.
// Baixa e descompacta em streaming, sem gravar em disco. Os dados descompactados passam de 25 GB,
// então rode perto do banco (um servidor ou um job agendado), não numa conexão doméstica.
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as esperar } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import postgres from 'postgres'
import { BASE_URL, PLANO, conteudoZip, filtroUf, semNulos, ultimoMes } from './receita.js'

const { values } = parseArgs({
  options: { mes: { type: 'string' }, ufs: { type: 'string' }, 'min-empresas-email': { type: 'string', default: '5' } },
})

function falhar(msg) {
  console.error(msg)
  process.exit(1)
}

if (!process.env.DATABASE_URL) falhar('Defina DATABASE_URL com a conexão do Postgres.')
const ufs = values.ufs ? values.ufs.split(',').map((u) => u.trim().toUpperCase()) : null
if (ufs?.some((u) => !/^[A-Z]{2}$/.test(u))) falhar('--ufs deve ser uma lista de siglas, ex.: SP,RJ')
const minEmail = Number(values['min-empresas-email'])
if (!Number.isInteger(minEmail) || minEmail < 2) falhar('--min-empresas-email deve ser um inteiro a partir de 2')

const mes = values.mes ?? (await ultimoMes())
if (!/^\d{4}-\d{2}$/.test(mes)) falhar('--mes deve estar no formato AAAA-MM')

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  onnotice: () => {},
  connection: { statement_timeout: 0, application_name: 'importador-cnpj' },
})

async function carregar({ arquivo, tabela }, tentativas = 3) {
  for (let t = 1; ; t++) {
    try {
      const res = await fetch(`${BASE_URL}/${mes}/${arquivo}`)
      if (!res.ok) throw new Error(`download respondeu ${res.status}`)
      // tabela vem da lista fixa PLANO, nunca de entrada externa
      const destino = await sql.unsafe(`copy cnpj_carga.${tabela} from stdin with (format csv, delimiter ';', quote '"', encoding 'LATIN1')`).writable()
      const etapas = [Readable.fromWeb(res.body), (src) => conteudoZip(src), semNulos()]
      if (ufs && tabela === 'estabelecimentos_raw') etapas.push(filtroUf(ufs))
      // COPY é atômico: se o download cair no meio, nada desse arquivo fica gravado e dá para tentar de novo
      await pipeline(...etapas, destino)
      return
    } catch (err) {
      if (t >= tentativas) throw new Error(`${arquivo}: ${err.message}`)
      console.warn(`${arquivo}: tentativa ${t} falhou (${err.message}), tentando de novo`)
      await esperar(5000 * 2 ** (t - 1))
    }
  }
}

try {
  console.info(`Carga de ${mes}, ${ufs ? `UFs ${ufs.join(', ')}` : 'Brasil inteiro'}`)
  await sql`select cnpj_carga.criar_staging()`
  for (const item of PLANO) {
    const inicio = Date.now()
    await carregar(item)
    console.info(`${item.arquivo} carregado em ${Math.round((Date.now() - inicio) / 1000)} s`)
  }
  console.info('Montando a base final (pode levar horas no Brasil inteiro)...')
  const [{ linhas }] = await sql`select cnpj_carga.montar('cnpj_novo', ${ufs}::text[], ${minEmail}) as linhas`
  await sql`select cnpj_carga.publicar('cnpj_novo', ${mes})`
  await sql`select cnpj_carga.criar_staging()` // esvazia as tabelas de chegada
  console.info(`Publicado: ${linhas} estabelecimentos de ${mes}. Para voltar ao mês anterior: select cnpj_carga.reverter();`)
} catch (err) {
  console.error(`Carga interrompida, a base publicada continua a anterior. ${err.message}`)
  process.exitCode = 1
} finally {
  await sql.end()
}
