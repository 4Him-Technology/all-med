// Prospecção na base de CNPJ da Receita (Postgres local do Docker): filtros na barra, resultados, detalhe e envio em lote para o kanban online
import { clienteDe, prepararClientes } from './clientes.js'
import { clientesAtivos, criarLead, enviarLeads, jaNoCrm } from './crm.js'
import { CONTATO, dataBr, etiquetasDosFiltros, FAIXAS, moeda, ORDEM_PORTES, ORDEM_SITUACOES, PORTES, SITUACOES } from './filtros.js'
import { config, supabase } from './supa.js'
import { $, api, carregando, esqueleto, estado, fecharDialogo, h, icone, norm, toast } from './ui.js'

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/

// shortcut: chama as funções SQL pelo servidor local; no Supabase vira supabase.rpc(nome, args), com os mesmos nomes e argumentos
const rpc = (nome, args = {}) => api(`/api/rpc/${nome}`, { method: 'POST', body: args })

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
const fmtCnpj = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
const fmtCnae = (c) => {
  const s = String(c ?? '').padStart(7, '0')
  return c ? `${s.slice(0, 4)}-${s[4]}/${s.slice(5)}` : ''
}
const fmtTel = (t) => t.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')

let iniciado = false
let ref // cnaes, naturezas e data da carga
let pagina = 1
let filtrosAtuais = {}
let buscou = false
let municipios = [] // todas as cidades com empresa na base: { codigo, nome, uf }
let sel = {}
let itens = [] // empresas da página na tela
let noCrm = new Map() // cnpj -> arquivada?, das empresas da página que já estão no CRM
// cnpj -> nome do cliente, das empresas da página que já são clientes ativos (a busca vem paginada do PC:
// esconder bagunçaria a contagem e as páginas, então elas aparecem marcadas e não vão para o kanban)
let clientesNaPagina = new Map()
const marcadas = new Map() // cnpj -> empresa; vale entre páginas da mesma busca

// Combobox com busca e etiquetas removíveis (UF, cidade, CNAE, natureza jurídica), no padrão ARIA:
// o foco fica no campo, as setas destacam a opção (aria-activedescendant), Enter escolhe, Esc fecha.
// A lista fica dentro do fluxo do painel do grupo, que rola e cortaria um menu flutuante.
function seletor({ id, rotulo, placeholder, opcoes, aoMudar, vazio = 'Nenhuma opção encontrada' }) {
  const escolhidos = new Map()
  const lista = h('ul', { class: 'sugestoes', id: `${id}-lista`, role: 'listbox', 'aria-label': rotulo, hidden: true })
  const chips = h('div', { class: 'chips' })
  let achados = []
  let ativo = -1

  const destacar = (i) => {
    ativo = i
    for (const [j, li] of [...lista.querySelectorAll('[role=option]')].entries()) {
      li.setAttribute('aria-selected', String(j === i))
      if (j === i) li.scrollIntoView({ block: 'nearest' })
    }
    if (i >= 0) input.setAttribute('aria-activedescendant', `${id}-op-${i}`)
    else input.removeAttribute('aria-activedescendant')
  }
  const fechar = () => {
    lista.hidden = true
    input.setAttribute('aria-expanded', 'false')
    destacar(-1)
  }
  const mostrar = () => {
    const t = norm(input.value.trim())
    if (!t) return fechar()
    achados = opcoes()
      .filter((o) => !escolhidos.has(o.valor) && norm(o.rotulo).includes(t))
      .slice(0, 12)
    // sem resultado, a lista avisa em vez de sumir (antes parecia que o campo não funcionava)
    lista.replaceChildren(
      ...(achados.length
        ? achados.map((o, i) =>
            h('li', { id: `${id}-op-${i}`, role: 'option', 'aria-selected': 'false', class: 'sugestao', onmousedown: (e) => e.preventDefault(), onclick: () => adicionar(o) }, o.rotulo),
          )
        : [h('li', { class: 'sugestao-vazia', role: 'presentation' }, vazio)]),
    )
    lista.hidden = false
    input.setAttribute('aria-expanded', 'true')
    destacar(achados.length ? 0 : -1)
  }
  const input = h('input', {
    id,
    type: 'search',
    placeholder,
    autocomplete: 'off',
    spellcheck: 'false',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': `${id}-lista`,
    oninput: mostrar,
    onblur: fechar,
    onkeydown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (lista.hidden) return mostrar()
        if (achados.length) destacar((ativo + (e.key === 'ArrowDown' ? 1 : -1) + achados.length) % achados.length)
      } else if (e.key === 'Enter') {
        // Enter com lista aberta escolhe a opção; sem lista, deixa o formulário buscar
        if (!lista.hidden && achados[ativo]) {
          e.preventDefault()
          adicionar(achados[ativo])
        }
      } else if (e.key === 'Escape' && !lista.hidden) {
        e.preventDefault()
        e.stopPropagation()
        fechar()
      } else if (e.key === 'Backspace' && !input.value && escolhidos.size) {
        // Backspace no campo vazio tira a última etiqueta, como nos campos de destinatário de e-mail
        escolhidos.delete([...escolhidos.keys()].at(-1))
        desenhar()
        aoMudar?.()
      }
    },
  })
  const desenhar = () => {
    chips.replaceChildren(
      ...[...escolhidos.values()].map((o) =>
        h(
          'span',
          { class: 'chip' },
          o.rotulo,
          h(
            'button',
            {
              type: 'button',
              'aria-label': `Remover ${o.rotulo}`,
              onclick: () => {
                escolhidos.delete(o.valor)
                desenhar()
                aoMudar?.()
                input.focus()
              },
            },
            icone('x', 12),
          ),
        ),
      ),
    )
  }
  function adicionar(o) {
    escolhidos.set(o.valor, o)
    input.value = ''
    fechar()
    desenhar()
    input.focus()
    aoMudar?.()
  }
  return {
    el: h('div', { class: 'seletor' }, h('label', { for: id }, rotulo), input, lista, chips),
    valores: () => [...escolhidos.keys()],
    rotulos: () => new Map([...escolhidos].map(([v, o]) => [v, o.rotulo])),
    remover(v) {
      escolhidos.delete(v)
      desenhar()
    },
    manterSo(validos) {
      for (const v of escolhidos.keys()) if (!validos.has(v)) escolhidos.delete(v)
      desenhar()
    },
    limpar() {
      escolhidos.clear()
      desenhar()
    },
  }
}

