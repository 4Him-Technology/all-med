// Reconhecimento do cliente ativo pelo nome. Todos os nomes aqui são inventados: o repositório é público
// e a lista de clientes não pode aparecer nele.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clienteDe, parecidoCom, prepararClientes } from '../public/clientes.js'

const lista = prepararClientes(
  [
    'Construtora Pedra Lisa Ltda',
    'Incorporadora Brisa Ltda',
    'Transportes Vento Sul Ltda',
    'Viação Lua Cheia Ltda - Pirituba',
    'Alimentos Serra Azul Ltda - Cnpj 12.345.678/0001-90',
    'Voltix',
    'Faísca Metalúrgica S.A.',
    'Amaral Comércio de Vidros Ltda',
    'Serviço Social da Indústria - Departamento Regional (Unidade Norte)',
    'AÇO FORTE INDÚSTRIA E COMÉRCIO LTDA',
  ].map((nome, i) => ({ id: `c${i}`, nome })),
)
const de = (nome) => clienteDe(nome, lista)?.nome ?? null

test('mesmo nome, sem contar acento, caixa, pontuação, Ltda, S.A., ordem das palavras, CNPJ e a unidade depois do traço', () => {
  assert.equal(de('Construtora Pedra Lisa'), 'Construtora Pedra Lisa Ltda')
  assert.equal(de('BRISA Incorporadora'), 'Incorporadora Brisa Ltda')
  assert.equal(de('Viação Lua Cheia'), 'Viação Lua Cheia Ltda - Pirituba')
  assert.equal(de('Serra Azul Alimentos'), 'Alimentos Serra Azul Ltda - Cnpj 12.345.678/0001-90')
  assert.equal(de('Aço Forte Indústria e Comércio'), 'AÇO FORTE INDÚSTRIA E COMÉRCIO LTDA')
})

test('o nome da empresa contém o do cliente inteiro, ou o do cliente contém o da empresa com duas palavras próprias', () => {
  assert.equal(de('Transportes Vento Sul - Filial Osasco'), 'Transportes Vento Sul Ltda')
  assert.equal(de('Construtora Pedra Lisa Engenharia'), 'Construtora Pedra Lisa Ltda')
  assert.equal(de('Lua Cheia'), 'Viação Lua Cheia Ltda - Pirituba')
})

test('cliente de uma palavra só bate quando ela abre o nome da empresa; empresa de uma palavra, quando é a primeira do cliente', () => {
  assert.equal(de('Voltix Hidráulica'), 'Voltix')
  assert.equal(de('Projetos e Laudos | Voltix'), null)
  assert.equal(de('Faísca'), 'Faísca Metalúrgica S.A.')
  assert.equal(de('Metalúrgica'), null)
})

test('palavras de ramo em comum não bastam: a empresa precisa ter o nome próprio do cliente', () => {
  assert.equal(de('Comércio de Vidros Centro'), null)
  assert.equal(de('Serviço Social da Indústria - SESI'), null)
  assert.equal(de('Construtora Pedra Branca'), null)
  assert.equal(de('Transportes Vento Norte'), null)
  assert.equal(de('Engenharia'), null)
})

// ---------- nome parecido: só um aviso no mapa, a empresa continua aparecendo ----------
const parecido = (nome) => parecidoCom(nome, lista)?.nome ?? null

test('avisa quando a marca do cliente (a primeira palavra própria dele, com 5 letras ou mais) aparece no nome da empresa', () => {
  assert.equal(parecido('Faísca Ferramentas Elétricas'), 'Faísca Metalúrgica S.A.')
  assert.equal(parecido('Posto Faísca'), 'Faísca Metalúrgica S.A.')
  assert.equal(parecido('Pedra Lisa Revestimentos'), 'Construtora Pedra Lisa Ltda')
  assert.equal(parecido('Projetos e Laudos | Voltix'), 'Voltix')
  assert.equal(parecido('Brisa'), 'Incorporadora Brisa Ltda')
  // não é o cliente (clienteDe diz que não), mas vale conferir
  assert.equal(parecido('Transportes Vento Norte'), 'Transportes Vento Sul Ltda')
})

test('avisa quando a empresa tem duas palavras próprias do cliente', () => {
  assert.equal(parecido('Transportes Serra Azul'), 'Alimentos Serra Azul Ltda - Cnpj 12.345.678/0001-90')
  assert.equal(parecido('Cheia de Lua Festas'), 'Viação Lua Cheia Ltda - Pirituba')
})

test('não avisa por palavra curta, de ramo ou comum, nem quando a empresa já é o cliente (essa nem aparece)', () => {
  assert.equal(parecido('Lua Nova Padaria'), null)
  assert.equal(parecido('Comércio de Vidros Centro'), null)
  assert.equal(parecido('Construtora Pedra Lisa'), null)
  assert.equal(parecido('Transportes Vento Sul - Filial Osasco'), null)
  assert.equal(parecido(''), null)
  const comum = prepararClientes([{ id: 'p', nome: 'Posto Avenida Ltda' }])
  assert.equal(parecidoCom('Posto Estrela', comum), null)
})

test('nome vazio, lista vazia ou cliente sem nome próprio não reconhecem ninguém', () => {
  assert.equal(de(''), null)
  assert.equal(de(null), null)
  assert.equal(clienteDe('Construtora Pedra Lisa', prepararClientes([])), null)
  assert.equal(clienteDe('Ltda', prepararClientes([{ id: 'x', nome: 'Ltda' }])), null)
})
