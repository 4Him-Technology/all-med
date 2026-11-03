import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buscaMaps, camposLead, mensagemErro, termoBusca, ultimoContato } from '../public/campos.js'

test('converte o formulário para as colunas do Supabase', () => {
  assert.deepEqual(camposLead({ nome: ' Clínica ', site: '', emails: 'a@b.com, ,c@d.com', temperatura: '' }), {
    nome: 'Clínica',
    site: null,
    emails: ['a@b.com', 'c@d.com'],
    temperatura: null,
  })
})

test('limpa o termo de busca antes de montar o filtro do PostgREST', () => {
  assert.equal(termoBusca('dentista,nome.eq.x)'), 'dentista nome.eq.x')
  assert.equal(termoBusca('100%*'), '100')
  assert.equal(termoBusca(null), '')
})

test('último contato: hoje com a hora, ontem, a data, ou nada', () => {
  const agora = new Date(2026, 9, 28, 15, 0)
  assert.equal(ultimoContato(new Date(2026, 9, 28, 9, 12).toISOString(), agora), 'hoje, 09:12')
  assert.equal(ultimoContato(new Date(2026, 9, 27, 23, 50).toISOString(), agora), 'ontem')
  assert.equal(ultimoContato(new Date(2026, 9, 25, 10, 0).toISOString(), agora), '25/10/2026')
  assert.equal(ultimoContato(null, agora), null)
})

test('busca do Maps: cada ramo vira um termo na cidade, com o bairro quando houver', () => {
  assert.deepEqual(buscaMaps({ ramos: ' dentista, clínica odontológica,, dentista ', cidade: ' Campinas - SP ', bairro: '' }), {
    nome: 'dentista, clínica odontológica · Campinas - SP',
    keywords: ['dentista em Campinas - SP', 'clínica odontológica em Campinas - SP'],
  })
  assert.deepEqual(buscaMaps({ ramos: 'ortopedista', cidade: 'São José do Rio Preto - SP', bairro: 'Centro' }).keywords, [
    'ortopedista em Centro, São José do Rio Preto - SP',
  ])
})

test('traduz os erros do banco para mensagens da tela', () => {
  assert.equal(mensagemErro({ code: '23505' }), 'Essa empresa já está no CRM')
  assert.equal(mensagemErro({ code: 'XX', message: 'outro' }), 'outro')
})
