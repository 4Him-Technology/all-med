import { acompanharBuscas, iniciarBuscas } from './buscas-mapa.js'
import { buscaMaps, camposLead, resumoBusca, ultimoContato } from './campos.js'
import { clienteDe, prepararClientes } from './clientes.js'
import * as crm from './crm.js'
import { abrirMapa, carregarLeaflet } from './mapa.js'
import { carregarProspeccao } from './prospeccao.js'
import { carregarClientes } from './tela-clientes.js'
import { carregarPainel } from './tela-painel.js'
import { ROTULOS as R, STATUS } from './rotulos.js'
import { config, supabase } from './supa.js'
import { $, api, avaliacao, carregando, esqueleto, estado, fecharDialogo, h, icone, prepararDialogos, toast } from './ui.js'

const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const fmtDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
const fmtData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' })
const quando = (iso) => fmt.format(new Date(iso))

const opcoes = (mapa, atual, vazio) => [vazio != null && h('option', { value: '' }, vazio), ...Object.entries(mapa).map(([v, r]) => h('option', { value: v, selected: v === atual }, r))].filter(Boolean)
const campo = (rotulo, name, valor, attrs = {}) => h('label', { class: attrs.class }, rotulo, h('input', { name, value: valor ?? '', autocomplete: 'off', ...attrs, class: null }))
const campoSelect = (rotulo, name, mapa, atual, vazio) => h('label', {}, rotulo, h('select', { name }, opcoes(mapa, atual, vazio)))
const agoraLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
// a ficha pode estar na gaveta (<dialog>) ou ao lado da lista de leads
const botaoFechar = (el) => h('button', { type: 'button', class: 'fechar', 'aria-label': 'Fechar', onclick: () => (el.tagName === 'DIALOG' ? fecharDialogo(el) : fecharFicha()) }, icone('x', 20))

// ---------- abas ----------
// quem não abre Kanban nem Leads ainda manda empresas ao kanban pela Prospecção, mas a ficha do lead não abre para ele
// (nem pela lista de parados do Painel)
let abreLeads = true
// o Painel vem primeiro: é a tela que abre para quem pode; para quem não pode, a primeira aba liberada
const abas = { painel: () => carregarPainel({ abrirLead: abreLeads ? abrirLead : null }), kanban: carregarKanban, leads: carregarLeads, prospeccao: () => carregarProspeccao({ abrirLead: abreLeads ? abrirLead : null }), buscas: abrirGoogleMaps, clientes: carregarClientes }
let abaAtual = 'painel'

function abrirAba(nome) {
  abaAtual = nome
  for (const b of document.querySelectorAll('.aba')) {
    b.setAttribute('aria-current', b.dataset.aba === nome ? 'page' : 'false')
    // na tela estreita a barra de abas rola: a aba ativa não pode ficar escondida
    if (b.dataset.aba === nome) b.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `aba-${nome}`
  history.replaceState(null, '', `#${nome}`)
  abas[nome]()
}
const recarregarAba = () => abas[abaAtual]()

// ---------- kanban ----------
async function carregarKanban({ focar, assentar } = {}) {
  const el = $('#kanban')
  if (!el.childElementCount) {
    el.replaceChildren(...STATUS.map(() => h('div', { class: 'coluna' }, esqueleto('titulo'), esqueleto('card'), esqueleto('card'))))
  }
  el.setAttribute('aria-busy', 'true')
  try {
    const { colunas, cortado } = await crm.kanban()
    const vazio = colunas.every((c) => c.total === 0)
    $('#kanban-aviso').replaceChildren(
      vazio
        ? estado({
            titulo: 'Seu kanban está vazio',
            texto: config.local || config.urlPc ? 'Mande empresas pela aba Prospecção ou pelo Google Maps, ou cadastre um lead em "Novo lead".' : 'Mande empresas pela prospecção no seu computador ou cadastre um lead em "Novo lead".',
          })
        : '',
      cortado ? h('p', { class: 'muted pequeno' }, `Mostrando os ${crm.LIMITE_KANBAN} leads mexidos mais recentemente. Use a aba Leads para ver todos.`) : '',
    )
    el.replaceChildren(...colunas.map(coluna))
    if (focar) {
      const card = el.querySelector(`.card[data-id="${focar}"]`)
      card?.focus()
      if (assentar) card?.classList.add('assentou')
    }
  } catch (err) {
    el.replaceChildren(estado({ tipo: 'erro', titulo: 'Não foi possível carregar o kanban', texto: err.message, acao: h('button', { type: 'button', onclick: () => carregarKanban() }, 'Tentar de novo') }))
  }
  el.setAttribute('aria-busy', 'false')
}

function coluna(col) {
  return h(
    'section',
    {
      class: `coluna st-${col.status}`,
      'aria-label': `${R.status[col.status]}, ${col.total} leads`,
      ondragover: (e) => {
        e.preventDefault()
        e.currentTarget.classList.add('alvo')
      },
      ondragleave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('alvo')
      },
      ondrop: (e) => soltar(e, col.status),
    },
    h('header', {}, h('h2', {}, h('span', { class: 'marcador', 'aria-hidden': 'true' }), R.status[col.status]), h('span', { class: 'contador' }, String(col.total))),
    h('ul', { class: 'cards', 'data-vazio': 'Arraste leads para cá' }, col.itens.map(cartao)),
    col.total > col.itens.length && h('p', { class: 'muted pequeno' }, `+${col.total - col.itens.length} na aba Leads`),
  )
}

function cartao(l) {
  return h(
    'li',
    {
      class: 'card',
      draggable: 'true',
      tabindex: '0',
      role: 'button',
      'data-id': l.id,
      'aria-describedby': 'kanban-ajuda',
      ondragstart: (e) => {
        e.dataTransfer.setData('text/plain', l.id)
        e.dataTransfer.effectAllowed = 'move'
        e.currentTarget.classList.add('arrastando')
        document.body.classList.add('arrastando-card')
      },
      ondragend: (e) => {
        e.currentTarget.classList.remove('arrastando')
        document.body.classList.remove('arrastando-card')
      },
      onclick: () => abrirLead(l.id),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          abrirLead(l.id)
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          // alternativa de teclado ao arrastar: setas movem para a coluna vizinha
          e.preventDefault()
          const destino = STATUS[STATUS.indexOf(l.status) + (e.key === 'ArrowRight' ? 1 : -1)]
          if (destino) mover(l.id, destino, { teclado: true })
        }
      },
    },
    h('strong', {}, l.nome),
    l.categoria && h('span', { class: 'muted' }, l.categoria),
    h(
      'span',
      { class: 'card-meta' },
      l.temperatura && h('span', { class: `tag t-${l.temperatura}` }, R.temperatura[l.temperatura]),
      l.avaliacao != null && avaliacao(l.avaliacao),
      h('span', { class: 'muted' }, l.ultimo_atendimento ? `Contato em ${fmtDia.format(new Date(l.ultimo_atendimento))}` : 'Sem contato'),
    ),
  )
}