const caixas = (name, mapa, marcados = []) =>
  h('div', { class: 'caixas' }, (Array.isArray(mapa) ? mapa : Object.entries(mapa)).map(([v, r]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, value: v, checked: marcados.includes(v) }), r)))
const escolha = (rotulo, name, opcoes) => h('label', {}, rotulo, h('select', { name }, opcoes.map(([v, r]) => h('option', { value: v }, r))))
// cada grupo é uma seção do menu lateral que abre e fecha; localização e ramo já começam abertos
const ABERTOS = new Set(['local', 'ramo'])
const grupo = (chave, titulo, ...conteudo) =>
  h('details', { class: 'grupo', open: ABERTOS.has(chave) }, h('summary', {}, titulo, h('span', { class: 'contagem', 'data-grupo': chave, hidden: true }), icone('baixo', 15)), h('div', { class: 'grupo-corpo' }, conteudo))

// etiquetas do que está ligado; o x desliga só aquele filtro e, se já houve busca, refaz na hora
function desenharEtiquetas(f) {
  const etiquetas = etiquetasDosFiltros(f, { municipios: sel.cidades.rotulos(), cnaes: sel.cnaes.rotulos(), naturezas: sel.naturezas.rotulos() })
  const soOPadrao = etiquetas.length === 1 && etiquetas[0].campo === 'situacoes' && etiquetas[0].valor === '2'
  $('#etiquetas-filtros').replaceChildren(
    ...etiquetas.map((e) => h('span', { class: 'chip', title: e.rotulo }, h('span', { class: 'chip-texto' }, e.rotulo), h('button', { type: 'button', 'aria-label': `Tirar o filtro ${e.rotulo}`, onclick: () => tirarFiltro(e) }, icone('x', 12)))),
    etiquetas.length && !soOPadrao ? h('button', { type: 'button', class: 'link', onclick: () => (limpar(), refazer()) }, 'Limpar filtros') : '',
  )
}

