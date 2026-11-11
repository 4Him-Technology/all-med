import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FILTRO_VAZIO,
  etiquetasDoMapa,
  facetas,
  filtrarLugares,
  juntarLugares,
  leadDoLugar,
  lerTudo,
  linkWhatsApp,
  listarOpcoes,
  naArea,
  ordenarLugares,
  regioes,
  resumoDaArea,
  rotuloLocal,
  semEtiqueta,
  tipoTelefone,
} from '../public/lugares.js'

// linha como vem da view maps_empresas do CRM online (dados fictícios)
const linha = (place_id, extra = {}) => ({
  place_id,
  segmento: 'Construção Civil',
  servico: 'Coordenação/Execução de PCMSO',
  local_busca: 'Lapa, São Paulo - SP',
  nome: `Empresa ${place_id}`,
  categoria: 'Construtora',
  endereco: 'Rua Fictícia, 1 - Lapa, São Paulo - SP',
  bairro: 'Lapa',
  cidade: 'São Paulo',
  telefone: '(11) 3000-0000',
  site: null,
  avaliacao: 4.5,
  latitude: -23.52,
  longitude: -46.7,
  link_maps: 'https://maps.google.com/?cid=1',
  enviado: false,
  ...extra,
})

const base = juntarLugares([
  linha('a', { nome: 'Construtora Álamo', site: 'https://alamo.example', avaliacao: 4.8 }),
  linha('b', { nome: 'Engenharia Beta', categoria: 'Empresa de engenharia civil', local_busca: 'Osasco - SP', bairro: 'Centro', cidade: 'Osasco', endereco: 'Av. Inventada, 9 - Centro, Osasco - SP', telefone: '(11) 98888-0000', avaliacao: 3.9, enviado: true }),
  linha('c', { nome: 'Padaria Pão Quente', segmento: 'Padaria (avulsas)', categoria: 'Padaria', avaliacao: 4.2, latitude: -23.6, longitude: -46.9 }),
  linha('d', { nome: 'Transportes Delta', segmento: 'Transportadora', categoria: 'Serviço de transporte', local_busca: 'Osasco - SP', cidade: 'Osasco', site: 'https://delta.example', telefone: '(11) 97777-0000', avaliacao: 5 }),
])
const nomes = (lista) => lista.map((l) => l.nome)
const filtro = (extra) => ({ ...FILTRO_VAZIO, ...extra })

test('a mesma empresa em dois segmentos ou locais vira uma só, com os dois', () => {
  const [l, outro] = juntarLugares([
    linha('x', { segmento: 'Padaria (redes)', local_busca: 'Perdizes, São Paulo - SP', avaliacao: '4.6' }),
    linha('x', { segmento: 'Padaria (avulsas)', local_busca: 'Lapa, São Paulo - SP', enviado: true }),
    linha('y'),
  ])
  assert.deepEqual(l.segmentos, ['Padaria (avulsas)', 'Padaria (redes)'])
  assert.deepEqual(l.locais, ['Lapa, São Paulo - SP', 'Perdizes, São Paulo - SP'])
  assert.equal(l.enviado, true)
  assert.equal(l.avaliacao, 4.6)
  assert.equal(outro.place_id, 'y')
  assert.deepEqual(outro.segmentos, ['Construção Civil'])
})

test('filtra por segmento, local, categoria, nota, site, celular e kanban', () => {
  assert.deepEqual(nomes(filtrarLugares(base, FILTRO_VAZIO)), ['Construtora Álamo', 'Engenharia Beta', 'Padaria Pão Quente', 'Transportes Delta'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ segmentos: ['Construção Civil', 'Transportadora'] }))), ['Construtora Álamo', 'Engenharia Beta', 'Transportes Delta'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ locais: ['Osasco - SP'] }))), ['Engenharia Beta', 'Transportes Delta'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ categorias: ['Padaria', 'Construtora'] }))), ['Construtora Álamo', 'Padaria Pão Quente'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ notaMin: 4.5 }))), ['Construtora Álamo', 'Transportes Delta'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ comSite: true }))), ['Construtora Álamo', 'Transportes Delta'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ comCelular: true }))), ['Engenharia Beta', 'Transportes Delta'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ semKanban: true }))), ['Construtora Álamo', 'Padaria Pão Quente', 'Transportes Delta'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ segmentos: ['Transportadora'], locais: ['Lapa, São Paulo - SP'] }))), [])
})