async function mover(id, status, { teclado = false } = {}) {
  try {
    await crm.atualizarLead(id, { status })
    toast(`Movido para ${R.status[status]}`)
  } catch (err) {
    toast(err.message, 'erro')
  }
  // movimento iniciado pelo teclado não anima; o arraste ganha um assentamento curto do card
  await carregarKanban({ focar: id, assentar: !teclado })
}

function soltar(e, status) {
  e.preventDefault()
  e.currentTarget.classList.remove('alvo')
  const id = e.dataTransfer.getData('text/plain')
  if (id) mover(id, status)
}

// ---------- leads ----------
const filtro = { q: '', status: '', temperatura: '', ordem: 'ultimo_atendimento', crescente: false, page: 1 }
// coluna, rótulo e o sentido do primeiro clique (texto e etapa do começo; datas do mais recente)
const COLUNAS_LEADS = [
  ['nome', 'Nome', true],
  ['status', 'Etapa', true],
  ['temperatura', 'Temp.', true],
  ['ultimo_atendimento', 'Último contato', false],
  ['created_at', 'Criado em', false],
]
let leadAberto = null

function cabecalhoLeads() {
  $('#cabecalho-leads').replaceChildren(
    ...COLUNAS_LEADS.map(([coluna, rotulo, crescente]) =>
      h(
        'th',
        { scope: 'col', class: coluna === 'created_at' ? 'num' : null, 'aria-sort': filtro.ordem === coluna ? (filtro.crescente ? 'ascending' : 'descending') : null },
        h('button', { type: 'button', class: 'ordenar', onclick: () => ordenarPor(coluna, crescente) }, rotulo, icone('seta', 14)),
      ),
    ),
  )
}

function ordenarPor(coluna, crescente) {
  filtro.crescente = filtro.ordem === coluna ? !filtro.crescente : crescente
  filtro.ordem = coluna
  filtro.page = 1
  cabecalhoLeads()
  // o cabeçalho foi redesenhado: o foco volta para a coluna clicada
  $('#cabecalho-leads [aria-sort] button').focus()
  carregarLeads()
}

async function carregarLeads() {
  const corpo = $('#lista-leads')
  if (!corpo.childElementCount) corpo.replaceChildren(...Array.from({ length: 5 }, () => h('tr', {}, h('td', { colspan: '5' }, esqueleto('linha')))))
  try {
    const p = await crm.listarLeads({ ...filtro, limit: 25 })
    const filtrando = filtro.q || filtro.status || filtro.temperatura
    corpo.replaceChildren(
      ...(p.itens.length
        ? p.itens.map(linhaLead)
        : [h('tr', {}, h('td', { colspan: '5' }, estado(filtrando ? { titulo: 'Nenhum lead com esses filtros', texto: 'Tente outro termo ou limpe a etapa e a temperatura.' } : { titulo: 'Nenhum lead ainda', texto: 'Mande empresas pela prospecção ou cadastre um lead em "Novo lead".' })))]),
    )
    $('#paginacao').replaceChildren(
      h('button', { type: 'button', disabled: p.pagina <= 1, onclick: () => irPagina(p.pagina - 1) }, 'Anterior'),
      h('span', {}, `Página ${p.pagina} de ${p.paginas} · ${p.total} leads`),
      h('button', { type: 'button', disabled: p.pagina >= p.paginas, onclick: () => irPagina(p.pagina + 1) }, 'Próxima'),
    )
  } catch (err) {
    corpo.replaceChildren(h('tr', {}, h('td', { colspan: '5' }, estado({ tipo: 'erro', titulo: 'Não foi possível carregar os leads', texto: err.message, acao: h('button', { type: 'button', onclick: carregarLeads }, 'Tentar de novo') }))))
  }
}

function irPagina(n) {
  filtro.page = n
  carregarLeads()
}

// a linha inteira abre a ficha; o botão no nome é o caminho pelo teclado (o clique nele sobe até a linha)
const linhaLead = (l) =>
  h(
    'tr',
    { 'data-id': l.id, class: l.id === leadAberto ? 'sel' : null, onclick: () => abrirLead(l.id) },
    h('td', {}, h('button', { type: 'button', class: 'link' }, l.nome), l.categoria && h('div', { class: 'muted pequeno' }, l.categoria)),
    h('td', {}, h('span', { class: `pill st-${l.status}` }, R.status[l.status])),
    h('td', {}, l.temperatura && h('span', { class: `tag t-${l.temperatura}` }, R.temperatura[l.temperatura])),
    h('td', {}, ultimoContato(l.ultimo_atendimento) ?? h('span', { class: 'muted' }, 'nunca')),
    h('td', { class: 'num' }, fmtData.format(new Date(l.created_at))),
  )

// ---------- ficha do lead ----------
// na aba Leads com tela larga a ficha abre ao lado da lista; no resto (kanban, celular) abre na gaveta
const fichaAoLado = () => abaAtual === 'leads' && matchMedia('(min-width: 1100px)').matches

function marcarLinha(id) {
  leadAberto = id
  for (const tr of document.querySelectorAll('#lista-leads tr[data-id]')) tr.classList.toggle('sel', tr.dataset.id === id)
}

async function abrirNaFicha(id) {
  const ficha = $('#ficha-lead')
  marcarLinha(id)
  if (ficha.hidden) {
    ficha.replaceChildren(h('div', { class: 'drawer-corpo' }, esqueleto('titulo'), esqueleto('bloco'), esqueleto('bloco')))
    ficha.hidden = false
  }
  try {
    const lead = await crm.lerLead(id)
    // cliques rápidos em outras linhas: só desenha a resposta do último lead clicado
    if (leadAberto === id) renderLead(ficha, lead)
  } catch (err) {
    toast(err.message, 'erro')
    fecharFicha()
  }
}

function fecharFicha() {
  fecharDialogo($('#drawer'))
  const ficha = $('#ficha-lead')
  if (ficha.hidden) return
  ficha.hidden = true
  const linha = leadAberto && $(`#lista-leads tr[data-id="${leadAberto}"] button`)
  marcarLinha(null)
  linha?.focus()
}

async function abrirLead(id) {
  if (fichaAoLado()) return abrirNaFicha(id)
  // abrindo na gaveta (tela estreita), a ficha ao lado e o destaque da linha saem
  $('#ficha-lead').hidden = true
  marcarLinha(null)
  const dlg = $('#drawer')
  if (!dlg.open) {
    dlg.replaceChildren(h('div', { class: 'drawer-corpo' }, esqueleto('titulo'), esqueleto('bloco'), esqueleto('bloco')))
    dlg.showModal()
  }
  try {
    renderLead(dlg, await crm.lerLead(id))
  } catch (err) {
    toast(err.message, 'erro')
    fecharDialogo(dlg)
  }
}