function tirarFiltro({ campo, valor }) {
  const form = $('#form-prospeccao')
  const seletores = { ufs: sel.ufs, municipios: sel.cidades, cnaes: sel.cnaes, naturezas: sel.naturezas }
  if (seletores[campo]) {
    seletores[campo].remover(valor)
    if (campo === 'ufs') atualizarCidades()
  } else if (campo === 'bairros') {
    form.elements.bairros.value = form.elements.bairros.value
      .split(',')
      .map((b) => b.trim())
      .filter((b) => b && b !== valor)
      .join(', ')
  } else if (['situacoes', 'portes', 'faixas_socio', 'contato'].includes(campo)) {
    form.querySelector(`input[name="${campo}"][value="${CSS.escape(valor)}"]`).checked = false
  } else if (campo === 'incluir_secundarios') form.elements.incluir_secundarios.checked = false
  else form.elements[campo].value = ''
  atualizarContagens()
  // a etiqueta clicada sumiu: o foco vai para a próxima, ou para o Buscar
  ;($('#etiquetas-filtros .chip button') ?? $('#btn-buscar')).focus()
  refazer()
}

function refazer() {
  if (!buscou) return
  filtrosAtuais = coletar($('#form-prospeccao'))
  buscar()
}

// número de filtros ativos ao lado de cada grupo, para ver o que está ligado mesmo com o grupo fechado
function atualizarContagens() {
  const f = coletar($('#form-prospeccao'))
  const n = (...vs) => vs.reduce((s, v) => s + (Array.isArray(v) ? v.length : v ? 1 : 0), 0)
  const contagens = {
    local: n(f.ufs, f.municipios, f.bairros),
    ramo: n(f.cnaes),
    situacao: n(f.situacoes),
    perfil: n(f.portes, f.simples, f.mei, f.matriz, f.naturezas),
    abertura: n(f.abertura_de, f.abertura_ate, f.capital_min != null, f.capital_max != null),
    contato: n(...Object.keys(CONTATO).map((k) => f[k]), f.faixas_socio),
  }
  for (const el of document.querySelectorAll('.contagem')) {
    const c = contagens[el.dataset.grupo]
    el.hidden = !c
    el.textContent = String(c)
    el.setAttribute('aria-label', `${c} filtro${c === 1 ? '' : 's'} ativo${c === 1 ? '' : 's'}`)
  }
  desenharEtiquetas(f)
}

function montarFormulario(form) {
  sel.ufs = seletor({
    id: 'f-ufs',
    rotulo: 'Estados',
    placeholder: 'Ex.: SP',
    opcoes: () => UFS.map((u) => ({ valor: u, rotulo: u })),
    aoMudar: () => {
      atualizarCidades()
      atualizarContagens()
    },
    vazio: 'Use a sigla do estado, ex.: SP',
  })
  sel.cidades = seletor({
    id: 'f-cidades',
    rotulo: 'Cidades',
    placeholder: 'Ex.: Campinas, Ribeirão Preto…',
    aoMudar: atualizarContagens,
    vazio: config.demo ? 'Nenhuma cidade com esse nome. Na demonstração só existem São Paulo e Campinas.' : 'Nenhuma cidade com esse nome na base carregada.',
    opcoes: () => {
      const ufs = sel.ufs.valores()
      return municipios.filter((m) => !ufs.length || ufs.includes(m.uf)).map((m) => ({ valor: m.codigo, rotulo: `${m.nome} - ${m.uf}` }))
    },
  })
  sel.cnaes = seletor({
    id: 'f-cnaes',
    rotulo: 'Ramo de atividade (CNAE)',
    placeholder: 'Ex.: odontológica, restaurante ou 8630…',
    aoMudar: atualizarContagens,
    vazio: 'Nenhuma atividade com esse nome ou código.',
    opcoes: () => ref.cnaes.map((c) => ({ valor: c.codigo, rotulo: `${fmtCnae(c.codigo)} ${c.descricao}` })),
  })
  sel.naturezas = seletor({
    id: 'f-naturezas',
    rotulo: 'Natureza jurídica',
    placeholder: 'Ex.: limitada, empresário individual…',
    aoMudar: atualizarContagens,
    opcoes: () => ref.naturezas.map((n) => ({ valor: n.codigo, rotulo: n.descricao })),
  })

  form.replaceChildren(
    config.demo && h('p', { class: 'aviso-demo' }, icone('alerta'), h('span', {}, h('strong', {}, 'Modo demonstração. '), 'Só 5 empresas fictícias, em São Paulo e Campinas. Os dados reais aparecem quando a base da Receita for carregada.')),
    grupo('local', 'Localização', sel.ufs.el, sel.cidades.el, h('label', {}, 'Bairros (separados por vírgula)', h('input', { name: 'bairros', placeholder: 'Ex.: Centro, Vila Mariana…', autocomplete: 'off', spellcheck: 'false' }))),
    grupo('ramo', 'Ramo de atividade', sel.cnaes.el, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'incluir_secundarios' }), 'Incluir quem tem o ramo como atividade secundária')),
    grupo('situacao', 'Situação', caixas('situacoes', ORDEM_SITUACOES, ['2'])),
    grupo('perfil', 'Perfil da empresa', h('p', { class: 'muted pequeno' }, 'Porte'), caixas('portes', ORDEM_PORTES), escolha('Simples Nacional', 'simples', [['', 'Tanto faz'], ['sim', 'Optante'], ['nao', 'Não optante']]), escolha('MEI', 'mei', [['', 'Tanto faz'], ['sim', 'Somente MEI'], ['nao', 'Excluir MEI']]), escolha('Matriz ou filial', 'matriz', [['', 'Matriz e filial'], ['matriz', 'Somente matriz'], ['filial', 'Somente filial']]), sel.naturezas.el),
    grupo(
      'abertura',
      'Abertura e capital',
      h('div', { class: 'par' }, h('label', {}, 'Aberta de', h('input', { type: 'date', name: 'abertura_de' })), h('label', {}, 'Aberta até', h('input', { type: 'date', name: 'abertura_ate' }))),
      h('div', { class: 'par' }, h('label', {}, 'Capital mínimo (R$)', h('input', { type: 'number', inputmode: 'numeric', name: 'capital_min', min: '0', step: '1000' })), h('label', {}, 'Capital máximo (R$)', h('input', { type: 'number', inputmode: 'numeric', name: 'capital_max', min: '0', step: '1000' }))),
    ),
    grupo('contato', 'Contato e sócios', caixas('contato', CONTATO), h('p', { class: 'muted pequeno' }, 'Idade do sócio principal (a Receita informa só a faixa)'), caixas('faixas_socio', FAIXAS)),
    h('div', { class: 'pe-filtros' }, h('p', { class: 'erro-filtros', id: 'erro-filtros', role: 'alert', hidden: true }), h('button', { class: 'primario', id: 'btn-buscar' }, icone('buscar'), 'Buscar')),
  )
  if (ref.carga?.mes_referencia) $('.ativos').append(h('span', { class: 'muted pequeno base-receita' }, `Base da Receita de ${ref.carga.mes_referencia}`))
  atualizarContagens()
}