test('a busca ignora acento e caixa e procura cada palavra no nome, na categoria e no endereço', () => {
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ q: 'alamo' }))), ['Construtora Álamo'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ q: '  PAO   quente ' }))), ['Padaria Pão Quente'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ q: 'engenharia civil' }))), ['Engenharia Beta'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ q: 'inventada osasco' }))), ['Engenharia Beta'])
  assert.deepEqual(nomes(filtrarLugares(base, filtro({ q: 'nada disso' }))), [])
})

test('a contagem de cada filtro ignora o próprio filtro e respeita os outros', () => {
  const f = filtro({ segmentos: ['Construção Civil'], locais: ['Osasco - SP'] })
  const { segmentos, locais, categorias } = facetas(base, f)
  // com Osasco ligado: quantas há em cada segmento, mesmo nos desligados
  assert.deepEqual(Object.fromEntries(segmentos), { 'Construção Civil': 1, Transportadora: 1 })
  // com Construção Civil ligado: quantas há em cada local
  assert.deepEqual(Object.fromEntries(locais), { 'Lapa, São Paulo - SP': 1, 'Osasco - SP': 1 })
  assert.deepEqual(Object.fromEntries(categorias), { 'Empresa de engenharia civil': 1 })
})

test('área do mapa: entra quem está dentro dos limites e quem não tem localização', () => {
  const area = { sul: -23.55, norte: -23.5, oeste: -46.75, leste: -46.65 }
  assert.deepEqual(nomes(naArea(base, area)), ['Construtora Álamo', 'Engenharia Beta', 'Transportes Delta'])
  const semLugar = juntarLugares([linha('z', { nome: 'Sem Lugar', latitude: null, longitude: null })])
  assert.deepEqual(nomes(naArea(semLugar, area)), ['Sem Lugar'])
})

test('ordena por nome (com acento) ou pela maior nota, sem mexer na lista original', () => {
  const lista = juntarLugares([linha('1', { nome: 'Zeta', avaliacao: 5 }), linha('2', { nome: 'Árvore', avaliacao: 4 }), linha('3', { nome: 'Beta', avaliacao: 5 })])
  assert.deepEqual(nomes(ordenarLugares(lista, 'nome')), ['Árvore', 'Beta', 'Zeta'])
  assert.deepEqual(nomes(ordenarLugares(lista, 'nota')), ['Beta', 'Zeta', 'Árvore'])
  assert.deepEqual(nomes(lista), ['Zeta', 'Árvore', 'Beta'])
})

test('agrupa os locais da busca por cidade, com o bairro como rótulo', () => {
  assert.deepEqual(regioes(['Lapa, São Paulo - SP', 'Osasco - SP', 'Alphaville, Barueri - SP', 'Barueri - SP', 'Butantã, São Paulo - SP']), [
    { cidade: 'Barueri', itens: [{ valor: 'Barueri - SP', rotulo: 'Barueri (cidade)' }, { valor: 'Alphaville, Barueri - SP', rotulo: 'Alphaville' }] },
    { cidade: 'Osasco', itens: [{ valor: 'Osasco - SP', rotulo: 'Osasco' }] },
    { cidade: 'São Paulo', itens: [{ valor: 'Butantã, São Paulo - SP', rotulo: 'Butantã' }, { valor: 'Lapa, São Paulo - SP', rotulo: 'Lapa' }] },
  ])
  assert.equal(rotuloLocal('Lapa, São Paulo - SP'), 'Lapa')
  assert.equal(rotuloLocal('Osasco - SP'), 'Osasco')
})

test('cada filtro ligado vira uma etiqueta, e tirar a etiqueta desliga só aquele filtro', () => {
  const f = filtro({ segmentos: ['Transportadora'], locais: ['Lapa, São Paulo - SP', 'Osasco - SP'], categorias: ['Padaria'], notaMin: 4.5, comSite: true, comCelular: true, semKanban: true })
  const etiquetas = etiquetasDoMapa(f)
  // o segmento não vira etiqueta: o botão dele já mostra que está ligado
  assert.deepEqual(etiquetas.map((e) => e.rotulo), ['Lapa', 'Osasco', 'Padaria', 'Nota 4,5 ou mais', 'Com site', 'Com celular', 'Fora do kanban'])
  assert.deepEqual(semEtiqueta(f, etiquetas[0]).locais, ['Osasco - SP'])
  assert.deepEqual(semEtiqueta(f, etiquetas[2]).categorias, [])
  assert.equal(semEtiqueta(f, etiquetas[3]).notaMin, 0)
  assert.equal(semEtiqueta(f, etiquetas[4]).comSite, false)
  assert.equal(semEtiqueta(f, etiquetas[4]).comCelular, true)
  assert.deepEqual(f.locais, ['Lapa, São Paulo - SP', 'Osasco - SP'])
  assert.deepEqual(etiquetasDoMapa(FILTRO_VAZIO), [])
})