// envio de formulário com o botão principal em "andamento" até o servidor responder
function enviar(fn, sucesso, textoAndamento = 'Salvando…') {
  return async (e) => {
    e.preventDefault()
    const form = e.currentTarget
    const restaurar = carregando(form.querySelector('button.primario'), textoAndamento)
    try {
      await fn(Object.fromEntries(new FormData(form)), form)
      toast(sucesso)
    } catch (err) {
      toast(err.message, 'erro')
    } finally {
      restaurar()
    }
  }
}

const ORIGENS = { maps: 'Importado do Google Maps', manual: 'Cadastrado manualmente', receita: 'Vindo da prospecção por CNPJ' }

function renderLead(dlg, l) {
  const digitos = (l.telefone ?? '').replace(/\D/g, '')
  // shortcut: assume DDI 55 quando o número tem 10 ou 11 dígitos; revisar se prospectar fora do Brasil
  const whats = digitos.length >= 10 ? (digitos.length <= 11 ? `55${digitos}` : digitos) : null
  const externo = { target: '_blank', rel: 'noopener noreferrer', class: 'botao' }
  const tiposManuais = Object.fromEntries(Object.entries(R.tipo).filter(([k]) => k !== 'status'))
  const agoraPadrao = agoraLocal()

  dlg.replaceChildren(
    h(
      'div',
      { class: 'drawer-corpo' },
      h(
        'header',
        { class: 'drawer-topo' },
        h('div', {}, h('h2', { id: `${dlg.id}-titulo` }, l.nome), h('p', { class: 'muted' }, `${ORIGENS[l.origem] ?? 'Cadastrado'} em ${quando(l.created_at)}${l.cnpj ? ` · CNPJ ${l.cnpj}` : ''}`)),
        botaoFechar(dlg),
      ),
      h(
        'div',
        { class: 'atalhos' },
        l.telefone && h('a', { href: `tel:${digitos}`, class: 'botao' }, icone('telefone'), 'Ligar'),
        whats && h('a', { href: `https://wa.me/${whats}`, ...externo }, icone('conversa'), 'WhatsApp'),
        l.emails[0] && h('a', { href: `mailto:${l.emails[0]}`, class: 'botao' }, icone('email'), 'E-mail'),
        l.site && h('a', { href: l.site, ...externo }, icone('site'), 'Site'),
        l.link_maps && h('a', { href: l.link_maps, ...externo }, icone('mapa'), 'Ver no Maps'),
        // nem toda origem informa quantas avaliações o lugar tem: sem o total, fica só a nota
        l.avaliacao != null && h('span', { class: 'muted' }, avaliacao(l.avaliacao), l.total_avaliacoes != null ? ` em ${l.total_avaliacoes} avaliações` : ' no Google'),
      ),

      h('h3', {}, 'Registrar atendimento'),
      h(
        'form',
        {
          class: 'grade',
          onsubmit: enviar(
            async (d, form) => {
              // campo sem alteração vira o instante exato, senão o histórico perde a ordem dentro do mesmo minuto
              d.data = !d.data || d.data === agoraPadrao ? new Date().toISOString() : new Date(d.data).toISOString()
              await crm.registrarAtendimento(l.id, d)
              form.reset()
              await abrirLead(l.id)
              recarregarAba()
            },
            'Atendimento registrado',
            'Registrando…',
          ),
        },
        campoSelect('Tipo', 'tipo', tiposManuais, 'ligacao'),
        campo('Quando', 'data', agoraPadrao, { type: 'datetime-local', required: true }),
        h('label', { class: 'largo' }, 'O que aconteceu', h('textarea', { name: 'descricao', rows: '3', required: true, maxlength: '5000', placeholder: 'Ex.: falei com a dona, pediu proposta até sexta…' })),
        h('div', { class: 'acoes largo' }, h('button', { class: 'primario' }, 'Registrar atendimento')),
      ),

      h('h3', {}, `Histórico (${l.atendimentos.length})`),
      l.atendimentos.length
        ? h('ol', { class: 'timeline' }, l.atendimentos.map((a) => h('li', { class: `ev ev-${a.tipo}` }, h('div', { class: 'ev-topo' }, h('strong', {}, R.tipo[a.tipo]), h('time', { datetime: a.data }, quando(a.data))), h('p', {}, a.descricao))))
        : h('p', { class: 'muted' }, 'Nenhum atendimento ainda. O primeiro contato que você registrar aparece aqui, junto com cada mudança de coluna.'),

      h('h3', {}, 'Dados do lead'),
      h(
        'form',
        {
          class: 'grade',
          onsubmit: enviar(async (d) => {
            await crm.atualizarLead(l.id, camposLead(d))
            await abrirLead(l.id)
            recarregarAba()
          }, 'Lead salvo'),
        },
        campo('Nome', 'nome', l.nome, { required: true, maxlength: '200', class: 'largo' }),
        campoSelect('Status', 'status', R.status, l.status),
        campoSelect('Temperatura', 'temperatura', R.temperatura, l.temperatura, 'Sem classificação'),
        campo('Categoria', 'categoria', l.categoria, { maxlength: '200' }),
        campo('Telefone', 'telefone', l.telefone, { type: 'tel', inputmode: 'tel', maxlength: '50' }),
        campo('Site', 'site', l.site, { type: 'url', inputmode: 'url', placeholder: 'https://…', maxlength: '500', spellcheck: 'false' }),
        campo('E-mails (separados por vírgula)', 'emails', l.emails.join(', '), { inputmode: 'email', spellcheck: 'false' }),
        campo('Endereço', 'endereco', l.endereco, { maxlength: '500', class: 'largo' }),
        h('label', { class: 'largo' }, 'Observações', h('textarea', { name: 'observacoes', rows: '3', maxlength: '5000' }, l.observacoes ?? '')),
        h('div', { class: 'acoes largo' }, h('button', { class: 'primario' }, 'Salvar alterações'), h('button', { type: 'button', class: 'perigo', onclick: (e) => arquivar(l, e.currentTarget) }, icone('arquivar'), 'Arquivar lead')),
      ),
    ),
  )
}

async function arquivar(l, botao) {
  if (!confirm(`Arquivar "${l.nome}"? Ele sai do kanban e da lista, e não volta em novas buscas.`)) return
  const restaurar = carregando(botao, 'Arquivando…')
  try {
    await crm.arquivarLead(l.id)
    fecharFicha()
    toast('Lead arquivado')
    recarregarAba()
  } catch (err) {
    restaurar()
    toast(err.message, 'erro')
  }
}