function atualizarCidades() {
  const ufs = sel.ufs.valores()
  // cidade fora dos estados escolhidos sai da seleção (os dois filtros juntos dariam zero resultado)
  if (ufs.length) sel.cidades.manterSo(new Set(municipios.filter((m) => ufs.includes(m.uf)).map((m) => m.codigo)))
}

function coletar(form) {
  const fd = new FormData(form)
  const f = {}
  const por = (k, v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return
    f[k] = v
  }
  por('ufs', sel.ufs.valores())
  por('municipios', sel.cidades.valores())
  por(
    'bairros',
    String(fd.get('bairros') ?? '')
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean),
  )
  por('cnaes', sel.cnaes.valores())
  if (f.cnaes && fd.get('incluir_secundarios')) f.incluir_secundarios = true
  por('situacoes', fd.getAll('situacoes').map(Number))
  por('portes', fd.getAll('portes').map(Number))
  por('naturezas', sel.naturezas.valores())
  por('faixas_socio', fd.getAll('faixas_socio').map(Number))
  for (const k of ['simples', 'mei', 'matriz', 'abertura_de', 'abertura_ate']) por(k, fd.get(k))
  for (const k of ['capital_min', 'capital_max']) por(k, fd.get(k) === '' ? null : Number(fd.get(k)))
  for (const k of fd.getAll('contato')) f[k] = true
  return f
}

function limpar() {
  const form = $('#form-prospeccao')
  form.reset()
  for (const s of Object.values(sel)) s.limpar()
  erroFiltros(null)
  atualizarContagens()
}

// problema nos filtros aparece junto do botão, e o foco vai para o campo que resolve
function erroFiltros(msg, campo) {
  const el = $('#erro-filtros')
  el.hidden = !msg
  el.textContent = msg ?? ''
  campo?.focus()
}

function estadoInicial() {
  $('#tabela-empresas').hidden = true
  $('#paginacao-empresas').replaceChildren()
  $('#resumo-busca').textContent = ''
  $('#estado-prospeccao').replaceChildren(estado({ titulo: 'Monte sua lista de empresas', texto: 'Escolha ao menos um estado, uma cidade ou um ramo de atividade nos filtros e clique em Buscar. Os outros filtros refinam o resultado.' }))
}