test('opções de um filtro longo: marcadas primeiro, depois as mais comuns, com busca e limite', () => {
  const contagem = new Map([['Padaria', 40], ['Confeitaria', 12], ['Construtora', 90], ['Doceria', 3]])
  assert.deepEqual(listarOpcoes(contagem, ['Doceria'], '', 3), {
    opcoes: [{ valor: 'Doceria', n: 3, marcada: true }, { valor: 'Construtora', n: 90, marcada: false }, { valor: 'Padaria', n: 40, marcada: false }],
    resto: 1,
  })
  assert.deepEqual(listarOpcoes(contagem, [], 'ARIA', 10).opcoes.map((o) => o.valor), ['Padaria', 'Confeitaria'])
  // marcada que saiu da contagem (outro filtro a zerou) continua na lista para poder ser desmarcada
  assert.deepEqual(listarOpcoes(new Map(), ['Padaria'], '', 5), { opcoes: [{ valor: 'Padaria', n: 0, marcada: true }], resto: 0 })
})

test('resumo da lista: total do filtro ou quantas estão na área do mapa', () => {
  assert.equal(resumoDaArea(1041, 1041), '1.041 empresas')
  assert.equal(resumoDaArea(1, 1), '1 empresa')
  assert.equal(resumoDaArea(148, 1041), '148 de 1.041 empresas nesta área do mapa')
  assert.equal(resumoDaArea(0, 12), '0 de 12 empresas nesta área do mapa')
  assert.equal(resumoDaArea(0, 1), '0 de 1 empresa nesta área do mapa')
})

test('lead que vai para o kanban: só os campos aceitos e a origem da pesquisa nas observações', () => {
  const [l] = juntarLugares([linha('p1', { nome: 'Construtora Álamo', site: 'https://alamo.example' }), linha('p1', { local_busca: 'Perdizes, São Paulo - SP' })])
  assert.deepEqual(leadDoLugar(l), {
    place_id: 'p1',
    nome: 'Construtora Álamo',
    categoria: 'Construtora',
    endereco: 'Rua Fictícia, 1 - Lapa, São Paulo - SP',
    telefone: '(11) 3000-0000',
    site: 'https://alamo.example',
    avaliacao: 4.5,
    latitude: -23.52,
    longitude: -46.7,
    link_maps: 'https://maps.google.com/?cid=1',
    origem: 'maps',
    observacoes: 'Pesquisa no Google Maps: Construção Civil em Lapa, Perdizes\nServiço: Coordenação/Execução de PCMSO',
  })
})

test('tipo do telefone é inferido pelo formato; só celular ganha link do WhatsApp', () => {
  assert.equal(tipoTelefone('(11) 98888-0000'), 'celular')
  assert.equal(tipoTelefone('+55 11 98888-0000'), 'celular')
  assert.equal(tipoTelefone('(11) 3000-0000'), 'fixo')
  assert.equal(tipoTelefone('0800 123 4567'), 'outro')
  assert.equal(tipoTelefone('3000-0000'), 'outro')
  assert.equal(tipoTelefone(null), 'outro')
  assert.equal(linkWhatsApp('(11) 98888-0000'), 'https://wa.me/5511988880000')
  assert.equal(linkWhatsApp('+55 11 98888-0000'), 'https://wa.me/5511988880000')
  assert.equal(linkWhatsApp('(11) 3000-0000'), null)
})

test('lê todas as páginas da consulta, mesmo quando o servidor devolve menos do que o pedido', async () => {
  const linhas = Array.from({ length: 2288 }, (_, i) => i)
  const pedidos = []
  const servidor = (teto) => async (de, ate) => {
    pedidos.push([de, ate])
    return { data: linhas.slice(de, Math.min(ate + 1, de + teto)), count: linhas.length }
  }
  assert.deepEqual(await lerTudo(servidor(1000)), linhas)
  assert.deepEqual(pedidos, [[0, 999], [1000, 1999], [2000, 2999]])
  pedidos.length = 0
  assert.deepEqual(await lerTudo(servidor(500)), linhas)
  assert.equal(pedidos.length, 5)
  assert.deepEqual(await lerTudo(async () => ({ data: [], count: 0 })), [])
  assert.deepEqual(await lerTudo(async () => ({ data: [1, 2], count: null })), [1, 2])
})