function abrirNovoLead() {
  const dlg = $('#dlg-novo')
  dlg.replaceChildren(
    h(
      'form',
      {
        class: 'grade',
        onsubmit: enviar(
          async (d) => {
            const lead = await crm.criarLead(camposLead(d))
            fecharDialogo(dlg)
            recarregarAba()
            abrirLead(lead.id)
          },
          'Lead criado',
          'Criando…',
        ),
      },
      h('header', { class: 'drawer-topo largo' }, h('h2', { id: 'novo-titulo' }, 'Novo lead'), botaoFechar(dlg)),
      campo('Nome', 'nome', '', { required: true, maxlength: '200', class: 'largo', autofocus: true }),
      campo('Categoria', 'categoria', '', { maxlength: '200', placeholder: 'Ex.: clínica odontológica…' }),
      campo('Telefone', 'telefone', '', { type: 'tel', inputmode: 'tel', maxlength: '50', placeholder: '(11) 91234-5678' }),
      campo('Site', 'site', '', { type: 'url', inputmode: 'url', placeholder: 'https://…', maxlength: '500', spellcheck: 'false' }),
      campo('E-mails (separados por vírgula)', 'emails', '', { inputmode: 'email', spellcheck: 'false', placeholder: 'contato@empresa.com.br' }),
      campo('Endereço', 'endereco', '', { maxlength: '500', class: 'largo' }),
      campoSelect('Temperatura', 'temperatura', R.temperatura, '', 'Sem classificação'),
      h('div', { class: 'acoes largo' }, h('button', { class: 'primario' }, icone('mais'), 'Criar lead')),
    ),
  )
  dlg.showModal()
}

// ---------- aba Google Maps ----------
// A tela é o mapa das empresas guardadas no CRM online (mapa.js). "Nova busca pelo PC" abre o formulário numa janela;
// quando a busca termina, as empresas entram no mapa sozinhas e a busca vai para a lista "Buscas feitas" (buscas-mapa.js).
// Sem o CRM online (só o PC), a aba é a lista de cartões das buscas, cada uma com a lista do que achou e o mapa.
// Prospecção e buscas novas rodam no PC com Docker; no site da internet aparecem quando há o túnel até ele (urlPc)
const temPc = config.local || Boolean(config.urlPc)
// só quem está logado e na equipe lê as empresas do CRM online; os outros veem apenas as buscas do PC
let mapaLigado = false
let timerBuscas
const cartoes = new Map() // id da busca -> <section>; o cartão sobrevive à atualização da lista, aberto ou não
const abertas = new Map() // id -> { id, leads, marcadas: Set de place_id, mapa, pinos: Map place_id -> marcador, corpo, ui }

function abrirGoogleMaps() {
  if (!mapaLigado) return mostrarBuscasPc(true)
  abrirMapa()
  iniciarBuscas(temPc)
}

function mostrarBuscasPc(sim) {
  $('#buscas-pc').hidden = !sim
  $('#mapa-empresas').hidden = sim
  $('#voltar-mapa').parentElement.hidden = !mapaLigado
  if (sim) return carregarBuscas()
  clearTimeout(timerBuscas)
  abrirMapa()
}

async function carregarBuscas() {
  clearTimeout(timerBuscas)
  const lista = $('#lista-buscas')
  if (!lista.childElementCount) lista.replaceChildren(...Array.from({ length: 3 }, () => esqueleto('cartao-busca')))
  let itens
  try {
    itens = (await api('/api/buscas?limit=50')).itens
  } catch (err) {
    lista.replaceChildren(estado({ tipo: 'erro', titulo: 'As buscas do PC não carregaram', texto: err.message, acao: h('button', { type: 'button', onclick: carregarBuscas }, 'Tentar de novo') }))
    return
  }
  if (!itens.length) {
    lista.replaceChildren(estado({ titulo: 'Nenhuma busca ainda', texto: 'Preencha o ramo e a cidade acima e clique em Iniciar busca. Quando ela terminar, a lista e o mapa aparecem aqui para você escolher quem vai para o kanban.' }))
  } else {
    const els = itens.map(cartaoBusca)
    // só remonta a lista quando muda o que tem nela: mexer no DOM tira o foco de quem está marcando empresas
    if (els.length !== lista.children.length || els.some((el, i) => lista.children[i] !== el)) lista.replaceChildren(...els)
  }
  const ativa = itens.some((b) => b.status === 'pendente' || b.status === 'executando')
  if (ativa && abaAtual === 'buscas' && !$('#buscas-pc').hidden) timerBuscas = setTimeout(carregarBuscas, 5000)
}

function cartaoBusca(b) {
  let el = cartoes.get(b.id)
  const assinatura = JSON.stringify([b.status, b.encontrados, b.enviados, b.erro])
  if (el?.dataset.assinatura === assinatura) return el
  if (!el) {
    el = h('section', { class: 'bc', 'aria-labelledby': `bc-${b.id}-nome` })
    cartoes.set(b.id, el)
  }
  el.dataset.assinatura = assinatura
  const tinhaFoco = el.querySelector('.bc-topo')?.contains(document.activeElement)
  el.querySelector(':scope > .bc-topo')?.remove()
  el.prepend(topoBusca(b))
  if (tinhaFoco) el.querySelector('.bc-topo button')?.focus()
  return el
}

function topoBusca(b) {
  const abre = b.status === 'importado' && b.encontrados > 0
  const meta = resumoBusca(b)
  const conteudo = [
    abre && icone('baixo', 16),
    h('strong', { id: `bc-${b.id}-nome` }, b.nome),
    h('span', { class: `pill sb-${b.status}` }, R.status_busca[b.status]),
    h('span', { class: b.status === 'falhou' ? 'pequeno erro' : 'muted pequeno' }, meta),
    b.status === 'executando' && h('span', { class: 'prog', role: 'progressbar', 'aria-label': `Buscando ${b.nome}` }, h('span')),
  ]
  return abre
    ? h('h2', { class: 'bc-topo' }, h('button', { type: 'button', 'aria-expanded': String(abertas.has(b.id)), 'aria-controls': `bc-${b.id}-corpo`, onclick: () => alternarBusca(b.id) }, conteudo))
    : h('div', { class: 'bc-topo' }, conteudo)
}

async function alternarBusca(id) {
  const el = cartoes.get(id)
  const botao = el.querySelector('.bc-topo button')
  const aberta = abertas.get(id)
  if (aberta) {
    aberta.mapa?.remove()
    aberta.corpo.remove()
    abertas.delete(id)
    botao.setAttribute('aria-expanded', 'false')
    return
  }
  const a = { id, leads: [], marcadas: new Set(), mapa: null, pinos: new Map(), corpo: h('div', { class: 'bc-corpo', id: `bc-${id}-corpo` }, esqueleto('bloco')) }
  abertas.set(id, a)
  el.append(a.corpo)
  botao.setAttribute('aria-expanded', 'true')
  try {
    const [leads, clientes] = await Promise.all([api(`/api/buscas/${id}/leads`), supabase ? crm.clientesAtivos().catch(() => null) : []])
    // quem já é cliente ativo não aparece (public/clientes.js); sem a lista, aparece todo mundo e o rodapé avisa
    const preparados = prepararClientes(clientes ?? [])
    a.leads = leads.filter((l) => !clienteDe(l.nome, preparados))
    a.clientes = clientes && leads.length - a.leads.length
    if (abertas.get(id) === a) desenharBusca(a)
  } catch (err) {
    a.corpo.replaceChildren(estado({ tipo: 'erro', titulo: 'Não foi possível abrir a busca', texto: err.message, acao: h('button', { type: 'button', onclick: () => (alternarBusca(id), alternarBusca(id)) }, 'Tentar de novo') }))
  }
}