// abre o grupo do campo antes de focar, senão o foco vai para um campo escondido
function abrirGrupoDe(campo) {
  const d = campo.closest('details')
  if (d) d.open = true
  return campo
}

async function buscar(nova = true) {
  if (nova) {
    pagina = 1
    marcadas.clear()
    desenharBarra()
  }
  const f = filtrosAtuais
  if (!f.ufs && !f.municipios && !f.cnaes) return erroFiltros('Escolha ao menos um estado, uma cidade ou um ramo de atividade.', abrirGrupoDe($('#f-cidades')))
  if (f.bairros && !f.municipios) return erroFiltros('Para buscar por bairro, escolha também a cidade.', abrirGrupoDe($('#f-cidades')))
  erroFiltros(null)
  buscou = true

  const corpo = $('#lista-empresas')
  $('#estado-prospeccao').replaceChildren()
  $('#tabela-empresas').hidden = false
  corpo.classList.remove('atualizado')
  corpo.replaceChildren(...Array.from({ length: 6 }, () => h('tr', {}, h('td', { colspan: '7' }, esqueleto('linha')))))
  $('#resumo-busca').textContent = 'Buscando…'
  const restaurar = carregando($('#btn-buscar'), 'Buscando…')
  try {
    const r = await rpc('buscar_empresas', { filtros: f, pagina, por_pagina: 50 })
    const total = `${r.total.toLocaleString('pt-BR')}${r.total_limitado ? '+' : ''}`
    $('#resumo-busca').textContent = r.total ? `${total} ${r.total === 1 && !r.total_limitado ? 'empresa encontrada' : 'empresas encontradas'}` : ''
    if (!r.itens.length) {
      $('#tabela-empresas').hidden = true
      $('#estado-prospeccao').replaceChildren(estado({ titulo: 'Nenhuma empresa com esses filtros', texto: 'Tente tirar um filtro de contato ou de perfil, incluir a atividade secundária ou ampliar a localização.' }))
    } else {
      itens = r.itens
      // o CRM fora do ar não pode esconder a lista: sem a resposta, só não aparece quem já está no kanban ou é cliente
      const [noKanban, clientes] = await Promise.all([
        jaNoCrm(itens.map((e) => e.cnpj)).catch((err) => (console.error('CRM:', err.message), new Map())),
        (supabase ? clientesAtivos() : Promise.resolve([])).catch((err) => (console.error('clientes:', err.message), [])),
      ])
      noCrm = noKanban
      const preparados = prepararClientes(clientes)
      clientesNaPagina = new Map(itens.map((e) => [e.cnpj, (clienteDe(e.razao_social, preparados) ?? clienteDe(e.nome_fantasia, preparados))?.nome]).filter(([, c]) => c))
      desenharLinhas()
      // um único movimento: a lista nova aparece de uma vez, sem efeito em cascata
      corpo.classList.add('atualizado')
    }
    const paginas = Math.max(1, Math.ceil(r.total / r.por_pagina))
    $('#paginacao-empresas').replaceChildren(
      ...(r.itens.length
        ? [
            h('button', { type: 'button', disabled: pagina <= 1, onclick: () => irPara(pagina - 1) }, 'Anterior'),
            h('span', {}, `Página ${pagina} de ${paginas.toLocaleString('pt-BR')}${r.total_limitado ? '+' : ''}`),
            h('button', { type: 'button', disabled: pagina >= paginas || pagina >= 1000, onclick: () => irPara(pagina + 1) }, 'Próxima'),
          ]
        : []),
    )
  } catch (err) {
    $('#tabela-empresas').hidden = true
    $('#resumo-busca').textContent = ''
    $('#estado-prospeccao').replaceChildren(estado({ tipo: 'erro', titulo: 'A busca não funcionou', texto: err.message, acao: h('button', { type: 'button', onclick: () => buscar(false) }, 'Tentar de novo') }))
  } finally {
    restaurar()
  }
}

function irPara(n) {
  pagina = n
  buscar(false)
  $('#aba-prospeccao').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}

const situacao = (e) => h('span', { class: `pill sit-${e.situacao}` }, SITUACOES[e.situacao] ?? 'Sem situação')
const regimes = (e) => [PORTES[e.porte], e.mei ? 'MEI' : e.simples ? 'Simples' : null].filter(Boolean).join(' · ')

