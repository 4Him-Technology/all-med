// Leitura dos arquivos de dados abertos do CNPJ publicados pela Receita (compartilhamento público SERPRO+)
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream'
import { createInflateRaw } from 'node:zlib'

export const BASE_URL = process.env.RECEITA_URL ?? 'https://arquivos.receitafederal.gov.br/public.php/dav/files/YggdBLfdninEJX9'

const dez = (prefixo, tabela) => Array.from({ length: 10 }, (_, i) => ({ arquivo: `${prefixo}${i}.zip`, tabela }))

// Estabelecimentos primeiro: é o maior e o único filtrado por UF, então falha cedo se algo estiver errado
export const PLANO = [
  ...dez('Estabelecimentos', 'estabelecimentos_raw'),
  ...dez('Empresas', 'empresas_raw'),
  { arquivo: 'Simples.zip', tabela: 'simples_raw' },
  ...dez('Socios', 'socios_raw'),
  { arquivo: 'Cnaes.zip', tabela: 'cnaes_raw' },
  { arquivo: 'Naturezas.zip', tabela: 'naturezas_raw' },
  { arquivo: 'Municipios.zip', tabela: 'municipios_raw' },
  { arquivo: 'Qualificacoes.zip', tabela: 'qualificacoes_raw' },
]

export const meses = (xml) => [...xml.matchAll(/<d:href>[^<]*\/(\d{4}-\d{2})\/<\/d:href>/g)].map((m) => m[1]).sort()

export async function ultimoMes() {
  const res = await fetch(`${BASE_URL}/`, { method: 'PROPFIND', headers: { Depth: '1' } })
  if (!res.ok) throw new Error(`listagem da Receita respondeu ${res.status}`)
  const lista = meses(await res.text())
  if (!lista.length) throw new Error('nenhum mês encontrado na listagem da Receita')
  return lista.at(-1)
}

// Cada .zip da Receita tem um único CSV. Lê o cabeçalho local e infla o resto (deflate cru) em streaming,
// sem gravar nada em disco; os tamanhos do cabeçalho não são usados, então zip64 e descritor no fim funcionam.
export async function* conteudoZip(origem) {
  const it = origem[Symbol.asyncIterator]()
  let buf = Buffer.alloc(0)
  const ler = async (n) => {
    while (buf.length < n) {
      const { value, done } = await it.next()
      if (done) throw new Error('arquivo zip incompleto')
      buf = Buffer.concat([buf, value])
    }
  }
  await ler(30)
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('não é um arquivo zip')
  if (buf.readUInt16LE(8) !== 8) throw new Error('zip sem compressão deflate não é suportado')
  const inicio = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28)
  await ler(inicio)
  const resto = buf.subarray(inicio)
  async function* bruto() {
    if (resto.length) yield resto
    for (;;) {
      const { value, done } = await it.next()
      if (done) return
      yield value
    }
  }
  yield* pipeline(Readable.from(bruto()), createInflateRaw(), () => {})
}

// Alguns arquivos trazem byte 0x00 no meio do texto, que o Postgres recusa
export const semNulos = () =>
  new Transform({
    transform(chunk, _enc, cb) {
      cb(null, chunk.includes(0) ? Buffer.from(chunk.filter((b) => b !== 0)) : chunk)
    },
  })

// Mantém só as linhas de estabelecimentos das UFs pedidas, antes de mandar para o banco.
// shortcut: separa campos por '";"' (todo campo da Receita vem entre aspas); quebraria se um campo trouxesse '";"' dentro
export function filtroUf(ufs) {
  const aceitas = new Set(ufs)
  let sobra = ''
  const filtrar = (texto) =>
    texto
      .split('\n')
      .filter((l) => l && aceitas.has(l.split('";"')[19]))
      .map((l) => `${l}\n`)
      .join('')
  return new Transform({
    transform(chunk, _enc, cb) {
      const texto = sobra + chunk.toString('latin1')
      const corte = texto.lastIndexOf('\n')
      sobra = texto.slice(corte + 1)
      cb(null, Buffer.from(filtrar(texto.slice(0, corte + 1)), 'latin1'))
    },
    flush(cb) {
      cb(null, Buffer.from(filtrar(sobra), 'latin1'))
    },
  })
}
