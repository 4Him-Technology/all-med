// Aba Clientes ativos: quem já contrata e não deve ser prospectado de novo.
// Quem está na lista some do mapa do Google Maps e das buscas novas pelo PC, e aparece marcado na Prospecção (regra em clientes.js).
// A coluna "Escondidas no mapa" mostra quais empresas da pesquisa a regra reconheceu como cada cliente: o reconhecimento é pelo nome.
import { clienteDe, prepararClientes } from './clientes.js'
import { cadastrarCliente, clientesAtivos, empresasMaps, tirarCliente } from './crm.js'
import { $, carregando, esqueleto, estado, h, norm, toast } from './ui.js'

const numero = (n) => n.toLocaleString('pt-BR')
let ligado = false
let clientes = []
let empresas = null // nomes das empresas do mapa, uma por lugar: null enquanto chegam, false se não carregaram
let pedidoEmpresas
let escondidas = new Map() // id do cliente -> nomes das empresas do mapa que ele tira de lá

export async function carregarClientes() {
  if (!ligado) ligar()
  const corpo = $('#lista-clientes')
  if (!corpo.childElementCount) corpo.replaceChildren(...Array.from({ length: 6 }, () => h('tr', { 'aria-hidden': 'true' }, h('td', { colspan: 3 }, esqueleto('linha')))))
  try {
    clientes = await clientesAtivos()
  } catch (err) {
    $('#resumo-clientes').textContent = ''
    corpo.replaceChildren(linhaInteira(estado({ tipo: 'erro', titulo: 'A lista de clientes não carregou', texto: err.message, acao: h('button', { type: 'button', onclick: carregarClientes }, 'Tentar de novo') })))
    return
  }
  cruzar()
  desenhar()
  // as empresas do mapa chegam depois, sem segurar a lista; são lidas uma vez por sessão
  pedidoEmpresas ??= empresasMaps().then(
    (linhas) => (empresas = [...new Map(linhas.map((l) => [l.place_id, l.nome])).values()]),
    (err) => (console.error('mapa:', err.message), (empresas = false)),
  )
  if (empresas === null) {
    await pedidoEmpresas
    cruzar()
    desenhar()
  }
}

function ligar() {
  ligado = true
  $('#busca-clientes').addEventListener('input', desenhar)
  $('#form-cliente').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.currentTarget
    const nome = form.elements.nome.value.trim().replace(/\s+/g, ' ')
    if (!nome) return
    const restaurar = carregando(form.querySelector('button'), 'Cadastrando…')
    try {
      await cadastrarCliente(nome)
      form.reset()
      clientes = await clientesAtivos()
      cruzar()
      desenhar()
      const n = escondidas.get(clientes.find((c) => c.nome === nome)?.id)?.length ?? 0
      toast(n ? `${nome} entrou na lista; ${n} ${n === 1 ? 'empresa saiu' : 'empresas saíram'} do mapa.` : `${nome} entrou na lista e não vai aparecer nas pesquisas.`)
    } catch (err) {
      toast(err.message, 'erro')
    }
    restaurar()
    form.elements.nome.focus()
  })
}

function cruzar() {
  escondidas = new Map()
  if (!empresas) return
  const preparados = prepararClientes(clientes)
  for (const nome of empresas) {
    const c = clienteDe(nome, preparados)
    if (c) escondidas.set(c.id, [...(escondidas.get(c.id) ?? []), nome])
  }
}

const linhaInteira = (conteudo) => h('tr', {}, h('td', { colspan: 3 }, conteudo))

function desenhar() {
  const termo = norm($('#busca-clientes').value).trim()
  const lista = termo ? clientes.filter((c) => norm(c.nome).includes(termo)) : clientes
  $('#resumo-clientes').textContent = termo ? `${numero(lista.length)} de ${numero(clientes.length)} clientes ativos` : `${numero(clientes.length)} ${clientes.length === 1 ? 'cliente ativo' : 'clientes ativos'}`
  if (lista.length) return $('#lista-clientes').replaceChildren(...lista.map(linha))
  $('#lista-clientes').replaceChildren(
    linhaInteira(clientes.length ? estado({ titulo: 'Nenhum cliente com esse nome', texto: 'Confira a grafia ou cadastre o cliente acima.' }) : estado({ titulo: 'Nenhum cliente ativo na lista', texto: 'Cadastre acima quem já é cliente. Ele deixa de aparecer nas pesquisas.' })),
  )
}

function linha(c) {
  const nomes = escondidas.get(c.id)
  const noMapa = empresas === null ? h('span', { class: 'muted' }, 'Conferindo…') : empresas === false ? h('span', { class: 'muted' }, 'Não deu para conferir') : nomes ? nomes.join(', ') : h('span', { class: 'muted' }, 'Nenhuma')
  return h(
    'tr',
    { 'data-id': c.id },
    h('td', {}, h('strong', {}, c.nome)),
    h('td', { class: 'no-mapa' }, noMapa),
    h('td', { class: 'acao' }, h('button', { type: 'button', class: 'tirar', 'aria-label': `Tirar ${c.nome} da lista`, onclick: (e) => tirar(c, e.currentTarget), onblur: desarmar }, 'Tirar')),
  )
}

// tirar pede um segundo clique: o cliente volta a aparecer nas pesquisas
function desarmar(e) {
  const b = e.currentTarget
  if (!b.dataset.confirmar || b.disabled) return
  delete b.dataset.confirmar
  b.textContent = 'Tirar'
  b.classList.remove('perigo')
}

async function tirar(c, botao) {
  if (!botao.dataset.confirmar) {
    botao.dataset.confirmar = 'sim'
    botao.textContent = 'Confirmar'
    botao.classList.add('perigo')
    return
  }
  const proximo = botao.closest('tr').nextElementSibling?.dataset.id
  const restaurar = carregando(botao, 'Tirando…')
  try {
    await tirarCliente(c.id)
    clientes = await clientesAtivos()
    cruzar()
    desenhar()
    toast(`${c.nome} saiu da lista e volta a aparecer nas pesquisas.`)
    // o foco segue para o próximo da lista, ou para a busca quando era o último
    ;($(`#lista-clientes tr[data-id="${CSS.escape(proximo ?? '')}"] .tirar`) ?? $('#busca-clientes')).focus()
  } catch (err) {
    restaurar()
    toast(err.message, 'erro')
  }
}