function contatos(e) {
  return h(
    'div',
    { class: 'contatos' },
    e.telefones.map((t) => h('span', { class: 'contato' }, h('span', { class: 'num' }, fmtTel(t.numero)), h('span', { class: `tag tel-${t.tipo ?? 'outro'}` }, t.tipo === 'celular' ? 'Celular' : t.tipo === 'fixo' ? 'Fixo' : 'Tel.'))),
    e.email && h('span', { class: 'email' }, e.email, e.email_contabilidade && h('span', { class: 'tag t-morno', title: 'Esse e-mail aparece em várias empresas ou parece ser de escritório contábil' }, 'Contabilidade')),
    !e.telefones.length && !e.email && h('span', { class: 'muted' }, 'Sem contato'),
  )
}

const nomeEmpresa = (e) => e.nome_fantasia ?? e.razao_social ?? fmtCnpj(e.cnpj)
// sem CRM ligado neste PC não há para onde mandar: a coluna de marcar fica vazia
const marcavel = (e) => Boolean(supabase) && !noCrm.has(e.cnpj) && !clientesNaPagina.has(e.cnpj)
const etiquetaCliente = (e) => h('span', { class: 'ja', title: `Cliente ativo: ${clientesNaPagina.get(e.cnpj)}` }, 'Cliente ativo')

function desenharLinhas() {
  $('#lista-empresas').replaceChildren(...itens.map(linhaEmpresa))
  atualizarMarcarPagina()
}

function atualizarMarcarPagina() {
  const todas = $('#marcar-pagina')
  const marcaveis = itens.filter(marcavel)
  const quantas = marcaveis.filter((e) => marcadas.has(e.cnpj)).length
  todas.hidden = !supabase
  todas.disabled = !marcaveis.length
  todas.checked = quantas > 0 && quantas === marcaveis.length
  todas.indeterminate = quantas > 0 && quantas < marcaveis.length
}

function marcar(e, sim) {
  if (sim) marcadas.set(e.cnpj, e)
  else marcadas.delete(e.cnpj)
}

function marcarPagina(sim) {
  for (const e of itens.filter(marcavel)) marcar(e, sim)
  desenharLinhas()
  desenharBarra()
}

function limparMarcadas() {
  marcadas.clear()
  desenharLinhas()
  desenharBarra()
  $('#marcar-pagina').focus()
}

// barra escura fixa embaixo: aparece com a primeira empresa marcada e manda todas de uma vez
function desenharBarra() {
  const barra = $('#barra-lote')
  if (!barra.childElementCount) {
    barra.append(
      h('span', { class: 'contagem-lote', 'aria-live': 'polite' }),
      h('button', { type: 'button', class: 'link', onclick: limparMarcadas }, 'Limpar'),
      h('button', { type: 'button', class: 'branco', id: 'btn-mandar-lote', onclick: (ev) => mandarMarcadas(ev.currentTarget) }),
    )
  }
  const n = marcadas.size
  barra.hidden = !n
  barra.querySelector('.contagem-lote').textContent = `${n} ${n === 1 ? 'empresa marcada' : 'empresas marcadas'}`
  barra.querySelector('#btn-mandar-lote').replaceChildren(icone('enviar', 15), `Mandar ${n} para o kanban`)
}

async function mandarMarcadas(botao) {
  const empresas = [...marcadas.values()]
  const restaurar = carregando(botao, 'Mandando…')
  try {
    const novos = await enviarLeads(empresas.map(leadDaEmpresa), 'cnpj')
    const repetidas = empresas.length - novos
    toast(`${novos} ${novos === 1 ? 'empresa nova' : 'empresas novas'} na coluna Novo do kanban${repetidas ? `; ${repetidas} já ${repetidas === 1 ? 'estava' : 'estavam'} no CRM` : ''}`)
    marcadas.clear()
    noCrm = await jaNoCrm(itens.map((e) => e.cnpj)).catch(() => noCrm)
  } catch (err) {
    toast(err.message, 'erro')
  }
  restaurar()
  desenharLinhas()
  desenharBarra()
  if (!marcadas.size) $('#resumo-busca').focus()
}

