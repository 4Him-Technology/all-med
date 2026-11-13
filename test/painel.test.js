// Contas e textos da aba Painel, sem DOM (os números vêm prontos do banco: public.painel_gerencial)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { comparar, conversoes, duracao, grade, nivel, PERIODOS, periodo, rotuloBalde, semContato, taxa } from '../public/painel.js'

const agora = new Date(2026, 10, 12, 15, 30) // 12/11/2026 15:30, hora local

test('período: começa à meia-noite de N-1 dias atrás e vai até agora; "Desde o começo" não tem início', () => {
  assert.deepEqual(Object.keys(PERIODOS), ['7', '30', '90', '365', 'tudo'])
  assert.equal(PERIODOS['7'].frase, 'nos últimos 7 dias')
  assert.equal(periodo('7', agora).de, new Date(2026, 10, 6).toISOString())
  assert.equal(periodo('30', agora).de, new Date(2026, 9, 14).toISOString())
  assert.equal(periodo('7', agora).ate, null)
  assert.equal(periodo('tudo', agora).de, null)
  // chave desconhecida (link velho, endereço digitado) cai nos 30 dias
  assert.equal(periodo('abc', agora).chave, '30')
})

test('comparação com o período anterior em número absoluto, porque com poucos leads a porcentagem engana; o texto é curto', () => {
  assert.deepEqual(comparar(48, 36), { sentido: 'subiu', texto: '12 a mais' })
  assert.deepEqual(comparar(1, 3), { sentido: 'caiu', texto: '2 a menos' })
  assert.deepEqual(comparar(5, 5), { sentido: 'igual', texto: 'igual' })
  assert.equal(comparar(5, undefined), null)
})

test('conversão de uma etapa para a seguinte; etapa anterior vazia não tem taxa', () => {
  const etapas = [{ status: 'novo', leads: 10 }, { status: 'contato', leads: 4 }, { status: 'qualificado', leads: 0 }, { status: 'proposta', leads: 0 }]
  assert.deepEqual(conversoes(etapas).map((e) => e.taxa), [null, 0.4, 0, null])
  assert.equal(taxa(1, 3), '33%')
  assert.equal(taxa(0, 0), null)
  assert.equal(taxa(2, 2000), '0,1%')
})

test('duração em horas até 2 dias, depois em dias', () => {
  assert.equal(duracao(0.4), 'menos de 1 h')
  assert.equal(duracao(16.5), '17 h')
  assert.equal(duracao(47.9), '48 h')
  assert.equal(duracao(60), '2,5 dias')
  assert.equal(duracao(null), null)
})

test('lead parado: há quantos dias sem contato, ou que nunca teve contato', () => {
  assert.equal(semContato({ dias: 1, nunca: false }), '1 dia sem contato')
  assert.equal(semContato({ dias: 63, nunca: false }), '63 dias sem contato')
  assert.equal(semContato({ dias: 9, nunca: true }), 'nunca teve contato, entrou há 9 dias')
})

test('rótulo do dia, da semana ou do mês no eixo do gráfico', () => {
  assert.equal(rotuloBalde('2026-09-08', 'day'), '08/09')
  assert.equal(rotuloBalde('2026-09-07', 'week'), 'sem. 07/09')
  assert.equal(rotuloBalde('2026-09-01', 'month'), 'set/26')
})

test('mapa de calor: zero fica sem cor; o resto vai do tom 1 ao 5 pela parte do maior valor', () => {
  assert.deepEqual([0, 1, 2, 5, 10].map((v) => nivel(v, 10)), [0, 1, 1, 3, 5])
  assert.equal(nivel(3, 0), 0)
  // acima do maior (célula pequena que ficou fora da referência) fica no tom mais escuro
  assert.equal(nivel(20, 10), 5)
})

test('ritmo: as células do banco viram uma grade de 7 dias (segunda a domingo) por 24 horas', () => {
  const g = grade([{ dia: 1, hora: 9, contatos: 3 }, { dia: 7, hora: 23, contatos: 1 }])
  assert.deepEqual([g.length, g.every((d) => d.length === 24)], [7, true])
  assert.deepEqual([g[0][9], g[6][23], g[0][10], g[3][9]], [3, 1, 0, 0])
})
