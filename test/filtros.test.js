import assert from 'node:assert/strict'
import { test } from 'node:test'
import { etiquetasDosFiltros } from '../public/filtros.js'

const nomes = {
  municipios: new Map([['6291', 'Campinas - SP']]),
  cnaes: new Map([['8630504', '8630-5/04 Atendimento odontológico']]),
  naturezas: new Map([['2062', 'Sociedade Empresária Limitada']]),
}

test('cada filtro ligado vira uma etiqueta, na ordem dos grupos da barra', () => {
  const f = {
    ufs: ['SP'],
    municipios: ['6291'],
    bairros: ['Centro'],
    cnaes: ['8630504'],
    incluir_secundarios: true,
    situacoes: [2],
    portes: [1],
    naturezas: ['2062'],
    mei: 'nao',
    abertura_de: '2020-01-31',
    capital_min: 10000,
    com_celular: true,
    faixas_socio: [4],
  }
  assert.deepEqual(
    etiquetasDosFiltros(f, nomes).map((e) => e.rotulo.replace(/\s/g, ' ')),
    [
      'SP',
      'Campinas - SP',
      'Bairro Centro',
      '8630-5/04 Atendimento odontológico',
      'Inclui atividade secundária',
      'Ativa',
      'Microempresa',
      'Sociedade Empresária Limitada',
      'Sem MEI',
      'Aberta desde 31/01/2020',
      'Capital a partir de R$ 10.000',
      'Somente com celular',
      'Sócio de 31 a 40',
    ],
  )
})

test('a etiqueta guarda o campo e o valor, para o x desligar só aquele filtro', () => {
  const [cidade, situacao, contato] = etiquetasDosFiltros({ municipios: ['6291'], situacoes: [3], com_email: true }, nomes)
  assert.deepEqual(cidade, { rotulo: 'Campinas - SP', campo: 'municipios', valor: '6291' })
  assert.deepEqual(situacao, { rotulo: 'Suspensa', campo: 'situacoes', valor: '3' })
  assert.deepEqual(contato, { rotulo: 'Somente com e-mail', campo: 'contato', valor: 'com_email' })
})

test('sem filtro ligado não há etiqueta, e código sem nome conhecido aparece cru', () => {
  assert.deepEqual(etiquetasDosFiltros({}, nomes), [])
  assert.equal(etiquetasDosFiltros({ cnaes: ['9999999'] }, nomes)[0].rotulo, '9999999')
})