const estadoPino = (a, l) => (l.enviado ? 'ja' : a.marcadas.has(l.place_id) ? 'sel' : '')

function desenharBusca(a) {
  const podeMandar = Boolean(supabase)
  a.ui = {
    tbody: h('tbody', {}, a.leads.map((l, i) => linhaMaps(a, l, i, podeMandar))),
    todas: h('input', { type: 'checkbox', 'aria-label': 'Marcar todas as empresas desta busca', hidden: !podeMandar, onchange: (e) => marcarTodasMaps(a, e.currentTarget.checked) }),
    contagem: h('span', { class: 'muted', 'aria-live': 'polite' }),
    mandar: h('button', { type: 'button', class: 'primario', hidden: !podeMandar, onclick: (e) => mandarDaBusca(a, e.currentTarget) }),
  }
  const mapa = h('div', { class: 'mapa', role: 'region', 'aria-label': 'Mapa das empresas encontradas, com o mesmo número da lista' })
  a.corpo.replaceChildren(
    h(
      'div',
      { class: 'com-mapa' },
      h('div', { class: 'bc-lista' }, h('table', { class: 'tabela' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'col-marcar' }, a.ui.todas), ...['Empresa', 'Telefone', 'Nota no Google', 'Endereço'].map((t) => h('th', { scope: 'col' }, t)))), a.ui.tbody)),
      h(
        'div',
        { class: 'lado' },
        mapa,
        h('p', { class: 'legenda' }, h('span', { class: 'pino mini sel' }), 'Marcada', h('span', { class: 'pino mini ja' }), 'Já no kanban', h('span', { class: 'pino mini' }), 'Não marcada'),
      ),
    ),
    h(
      'footer',
      {},
      podeMandar ? a.ui.contagem : h('span', { class: 'muted' }, 'Ligue o CRM online neste computador para mandar empresas ao kanban.'),
      a.clientes === null
        ? h('span', { class: 'pequeno aviso-clientes' }, 'A lista de clientes ativos não carregou: eles podem aparecer aqui.')
        : a.clientes > 0 && h('span', { class: 'muted pequeno' }, `${a.clientes} ${a.clientes === 1 ? 'cliente ativo ficou' : 'clientes ativos ficaram'} de fora da lista`),
      h('span', { class: 'esp' }),
      a.ui.mandar,
    ),
  )
  atualizarBusca(a)
  montarMapa(a, mapa)
}

const linhaMaps = (a, l, i, podeMandar) =>
  h(
    'tr',
    { 'data-place': l.place_id },
    h('td', { class: 'col-marcar' }, l.enviado ? h('span', { class: 'ja' }, 'No kanban') : podeMandar && h('input', { type: 'checkbox', 'aria-label': `Marcar ${l.nome}`, onchange: (e) => marcarMaps(a, l.place_id, e.currentTarget.checked) })),
    h('td', {}, h('span', { class: 'nr', 'aria-hidden': 'true' }, String(i + 1)), h('strong', {}, l.nome), l.categoria && h('div', { class: 'muted pequeno' }, l.categoria)),
    h('td', { class: 'tel' }, l.telefone ?? h('span', { class: 'muted' }, 'sem telefone')),
    h('td', {}, l.avaliacao != null ? avaliacao(l.avaliacao, l.total_avaliacoes ?? 0) : h('span', { class: 'muted' }, 'sem nota')),
    h('td', { class: 'endereco' }, l.endereco ?? ''),
  )

function marcarMaps(a, placeId, sim) {
  if (sim) a.marcadas.add(placeId)
  else a.marcadas.delete(placeId)
  atualizarBusca(a)
}

function marcarTodasMaps(a, sim) {
  a.marcadas = new Set(sim ? a.leads.filter((l) => !l.enviado).map((l) => l.place_id) : [])
  atualizarBusca(a)
}

// linhas, caixa "todas", contagem, botão, pinos do mapa e a ficha aberta seguem a mesma seleção
function atualizarBusca(a) {
  const livres = a.leads.filter((l) => !l.enviado).length
  const n = a.marcadas.size
  for (const tr of a.ui.tbody.rows) {
    const sim = a.marcadas.has(tr.dataset.place)
    tr.classList.toggle('sel', sim)
    const caixa = tr.querySelector('input')
    if (caixa) caixa.checked = sim
  }
  a.ui.todas.disabled = !livres
  a.ui.todas.checked = n > 0 && n === livres
  a.ui.todas.indeterminate = n > 0 && n < livres
  a.ui.contagem.textContent = livres ? `${n} de ${livres} marcadas` : 'Todas as empresas desta busca já estão no kanban'
  a.ui.mandar.disabled = !n
  a.ui.mandar.replaceChildren(icone('enviar', 15), n ? `Mandar ${n} para o kanban` : 'Mandar para o kanban')
  for (const l of a.leads) {
    const pino = a.pinos.get(l.place_id)
    pino?.getElement()?.firstElementChild?.setAttribute('class', `pino ${estadoPino(a, l)}`)
    // o conteúdo da ficha é uma função: update() monta de novo com a seleção atual
    if (pino?.isPopupOpen()) pino.getPopup().update()
  }
}