const linhaEmpresa = (e) =>
  h(
    'tr',
    { class: marcadas.has(e.cnpj) ? 'sel' : null },
    h(
      'td',
      { class: 'col-marcar' },
      noCrm.has(e.cnpj)
        ? h('span', { class: 'ja' }, noCrm.get(e.cnpj) ? 'Arquivada' : 'No kanban')
        : clientesNaPagina.has(e.cnpj)
          ? etiquetaCliente(e)
          : marcavel(e) &&
            h('input', {
              type: 'checkbox',
              checked: marcadas.has(e.cnpj),
              'aria-label': `Marcar ${nomeEmpresa(e)}`,
              onchange: (ev) => {
                marcar(e, ev.currentTarget.checked)
                ev.currentTarget.closest('tr').classList.toggle('sel', ev.currentTarget.checked)
                desenharBarra()
                atualizarMarcarPagina()
              },
            }),
    ),
    h(
      'td',
      {},
      h('button', { type: 'button', class: 'link', onclick: () => abrirEmpresa(e) }, nomeEmpresa(e)),
      e.nome_fantasia && h('div', { class: 'muted pequeno' }, e.razao_social),
      h('div', { class: 'muted pequeno num' }, `${fmtCnpj(e.cnpj)} · ${e.matriz ? 'Matriz' : 'Filial'}`),
    ),
    h('td', {}, e.cnae_descricao ?? '', h('div', { class: 'muted pequeno num' }, fmtCnae(e.cnae_principal))),
    h('td', {}, `${e.municipio_nome ?? ''}${e.uf ? `/${e.uf}` : ''}`, e.bairro && h('div', { class: 'muted pequeno' }, e.bairro)),
    h('td', {}, situacao(e), h('div', { class: 'muted pequeno' }, regimes(e))),
    h('td', { class: 'num' }, dataBr(e.data_inicio)),
    h('td', {}, contatos(e)),
  )

// Empresa da Receita no formato do lead do CRM (o celular vai primeiro: é o que atende)
function leadDaEmpresa(e) {
  const tel = e.telefones.find((t) => t.tipo === 'celular') ?? e.telefones[0]
  const endereco = [[e.logradouro, e.numero, e.complemento].filter(Boolean).join(', '), e.bairro, `${e.municipio_nome ?? ''}${e.uf ? `/${e.uf}` : ''}`, e.cep && `CEP ${e.cep}`].filter(Boolean).join(' - ')
  const obs = [
    e.nome_fantasia && `Razão social: ${e.razao_social}`,
    `Situação: ${SITUACOES[e.situacao] ?? '-'} · ${regimes(e) || 'porte não informado'}`,
    e.capital_social != null && `Capital social: ${moeda.format(e.capital_social)}`,
    e.data_inicio && `Aberta em ${dataBr(e.data_inicio)}`,
    e.telefones.length > 1 && `Outros telefones: ${e.telefones.slice(1).map((t) => fmtTel(t.numero)).join(', ')}`,
    e.email_contabilidade && 'O e-mail cadastrado parece ser do escritório de contabilidade.',
  ].filter(Boolean)
  return {
    nome: (e.nome_fantasia ?? e.razao_social ?? fmtCnpj(e.cnpj)).slice(0, 200),
    cnpj: e.cnpj,
    origem: 'receita',
    categoria: e.cnae_descricao?.slice(0, 200) ?? null,
    telefone: tel ? fmtTel(tel.numero) : null,
    emails: e.email && EMAIL.test(e.email) && e.email.length <= 200 ? [e.email] : [],
    endereco: endereco.slice(0, 500) || null,
    observacoes: obs.join('\n'),
  }
}

async function paraKanban(e, botao, aoCriar) {
  const restaurar = carregando(botao, 'Enviando…')
  const marcar = (texto) => {
    if (!botao) return
    botao.removeAttribute('aria-busy')
    botao.disabled = true
    botao.replaceChildren(icone('ok', 14), texto)
  }
  // a linha da lista passa a mostrar "No kanban" e sai das marcadas
  const naLista = () => {
    noCrm.set(e.cnpj, false)
    marcadas.delete(e.cnpj)
    desenharLinhas()
    desenharBarra()
  }
  try {
    const lead = await criarLead(leadDaEmpresa(e))
    marcar('No kanban')
    naLista()
    toast('Empresa enviada para a coluna Novo do kanban')
    aoCriar?.(lead)
  } catch (err) {
    if (/já está no CRM/.test(err.message)) {
      marcar('Já no CRM')
      naLista()
    } else restaurar()
    toast(err.message, 'erro')
  }
}

