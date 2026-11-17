import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buscaMaps, camposLead, empresaInicial, exclusaoEmpresa, mensagemErro, quemPerdeAcesso, resumoBusca, termoBusca, ultimoContato } from '../public/campos.js'

test('excluir empresa: só a empresa aberta agora, e nunca a única ativa', () => {
  const allMed = { id: 'a', nome: 'All Med', deleted_at: null }
  const b = { id: 'b', nome: 'Empresa B', deleted_at: null }
  const excluida = { id: 'c', nome: 'Empresa C', deleted_at: '2026-11-16T12:00:00Z' }
  const entrar = { motivo: 'Para excluir uma empresa, entre nela e abra esta janela de novo.' }
  // dentro da Empresa B, com outra ativa: pode, com o nome que está no banco agora (renomeada na mesma janela)
  assert.deepEqual(exclusaoEmpresa({ empresas: [allMed, { ...b, nome: 'Clínica B' }], atualId: 'b' }), { empresa: { ...b, nome: 'Clínica B' } })
  // na tela de escolha (nenhuma aberta) não há o que excluir: só o aviso, sem botão
  assert.deepEqual(exclusaoEmpresa({ empresas: [allMed, b], atualId: null }), entrar)
  // a única ativa não sai: sem nenhuma, ninguém entra no sistema
  assert.deepEqual(exclusaoEmpresa({ empresas: [allMed, excluida], atualId: 'a' }), { motivo: 'All Med é a única empresa ativa e não pode ser excluída.' })
  // a aberta foi excluída por outro administrador enquanto isso: não oferece de novo
  assert.deepEqual(exclusaoEmpresa({ empresas: [allMed, b, excluida], atualId: 'c' }), entrar)
})

test('excluir empresa: a confirmação conta quem perde o acesso (membro ativo; o administrador segue nas outras)', () => {
  const admin = { papel: 'admin', ativo: true }
  const membro = { papel: 'membro', ativo: true }
  const desativado = { papel: 'membro', ativo: false }
  assert.equal(quemPerdeAcesso([admin, membro, membro, desativado]), '2 pessoas da equipe dela perdem o acesso ao sistema na hora.')
  assert.equal(quemPerdeAcesso([admin, membro]), '1 pessoa da equipe dela perde o acesso ao sistema na hora.')
  assert.equal(quemPerdeAcesso([admin, desativado]), 'Ninguém perde o acesso: ela não tem membros ativos.')
  // a equipe não carregou: a frase não inventa número
  assert.equal(quemPerdeAcesso(null), 'Quem é dela perde o acesso ao sistema na hora.')
})

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
