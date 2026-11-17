import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buscaMaps, camposLead, empresaInicial, mensagemErro, resumoBusca, termoBusca, ultimoContato } from '../public/campos.js'

test('empresa depois do login: o membro entra direto na dele; o administrador escolhe, a não ser que já tenha escolhido nesta aba', () => {
  const allMed = { id: 'a', nome: 'All Med', deleted_at: null }
  const b = { id: 'b', nome: 'Empresa B', deleted_at: null }
  const excluida = { id: 'c', nome: 'Empresa C', deleted_at: '2026-11-16T12:00:00Z' }
  // o membro não escolhe nada, nem com uma escolha de outra conta guardada na aba
  assert.deepEqual(empresaInicial({ empresas: [allMed], admin: false, guardada: 'b' }), { empresa: allMed, opcoes: [] })
  // membro de empresa excluída (o banco não devolve nenhuma): nem entra nem escolhe
  assert.deepEqual(empresaInicial({ empresas: [], admin: false, guardada: null }), { empresa: null, opcoes: [] })
  // o administrador vê os botões sempre, mesmo com uma empresa só; a excluída não aparece
  assert.deepEqual(empresaInicial({ empresas: [allMed], admin: true, guardada: null }), { empresa: null, opcoes: [allMed] })
  assert.deepEqual(empresaInicial({ empresas: [allMed, b, excluida], admin: true, guardada: null }), { empresa: null, opcoes: [allMed, b] })
  assert.deepEqual(empresaInicial({ empresas: [allMed, b], admin: true, guardada: 'b' }), { empresa: b, opcoes: [allMed, b] })
  // a escolha guardada de uma empresa excluída não vale: volta para os botões
  assert.deepEqual(empresaInicial({ empresas: [allMed, b, excluida], admin: true, guardada: 'c' }), { empresa: null, opcoes: [allMed, b] })
  // quem recebe mais de uma empresa escolhe, mesmo sem o papel de administrador carregado: nunca cai na primeira sem ver
  assert.deepEqual(empresaInicial({ empresas: [allMed, b], admin: false, guardada: null }), { empresa: null, opcoes: [allMed, b] })
})

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

test('resumo do cartão da busca; só a busca em andamento precisa da hora de início', () => {
  assert.equal(resumoBusca({ status: 'importado', encontrados: 12, enviados: 3 }), '12 encontradas · 3 no kanban')
  assert.equal(resumoBusca({ status: 'importado', encontrados: 1, enviados: 0 }), '1 encontrada')
  assert.equal(resumoBusca({ status: 'importado', encontrados: 0, enviados: 0 }), 'nenhuma empresa encontrada')
  assert.equal(resumoBusca({ status: 'pendente', created_at: '2026-11-10T13:05:00Z' }), 'esperando a vez')
  assert.equal(resumoBusca({ status: 'falhou', created_at: '2026-11-10T13:05:00Z' }), 'a busca parou com erro')
  assert.match(resumoBusca({ status: 'executando', created_at: '2026-11-10T13:05:00Z' }), /^começou às \d{2}:\d{2}$/)
})

test('traduz os erros do banco para mensagens da tela', () => {
  assert.equal(mensagemErro({ code: '23505' }), 'Essa empresa já está no CRM')
  assert.equal(mensagemErro({ code: 'XX', message: 'outro' }), 'outro')
})