let abrirLeadCrm
async function abrirEmpresa(e) {
  const dlg = $('#drawer')
  const corpoSocios = h('div', {}, esqueleto('bloco'))
  const corpoSecundarias = h('div', {}, esqueleto('linha'))
  dlg.replaceChildren(
    h(
      'div',
      { class: 'drawer-corpo' },
      h(
        'header',
        { class: 'drawer-topo' },
        h('div', {}, h('h2', { id: 'drawer-titulo' }, e.nome_fantasia ?? e.razao_social), h('p', { class: 'muted' }, `${e.razao_social ?? ''} · CNPJ ${fmtCnpj(e.cnpj)}`)),
        h('button', { type: 'button', class: 'fechar', 'aria-label': 'Fechar', onclick: () => fecharDialogo(dlg) }, icone('x', 20)),
      ),
      h(
        'div',
        { class: 'atalhos' },
        situacao(e),
        h('span', { class: 'muted' }, regimes(e)),
        clientesNaPagina.has(e.cnpj) ? etiquetaCliente(e) : h('button', { type: 'button', class: 'primario', onclick: (ev) => paraKanban(e, ev.currentTarget, (lead) => abrirLeadCrm?.(lead.id)) }, icone('mais'), 'Adicionar ao kanban'),
      ),
      h(
        'dl',
        { class: 'ficha' },
        [
          ['Atividade principal', `${fmtCnae(e.cnae_principal)} ${e.cnae_descricao ?? ''}`],
          ['Natureza jurídica', e.natureza_descricao],
          ['Abertura', dataBr(e.data_inicio)],
          ['Situação desde', dataBr(e.data_situacao)],
          ['Capital social', e.capital_social != null && moeda.format(e.capital_social)],
          ['Tipo', e.matriz ? 'Matriz' : 'Filial'],
          ['Endereço', [[e.logradouro, e.numero, e.complemento].filter(Boolean).join(', '), e.bairro, `${e.municipio_nome ?? ''}/${e.uf ?? ''}`, e.cep && `CEP ${e.cep}`].filter(Boolean).join(' - ')],
        ]
          .filter(([, v]) => v)
          .flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
      ),
      h('h3', {}, 'Contato'),
      contatos(e),
      h('h3', {}, 'Atividades secundárias'),
      corpoSecundarias,
      h('h3', {}, 'Quadro de sócios'),
      corpoSocios,
    ),
  )
  if (!dlg.open) dlg.showModal()
  try {
    const d = await rpc('cnpj_detalhe', { p_cnpj: e.cnpj })
    corpoSecundarias.replaceChildren(d?.cnaes_secundarios?.length ? h('ul', { class: 'lista-simples' }, d.cnaes_secundarios.map((c) => h('li', {}, `${fmtCnae(c.codigo)} ${c.descricao ?? ''}`))) : h('p', { class: 'muted' }, 'Nenhuma.'))
    corpoSocios.replaceChildren(
      d?.socios?.length
        ? h('ul', { class: 'lista-simples' }, d.socios.map((s) => h('li', {}, h('strong', {}, s.nome ?? '-'), h('div', { class: 'muted pequeno' }, [s.qualificacao, s.tipo, s.faixa_etaria, s.data_entrada && `desde ${dataBr(s.data_entrada)}`].filter(Boolean).join(' · ')))))
        : h('p', { class: 'muted' }, e.mei ? 'MEI não tem quadro de sócios na Receita.' : 'Sem sócios informados.'),
    )
  } catch (err) {
    corpoSocios.replaceChildren(h('p', { class: 'erro' }, `Não foi possível carregar os sócios: ${err.message}`))
    corpoSecundarias.replaceChildren()
  }
}

export async function carregarProspeccao({ abrirLead }) {
  abrirLeadCrm = abrirLead
  if (iniciado) return
  const form = $('#form-prospeccao')
  form.replaceChildren(esqueleto('titulo'), esqueleto('bloco'), esqueleto('bloco'))
  try {
    ;[ref, municipios] = await Promise.all([rpc('cnpj_referencias'), rpc('cnpj_municipios', {})])
  } catch (err) {
    form.replaceChildren(estado({ tipo: 'erro', titulo: 'A base de empresas não respondeu', texto: err.message, acao: h('button', { type: 'button', onclick: () => carregarProspeccao({ abrirLead }) }, 'Tentar de novo') }))
    return
  }
  iniciado = true
  montarFormulario(form)
  estadoInicial()
  $('#marcar-pagina').addEventListener('change', (ev) => marcarPagina(ev.currentTarget.checked))
  form.addEventListener('input', atualizarContagens)
  form.addEventListener('change', atualizarContagens)
  form.addEventListener('submit', (ev) => {
    ev.preventDefault()
    filtrosAtuais = coletar(form)
    buscar()
  })
}
