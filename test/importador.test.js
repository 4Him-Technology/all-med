import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { PLANO, conteudoZip, filtroUf, meses, semNulos } from '../importador/receita.js'

// zip de um arquivo só, como os da Receita: cabeçalho local, dados deflate, diretório central no fim
function zipUnico(nome, conteudo) {
  const dados = deflateRawSync(conteudo)
  const n = Buffer.from(nome)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 6) // bit 3: tamanhos no descritor depois dos dados
  local.writeUInt16LE(8, 8) // deflate
  local.writeUInt16LE(n.length, 26)
  const descritor = Buffer.alloc(16)
  descritor.writeUInt32LE(0x08074b50, 0)
  const central = Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02]), Buffer.alloc(42), n, Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)])
  return Buffer.concat([local, n, dados, descritor, central])
}

const pedacos = (buf, tam) => Readable.from(Array.from({ length: Math.ceil(buf.length / tam) }, (_, i) => buf.subarray(i * tam, (i + 1) * tam)))
const juntar = async (iteravel) => {
  const partes = []
  for await (const p of iteravel) partes.push(p)
  return Buffer.concat(partes)
}

test('descompacta o zip da Receita em streaming, mesmo chegando aos pedaços', async () => {
  const csv = Buffer.from('"1";"Cultivo de arroz"\n"2";"Cultivo de milho"\n'.repeat(500), 'latin1')
  assert.deepEqual(await juntar(conteudoZip(pedacos(zipUnico('F.K03200$Z.D61010.CNAECSV', csv), 7))), csv)
})

test('recusa arquivo que não é zip', async () => {
  await assert.rejects(juntar(conteudoZip(Readable.from([Buffer.from('<html>erro</html>'.repeat(5))]))), /não é um arquivo zip/)
})

test('tira bytes nulos, que o Postgres recusa no COPY', async () => {
  const saida = await juntar(Readable.from([Buffer.from([0x41, 0x00, 0x42]), Buffer.from([0x00])]).pipe(semNulos()))
  assert.equal(saida.toString(), 'AB')
})

test('filtro de UF mantém só as linhas dos estados pedidos, mesmo com linha partida entre pedaços', async () => {
  const linha = (uf) => `"11111111";"0001";"01";"1";"X";"02";"20200101";"00";"";"";"20200101";"8630504";"";"RUA";"A";"1";"";"CENTRO";"01000000";"${uf}";"7107";"";"";"";"";"";"";"";"";""\n`
  const txt = Buffer.from(linha('SP') + linha('RJ') + linha('MG') + linha('SP'), 'latin1')
  const saida = []
  await pipeline(pedacos(txt, 50), filtroUf(['SP', 'MG']), async (src) => {
    for await (const p of src) saida.push(p)
  })
  const ufs = Buffer.concat(saida).toString('latin1').trim().split('\n').map((l) => l.split('";"')[19])
  assert.deepEqual(ufs, ['SP', 'MG', 'SP'])
})

test('lê os meses disponíveis na listagem WebDAV da Receita', () => {
  const xml = ['2026-09', '2023-05', '2026-10'].map((m) => `<d:response><d:href>/public.php/dav/files/abc/${m}/</d:href></d:response>`).join('') + '<d:href>/public.php/dav/files/abc/cnpj.tar.gz</d:href>'
  assert.deepEqual(meses(xml), ['2023-05', '2026-09', '2026-10'])
})

test('plano de carga cobre todos os arquivos usados e começa pelos estabelecimentos', () => {
  assert.equal(PLANO[0].arquivo, 'Estabelecimentos0.zip')
  assert.equal(PLANO.filter((p) => p.tabela === 'estabelecimentos_raw').length, 10)
  assert.equal(PLANO.filter((p) => p.tabela === 'socios_raw').length, 10)
  assert.equal(PLANO.filter((p) => p.tabela === 'empresas_raw').length, 10)
  for (const t of ['simples_raw', 'cnaes_raw', 'naturezas_raw', 'municipios_raw', 'qualificacoes_raw']) {
    assert.equal(PLANO.filter((p) => p.tabela === t).length, 1, t)
  }
})