// o Leaflet só baixa quando o primeiro mapa abre (carregarLeaflet, em mapa.js)
async function montarMapa(a, el) {
  const comLugar = a.leads.map((l, i) => [l, i]).filter(([l]) => l.latitude != null && l.longitude != null)
  if (!comLugar.length) return el.replaceChildren(h('p', { class: 'sem-mapa' }, 'Esta busca não trouxe a localização das empresas.'))
  let L
  try {
    L = await carregarLeaflet()
  } catch (err) {
    console.error('mapa:', err.message)
    return el.replaceChildren(h('p', { class: 'sem-mapa' }, 'Não foi possível carregar o mapa agora. A lista ao lado continua funcionando.'))
  }
  if (abertas.get(a.id) !== a || a.mapa) return // fechou enquanto o Leaflet baixava
  a.mapa = L.map(el, { scrollWheelZoom: false, keyboard: false })
  // a página manda sem Referer (no-referrer); a política dos tiles do OpenStreetMap pede o Referer, então só o tile envia a origem
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(a.mapa)
  for (const [l, i] of comLugar) {
    // o HTML do pino só leva o número e uma classe fixa; o nome da empresa vai como texto no title
    const pino = L.marker([l.latitude, l.longitude], { keyboard: false, title: l.nome, icon: L.divIcon({ className: '', html: `<span class="pino ${estadoPino(a, l)}">${i + 1}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }) })
    // clicar no número abre a ficha da empresa no mapa e destaca a linha dela na lista
    pino.bindPopup(() => fichaPino(a, l, i), { maxWidth: 300, minWidth: 240, autoPanPadding: [24, 24] })
    pino.on('popupopen', () => destacarLinha(a, l.place_id, true))
    pino.on('popupclose', () => destacarLinha(a, l.place_id, false))
    a.pinos.set(l.place_id, pino.addTo(a.mapa))
  }
  a.mapa.fitBounds(
    comLugar.map(([l]) => [l.latitude, l.longitude]),
    { padding: [28, 28], maxZoom: 16 },
  )
}

// Ficha que abre no mapa: tudo que a busca trouxe da empresa e o botão de marcar para o kanban.
// Montada com h() (sem HTML em texto): nome, endereço e links vêm do Google e nunca viram HTML.
function fichaPino(a, l, i) {
  const marcada = a.marcadas.has(l.place_id)
  const externo = { target: '_blank', rel: 'noopener noreferrer' }
  const acao = l.enviado
    ? h('p', { class: 'ja' }, 'Já está no kanban')
    : supabase &&
      h(
        'button',
        {
          type: 'button',
          class: marcada ? '' : 'primario',
          onclick: () => marcarMaps(a, l.place_id, !marcada),
        },
        marcada ? 'Desmarcar' : 'Marcar para o kanban',
      )
  return h(
    'div',
    { class: 'ficha-pino' },
    h('p', { class: 'fp-nome' }, h('span', { class: 'nr' }, String(i + 1)), h('strong', {}, l.nome)),
    l.categoria && h('p', { class: 'muted pequeno' }, l.categoria),
    l.avaliacao != null && h('p', {}, avaliacao(l.avaliacao, l.total_avaliacoes ?? 0)),
    l.endereco && h('p', {}, l.endereco),
    l.telefone && h('p', {}, h('a', { href: `tel:${l.telefone.replace(/[^\d+]/g, '')}` }, l.telefone)),
    l.emails?.length > 0 && h('p', { class: 'fp-emails' }, l.emails.join(', ')),
    h('p', { class: 'fp-links' }, l.site && h('a', { href: l.site, ...externo }, 'Site'), l.link_maps && h('a', { href: l.link_maps, ...externo }, 'Abrir no Google Maps')),
    acao,
  )
}

function destacarLinha(a, placeId, sim) {
  const tr = a.ui.tbody.querySelector(`tr[data-place="${CSS.escape(placeId)}"]`)
  if (!tr) return
  tr.classList.toggle('foco', sim)
  if (sim) tr.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

// Manda as empresas marcadas para o CRM online; repetidas (mesmo lugar do Maps) o banco ignora
async function mandarDaBusca(a, botao) {
  const leads = a.leads.filter((l) => a.marcadas.has(l.place_id))
  const restaurar = carregando(botao, 'Mandando…')
  try {
    const novos = await crm.enviarLeads(leads.map(({ enviado, ...l }) => ({ ...l, origem: 'maps' })))
    await api(`/api/buscas/${a.id}`, { method: 'PATCH', body: { place_ids: leads.map((l) => l.place_id), novos } })
    const repetidas = leads.length - novos
    toast(`${novos} ${novos === 1 ? 'lead novo' : 'leads novos'} na coluna Novo do kanban${repetidas ? `; ${repetidas} já ${repetidas === 1 ? 'estava' : 'estavam'} no CRM` : ''}`)
    for (const l of leads) l.enviado = true
    a.marcadas.clear()
    a.ui.tbody.replaceChildren(...a.leads.map((l, i) => linhaMaps(a, l, i, true)))
  } catch (err) {
    toast(err.message, 'erro')
  }
  restaurar()
  atualizarBusca(a)
  // o botão fica desabilitado sem marcadas: o foco vai para a caixa "todas" ou para o título do cartão
  ;(a.ui.todas.disabled ? cartoes.get(a.id).querySelector('.bc-topo button') : a.ui.todas).focus()
  carregarBuscas()
}

// ---------- usuários e acessos (só admin, num popup) ----------
const PAPEL = { admin: 'Administrador', membro: 'Membro' }
// as telas são as abas do topo: uma aba nova (como o Painel gerencial) entra sozinha na lista de acessos
const telasDoSistema = () => [...document.querySelectorAll('.aba')].map((b) => ({ tela: b.dataset.aba, nome: b.textContent.trim() }))

function abrirUsuarios() {
  $('#menu-conta').hidePopover()
  $('#dlg-usuarios').showModal()
  carregarUsuarios()
}

async function carregarUsuarios() {
  const corpo = $('#lista-usuarios')
  const telas = telasDoSistema()
  const linhaInteira = (conteudo) => h('tr', {}, h('td', { colspan: String(telas.length + 4) }, conteudo))
  $('#cabecalho-usuarios').replaceChildren(
    ...['Pessoa', 'Papel', 'Situação'].map((t) => h('th', { scope: 'col' }, t)),
    ...telas.map((t) => h('th', { scope: 'col', class: 'col-tela' }, t.nome)),
    h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Ações')),
  )
  if (!corpo.childElementCount) corpo.replaceChildren(...Array.from({ length: 3 }, () => linhaInteira(esqueleto('linha'))))
  try {
    const [membros, acessos, { data }] = await Promise.all([crm.listarMembros(), crm.listarAcessos(), supabase.auth.getSession()])
    const liberadas = new Set(acessos.map((a) => `${a.user_id} ${a.tela}`))
    corpo.replaceChildren(...membros.map((m) => linhaUsuario(m, data.session?.user.id, telas, liberadas)))
  } catch (err) {
    corpo.replaceChildren(linhaInteira(estado({ tipo: 'erro', titulo: 'Não foi possível carregar a equipe', texto: err.message, acao: h('button', { type: 'button', onclick: carregarUsuarios }, 'Tentar de novo') })))
  }
}

const linhaUsuario = (m, eu, telas, liberadas) =>
  h(
    'tr',
    { class: m.ativo ? '' : 'inativo' },
    h('td', {}, h('strong', {}, m.nome), m.user_id === eu && h('span', { class: 'muted pequeno' }, ' (você)'), h('div', { class: 'muted pequeno' }, m.email)),
    h('td', {}, PAPEL[m.papel]),
    h('td', {}, situacaoUsuario(m)),
    // administrador abre todas as telas, sem precisar marcar (o banco faz a mesma conta)
    ...(m.papel === 'admin'
      ? [h('td', { colspan: String(telas.length), class: 'todas-telas muted' }, 'Abre todas as telas')]
      : telas.map((t) =>
          h(
            'td',
            { class: 'col-tela' },
            h('input', { type: 'checkbox', checked: liberadas.has(`${m.user_id} ${t.tela}`), 'aria-label': `${m.nome} abre ${t.nome}`, onchange: (e) => alternarTela(m, t, e.currentTarget) }),
          ),
        )),
    // a própria conta não se desativa (a função também recusa): ninguém fica trancado fora sem querer
    h('td', { class: 'acoes-linha' }, m.user_id !== eu && h('button', { type: 'button', onclick: (e) => alternarUsuario(m, e.currentTarget) }, m.ativo ? 'Desativar' : 'Reativar')),
  )

// grava na hora, uma tela por vez; se o banco recusar, a caixa volta ao que era
async function alternarTela(m, t, caixa) {
  const liberar = caixa.checked
  const tinhaFoco = document.activeElement === caixa
  caixa.disabled = true
  try {
    await crm.definirAcesso(m.user_id, t.tela, liberar)
    toast(liberar ? `${m.nome} agora abre ${t.nome}` : `${m.nome} não abre mais ${t.nome}`)
  } catch (err) {
    caixa.checked = !liberar
    toast(err.message, 'erro')
  }
  caixa.disabled = false
  if (tinhaFoco) caixa.focus()
}

// "Aguardando primeiro acesso" deixa à vista quem ainda pode ter a senha criada por quem souber o e-mail
const situacaoUsuario = (m) =>
  !m.ativo
    ? h('span', { class: 'pill membro-inativo' }, 'Desativado')
    : m.ativado_em
      ? h('span', { class: 'pill membro-ativo' }, 'Ativo')
      : h('span', { class: 'pill membro-pendente' }, 'Aguardando primeiro acesso')

async function alternarUsuario(m, botao) {
  if (m.ativo && !confirm(`Desativar ${m.nome}? A pessoa perde o acesso na hora. Os leads e o histórico dela continuam com a equipe.`)) return
  const restaurar = carregando(botao, m.ativo ? 'Desativando…' : 'Reativando…')
  try {
    await crm.gerirUsuario({ acao: m.ativo ? 'desativar' : 'reativar', user_id: m.user_id })
    toast(m.ativo ? `${m.nome} desativado` : `${m.nome} reativado`)
    carregarUsuarios()
  } catch (err) {
    toast(err.message, 'erro')
    restaurar()
  }
}

function abrirTrocaSenha() {
  $('#menu-conta').hidePopover()
  const dlg = $('#dlg-novo')
  const senha = (rotulo, name, attrs = {}) => campo(rotulo, name, '', { type: 'password', required: true, minlength: '8', maxlength: '72', autocomplete: 'new-password', class: 'largo', ...attrs })
  dlg.replaceChildren(
    h(
      'form',
      {
        class: 'grade',
        onsubmit: enviar(
          async (d) => {
            if (d.senha !== d.confirmar) throw new Error('As duas senhas não estão iguais.')
            await crm.trocarSenha(d.senha)
            fecharDialogo(dlg)
          },
          'Senha trocada',
          'Salvando…',
        ),
      },
      h('header', { class: 'drawer-topo largo' }, h('h2', { id: 'novo-titulo' }, 'Trocar senha'), botaoFechar(dlg)),
      senha('Senha nova (8 caracteres ou mais)', 'senha', { autofocus: true }),
      senha('Repita a senha nova', 'confirmar'),
      h('div', { class: 'acoes largo' }, h('button', { class: 'primario' }, 'Trocar senha')),
    ),
  )
  dlg.showModal()
}

// ---------- login ----------
function mostrarLogin() {
  for (const el of document.querySelectorAll('.abas, [data-crm], main')) el.hidden = true
  $('#tela-login').hidden = false
  // entrar e primeiro acesso dividem a tela; o e-mail digitado passa de um para o outro
  const trocar = (de, para) => {
    para.elements.email.value = de.elements.email.value
    de.hidden = true
    para.hidden = false
    para.elements[para.elements.email.value ? 1 : 0].focus()
  }
  $('#ir-primeiro').addEventListener('click', () => trocar($('#form-login'), $('#form-primeiro')))
  $('#voltar-login').addEventListener('click', () => trocar($('#form-primeiro'), $('#form-login')))
  $('#form-primeiro').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.currentTarget
    const email = form.elements.email.value.trim()
    const senha = form.elements.senha.value
    if (senha !== form.elements.confirmar.value) return toast('As duas senhas não estão iguais.', 'erro')
    const restaurar = carregando(form.querySelector('button.primario'), 'Criando…')
    try {
      await crm.primeiroAcesso(email, senha)
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
      if (error) throw new Error('Senha criada. Entre com o e-mail e a senha nova.')
      location.reload()
    } catch (err) {
      restaurar()
      toast(err.message, 'erro')
    }
  })
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = e.currentTarget
    const restaurar = carregando(form.querySelector('button'), 'Entrando…')
    const { error } = await supabase.auth.signInWithPassword({ email: form.elements.email.value.trim(), password: form.elements.senha.value })
    if (error) {
      restaurar()
      // mensagem única para não revelar se o e-mail existe
      console.error('login:', error.status, error.code)
      const msg =
        error.status === 429
          ? 'Muitas tentativas. Espere um pouco e tente de novo.'
          : !error.status || error.status >= 500
            ? 'Não foi possível conectar ao servidor. Confira sua conexão e tente de novo.'
            : 'E-mail ou senha incorretos. Confira e tente de novo.'
      toast(msg, 'erro')
      form.elements.senha.select()
      return
    }
    location.reload()
  })
  $('#tela-login input[name=email]').focus()
}

function aviso(texto) {
  const el = $('#aviso')
  el.replaceChildren(icone('alerta'), h('span', {}, texto))
  el.hidden = false
}

// ---------- início ----------
async function iniciar() {
  prepararDialogos()
  // ícones dos botões fixos do HTML (o texto continua sendo o nome acessível)
  $('#btn-novo-lead').prepend(icone('mais'))
  $('#btn-busca-pc').prepend(icone('buscar'))
  $('#btn-conta').append(icone('usuario', 20))
  $('#menu-usuarios').prepend(icone('equipe'))
  $('#menu-senha').prepend(icone('chave'))
  $('#menu-sair').prepend(icone('sair'))
  $('#fechar-usuarios').append(icone('x', 20))
  $('#fechar-usuarios').addEventListener('click', () => fecharDialogo($('#dlg-usuarios')))
  for (const [botao, dlg] of [['#fechar-busca', '#dlg-busca'], ['#fechar-buscas', '#dlg-buscas']]) {
    $(botao).append(icone('x', 20))
    $(botao).addEventListener('click', () => fecharDialogo($(dlg)))
  }
  $('#link-web').append(icone('externo', 14))
  $('#btn-iniciar-busca').prepend(icone('buscar'))
  $('#voltar-mapa').prepend(icone('seta', 14))
  for (const el of document.querySelectorAll('[data-local]')) el.hidden = !temPc
  if (!temPc) delete abas.prospeccao

  let logado = false
  let telas = null // as telas que a pessoa abre; null quando não há a lista
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return mostrarLogin()
    logado = true
    // ícone de usuário no topo: nome, e-mail, Trocar senha, Usuários da equipe (admin) e Sair
    $('#btn-conta').hidden = false
    $('#conta-email').textContent = data.session.user.email
    $('#menu-senha').addEventListener('click', abrirTrocaSenha)
    $('#menu-usuarios').addEventListener('click', abrirUsuarios)
    $('#menu-sair').addEventListener('click', async (e) => {
      carregando(e.currentTarget, 'Saindo…')
      await supabase.auth.signOut()
      location.reload()
    })
    supabase.auth.onAuthStateChange((evento) => evento === 'SIGNED_OUT' && location.reload())

    // equipe: só membro ativo entra nos leads; admin cadastra e desativa usuários
    try {
      const [perfil, minhas] = await Promise.all([
        crm.meuPerfil(data.session.user.id),
        // sem a lista (CRM fora do ar, ou a migration de acessos ainda não rodou), as abas ficam como antes: quem barra é o banco
        crm.minhasTelas().catch((err) => (console.error('acessos:', err.message), null)),
      ])
      telas = minhas && new Set(minhas)
      if (perfil) $('#conta-nome').textContent = perfil.nome
      if (!perfil?.ativo) {
        logado = false
        aviso(perfil ? 'Sua conta foi desativada. Fale com o administrador do sistema.' : 'Sua conta ainda não faz parte da equipe. Peça ao administrador para cadastrar você.')
      } else if (perfil.papel === 'admin') {
        $('#menu-usuarios').hidden = false
      }
    } catch (err) {
      // sem conseguir ler a equipe, segue com o que a RLS deixar ver; só o cadastro de usuários não aparece
      console.error('equipe:', err.message)
    }
  } else if (config.local) {
    aviso('O CRM online não está ligado neste computador. A prospecção funciona, mas o envio ao kanban fica desativado até a configuração ser concluída.')
  } else {
    aviso('Sistema indisponível no momento: configuração incompleta.')
    return
  }
  if (!logado) {
    for (const nome of ['painel', 'kanban', 'leads', 'clientes']) delete abas[nome]
    for (const el of document.querySelectorAll('[data-crm]')) el.hidden = true
  }
  // a aba Google Maps mostra o mapa das empresas guardadas no CRM online, que não depende do PC
  mapaLigado = logado
  if (logado) {
    $('.aba[data-aba="buscas"]').hidden = false
    // com o mapa, o formulário da busca nova abre numa janela por cima dele
    $('#dlg-busca-corpo').append($('#form-busca'))
  } else if (!temPc) delete abas.buscas
  // acessos por tela: a aba e o botão da tela que a pessoa não abre somem (o banco e a API do PC recusam do mesmo jeito)
  if (logado && telas) {
    for (const b of document.querySelectorAll('.aba')) {
      if (telas.has(b.dataset.aba)) continue
      b.hidden = true
      delete abas[b.dataset.aba]
    }
    abreLeads = telas.has('kanban') || telas.has('leads')
    $('#btn-novo-lead').hidden = !abreLeads
    if (!telas.has('buscas')) $('#btn-busca-pc').hidden = true
  }
  // o botão do topo abre a busca nova de qualquer aba, por cima do mapa; trocar de tela leva o foco junto
  $('#btn-busca-pc').addEventListener('click', () => {
    if (abaAtual !== 'buscas') abrirAba('buscas')
    if (mapaLigado) $('#dlg-busca').showModal()
    else mostrarBuscasPc(true)
    $('#form-busca').elements.ramos.focus()
  })
  $('#voltar-mapa').addEventListener('click', () => {
    mostrarBuscasPc(false)
    $('#btn-busca-pc').focus()
  })
  if (config.local && config.urlWeb) {
    $('#link-web').href = config.urlWeb
    $('#link-web').hidden = false
  }

  $('#filtro-status').append(...opcoes(R.status, '', 'Todas'))
  $('#filtro-temperatura').append(...opcoes(R.temperatura, '', 'Todas'))
  cabecalhoLeads()
  // Esc fecha a ficha também com o foco na lista; no campo de busca o Esc só apaga o texto
  $('.leads-layout').addEventListener('keydown', (e) => e.key === 'Escape' && !e.target.closest('#filtros') && fecharFicha())

  for (const b of document.querySelectorAll('.aba')) b.addEventListener('click', () => abrirAba(b.dataset.aba))
  $('#btn-novo-lead').addEventListener('click', abrirNovoLead)

  let debounce
  $('#filtros').addEventListener('input', () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      Object.assign(filtro, Object.fromEntries(new FormData($('#filtros'))), { page: 1 })
      carregarLeads()
    }, 250)
  })
  $('#filtros').addEventListener('submit', (e) => e.preventDefault())

  $('#form-usuario').addEventListener(
    'submit',
    enviar(
      async (d, form) => {
        await crm.gerirUsuario({ acao: 'criar', ...d })
        form.reset()
        carregarUsuarios()
      },
      'Usuário cadastrado. Marque na lista as telas que a pessoa abre e avise para ela entrar em "Primeiro acesso" com este e-mail.',
      'Cadastrando…',
    ),
  )

  $('#form-busca').addEventListener(
    'submit',
    enviar(
      async ({ ramos, cidade, bairro, ...opcoes }, form) => {
        // uma busca por ramo: no mapa, cada uma vira um segmento daquele lugar
        const lista = [...new Set(String(ramos).split(/[,\n]/).map((r) => r.trim()).filter(Boolean))]
        for (const ramo of lista) await api('/api/buscas', { method: 'POST', body: { ...opcoes, ...buscaMaps({ ramos: ramo, cidade, bairro }), email: form.elements.email.checked } })
        form.elements.ramos.value = ''
        if (!mapaLigado) return carregarBuscas()
        fecharDialogo($('#dlg-busca'))
        acompanharBuscas()
      },
      'Busca enviada ao PC. Quando ela terminar, as empresas que ela achar aparecem aqui.',
      'Enviando…',
    ),
  )

  const inicial = location.hash.slice(1)
  // sem nenhuma aba (conta fora da equipe, no site) fica só o aviso
  if (Object.keys(abas).length) abrirAba(Object.hasOwn(abas, inicial) ? inicial : Object.keys(abas)[0])
  else if (logado) aviso('Sua conta ainda não abre nenhuma tela. Peça o acesso ao administrador.')
}

iniciar()
