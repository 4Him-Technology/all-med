// Aba Google Maps: todas as empresas da pesquisa guardadas no CRM online num mapa só.
// O painel ao lado tem a busca, os filtros e a lista, que mostra o que está na área do mapa; a ficha da empresa abre no mapa.
// A lógica sem tela (filtros, contagens, área do mapa) está em lugares.js. Quem já é cliente ativo não aparece, e quem
// tem nome parecido com um cliente aparece com o aviso "Parece cliente" (clientes.js).
// As buscas novas pelo PC entram aqui sozinhas quando terminam (buscas-mapa.js chama recarregarMapa).
import { clienteDe, parecidoCom, prepararClientes } from './clientes.js'
import { clientesAtivos, empresasMaps, enviarLeads } from './crm.js'
import { FILTRO_VAZIO, etiquetasDoMapa, facetas, filtrarLugares, juntarLugares, leadDoLugar, linkWhatsApp, listarOpcoes, naArea, ordenarLugares, regioes, resumoDaArea, rotuloLocal, semEtiqueta, tipoTelefone } from './lugares.js'
import { $, avaliacao, carregando, esqueleto, estado, h, icone, toast } from './ui.js'

const LOTE = 60 // linhas da lista montadas por vez; as próximas entram quando a lista rola até o fim
const SEM_CONFIRMAR = 50 // acima disso, mandar ao kanban pede um segundo clique
const CORES = 7 // cores de segmento no CSS (.seg-0 a .seg-6)
const VALIDADE = 120_000 // voltar à aba depois disso relê as empresas em segundo plano
const NOTAS = [[0, 'Qualquer nota'], [3.5, '3,5 ou mais'], [4, '4,0 ou mais'], [4.5, '4,5 ou mais']]
const PAINEIS = [['regiao', 'Região'], ['categoria', 'Categoria'], ['mais', 'Mais filtros']]

const alfabetica = new Intl.Collator('pt-BR').compare
const numero = (n) => n.toLocaleString('pt-BR')
const semMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const temLugar = (l) => l.latitude != null && l.longitude != null

const s = {
  todos: null, // todas as empresas, uma por place_id
  lugares: null, // as que aparecem: todas menos as que já são clientes ativos
  clientes: undefined, // a lista de clientes usada na última separação; null quando não carregou
  porId: new Map(),
  segmentos: [],
  locais: [],
  lidoEm: 0,
  lendo: null,
  filtro: FILTRO_VAZIO,
  facetas: { segmentos: new Map(), locais: new Map(), categorias: new Map() },
  ordem: 'nome',
  filtradas: [], // passam nos filtros
  visiveis: [], // filtradas que estão na área do mapa, na ordem da lista
  mostradas: 0, // quantas linhas da lista já estão montadas
  assinatura: '',
  marcadas: new Set(), // place_id
  aberta: null, // place_id da ficha aberta no mapa
  sobre: null, // place_id da linha sob o ponteiro ou com o foco
  painel: null, // filtro aberto no painel: regiao, categoria ou mais
  termoCategoria: '',
  ui: null,
  L: null,
  mapa: null,
  grupo: null,
  popup: null,
  anel: null,
  pinos: new Map(),
  pularMovimento: false,
  devolverFoco: null,
}

// ---------- Leaflet e agrupamento de pinos: só baixam quando um mapa abre ----------
// versões fixas com SRI (hashes conferidos no jsDelivr: Leaflet em 28/10/2026, agrupamento em 11/11/2026)
const CDN = 'https://cdn.jsdelivr.net/npm/'
const baixar = (tag, attrs) => new Promise((ok, falha) => document.head.append(h(tag, { ...attrs, crossorigin: 'anonymous', onload: ok, onerror: () => falha(new Error(`não carregou ${attrs.href ?? attrs.src}`)) })))

// baixa uma vez só; se falhar, a próxima chamada tenta de novo
function umaVez(carregar) {
  let pedido
  return () =>
    (pedido ??= carregar().catch((err) => {
      pedido = null
      throw err
    }))
}

export const carregarLeaflet = umaVez(() =>
  Promise.all([
    baixar('link', { rel: 'stylesheet', href: `${CDN}leaflet@1.9.4/dist/leaflet.css`, integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=' }),
    baixar('script', { src: `${CDN}leaflet@1.9.4/dist/leaflet.js`, integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=' }),
  ]).then(() => window.L),
)

// leaflet.markercluster junta os pinos próximos num círculo com a contagem; precisa do Leaflet já carregado.
// As duas transições do CSS dele estão no style.css, então só o script é baixado.
const carregarAgrupador = umaVez(async () => {
  const L = await carregarLeaflet()
  await baixar('script', { src: `${CDN}leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js`, integrity: 'sha256-Hk4dIpcqOSb0hZjgyvFOP+cEmDXUKKNE/tT542ZbNQg=' })
  return L
})

// ---------- entrada ----------
// Chamado toda vez que o mapa aparece (ao abrir a aba ou ao voltar das buscas do PC)
export function abrirMapa() {
  if (s.mapa) {
    // o mapa nasce sem tamanho se a aba foi trocada enquanto ele carregava
    const semTamanho = !s.mapa.getSize().x
    s.mapa.invalidateSize()
    if (semTamanho) enquadrar()
  }
  if (s.lendo) return s.lendo
  // dentro da validade, só confere se a lista de clientes mudou na tela Clientes ativos
  if (s.lugares && Date.now() - s.lidoEm < VALIDADE) return conferirClientes()
  const primeira = !s.lugares
  if (primeira) {
    $('#pm-topo').replaceChildren(esqueleto('linha'), esqueleto('linha'))
    $('#pm-lista').replaceChildren(...Array.from({ length: 8 }, () => h('li', { 'aria-hidden': 'true' }, esqueleto('lm-skel'))))
  }
  s.lendo = lerEmpresas(primeira).finally(() => (s.lendo = null))
  return s.lendo
}

// Relê as empresas agora (uma busca do PC acabou de entrar ou foi excluída), mesmo com a aba em outra tela.
// Se o mapa ainda não abriu nesta visita, a primeira abertura já lê tudo.
export async function recarregarMapa() {
  if (!s.lugares) return
  await s.lendo
  s.lendo = lerEmpresas(false).finally(() => (s.lendo = null))
  return s.lendo
}

// "Ver no mapa" de uma busca: filtra pelo segmento e pelo local dela e enquadra as empresas
export function mostrarBusca(segmento, local) {
  if (!s.ui) return
  s.filtro = { ...FILTRO_VAZIO, segmentos: [segmento], locais: [local] }
  s.termoCategoria = ''
  s.ui.q.value = ''
  aplicar()
}

async function lerEmpresas(primeira) {
  let linhas, clientes
  try {
    // a lista de clientes fora do ar não segura o mapa: as empresas aparecem, e o painel avisa
    ;[linhas, clientes] = await Promise.all([empresasMaps(), clientesAtivos().catch((err) => (console.error('clientes:', err.message), null))])
  } catch (err) {
    // na releitura em segundo plano, o que já está na tela continua valendo
    if (!primeira) return
    $('#pm-topo').replaceChildren()
    $('#pm-lista').replaceChildren(h('li', {}, estado({ tipo: 'erro', titulo: 'As empresas não carregaram', texto: err.message, acao: h('button', { type: 'button', onclick: abrirMapa }, 'Tentar de novo') })))
    return
  }
  s.todos = juntarLugares(linhas)
  s.lidoEm = Date.now()
  s.segmentos = [...new Set(s.todos.flatMap((l) => l.segmentos))].sort(alfabetica)
  s.locais = [...new Set(s.todos.flatMap((l) => l.locais))]
  // segmento ou local que sumiu (busca excluída) sai do filtro, senão a lista ficaria vazia sem motivo à vista
  s.filtro = { ...s.filtro, segmentos: s.filtro.segmentos.filter((v) => s.segmentos.includes(v)), locais: s.filtro.locais.filter((v) => s.locais.includes(v)) }
  // a cor do pino é a do primeiro segmento da empresa
  for (const l of s.todos) l.seg = s.segmentos.indexOf(l.segmentos[0]) % CORES
  separarClientes(clientes)
  // os pinos guardam a empresa da leitura anterior: são refeitos
  s.pinos.clear()
  s.assinatura = ''
  if (primeira) {
    montarPainel()
    montarMapa()
  }
  aplicar({ ajustar: primeira })
  desenharBarra()
  desenharNotaClientes()
}

// Tira do mapa quem já é cliente ativo. Sem a lista (null), nada some e o painel avisa.
function separarClientes(clientes) {
  s.clientes = clientes
  const preparados = prepararClientes(clientes ?? [])
  for (const l of s.todos) {
    l.cliente = clienteDe(l.nome, preparados)?.nome ?? null
    l.parecido = l.cliente ? null : (parecidoCom(l.nome, preparados)?.nome ?? null)
  }
  s.lugares = s.todos.filter((l) => !l.cliente)
  s.porId = new Map(s.lugares.map((l) => [l.place_id, l]))
  // marcada que virou cliente, ou que já foi para o kanban, sai da seleção
  for (const id of s.marcadas) if (s.porId.get(id)?.enviado !== false) s.marcadas.delete(id)
}

// a lista de clientes guardada só muda quando alguém cadastra ou tira um cliente
async function conferirClientes() {
  const clientes = await clientesAtivos().catch(() => s.clientes)
  if (clientes === s.clientes) return
  separarClientes(clientes)
  s.assinatura = ''
  aplicar({ ajustar: false })
  desenharBarra()
  desenharNotaClientes()
}

function desenharNotaClientes() {
  const el = s.ui.notaClientes
  const n = s.todos.length - s.lugares.length
  const parecidas = s.lugares.filter((l) => l.parecido).length
  el.classList.toggle('erro', s.clientes === null)
  el.hidden = s.clientes !== null && !n && !parecidas
  if (s.clientes === null) el.replaceChildren(icone('alerta', 14), 'A lista de clientes ativos não carregou: eles podem aparecer no mapa.')
  else
    // replaceChildren escreveria "false" na tela: as partes que não valem saem antes
    el.replaceChildren(
      ...[
        n > 0 && `${numero(n)} ${n === 1 ? 'empresa é cliente ativo e não aparece aqui.' : 'empresas são clientes ativos e não aparecem aqui.'} `,
        parecidas > 0 && `${numero(parecidas)} ${parecidas === 1 ? 'tem nome parecido com um cliente: confira a etiqueta' : 'têm nome parecido com um cliente: confira a etiqueta'} `,
        parecidas > 0 && h('span', { class: 'tag parecido' }, 'Parece cliente'),
        h('button', { type: 'button', class: 'link', onclick: () => $('.aba[data-aba="clientes"]')?.click() }, 'Ver clientes'),
      ].filter(Boolean),
    )
}

// ---------- painel: busca, filtros e resumo ----------
function montarPainel() {
  const lista = $('#pm-lista')
  s.ui = {
    q: h('input', { type: 'search', placeholder: 'Buscar por nome, categoria ou endereço', 'aria-label': 'Buscar empresa por nome, categoria ou endereço', autocomplete: 'off', spellcheck: 'false', maxlength: '100' }),
    segmentos: h('div', { class: 'pm-segmentos', role: 'group', 'aria-label': 'Segmento' }),
    botoes: h(
      'div',
      { class: 'pm-filtros' },
      PAINEIS.map(([chave, rotulo]) => h('button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'pm-painel', 'data-painel': chave, 'data-chave': `painel:${chave}`, onclick: (e) => alternarPainel(chave, e.detail === 0) }, rotulo, h('span', { class: 'contagem', hidden: true }), icone('baixo', 14))),
    ),
    painel: h('div', { class: 'pm-painel', id: 'pm-painel', hidden: true }),
    etiquetas: h('div', { class: 'chips', 'aria-label': 'Filtros ligados' }),
    total: h('p', { class: 'pm-total', role: 'status' }),
    verTodas: h('button', { type: 'button', class: 'link', hidden: true, onclick: enquadrar }, 'Ver todas'),
    todas: h('input', { type: 'checkbox', onchange: (e) => marcarTodas(e.currentTarget.checked) }),
    ordem: h(
      'select',
      {
        'aria-label': 'Ordem da lista',
        onchange: (e) => {
          s.ordem = e.currentTarget.value
          mostrar(ordenarLugares(s.visiveis, s.ordem))
        },
      },
      h('option', { value: 'nome' }, 'Por nome'),
      h('option', { value: 'nota' }, 'Maior nota'),
    ),
  }
  const filtros = h('div', { class: 'pm-filtros-caixa' }, s.ui.botoes, s.ui.painel)
  $('#pm-topo').replaceChildren(h('label', { class: 'pm-busca' }, icone('buscar', 16), s.ui.q), s.ui.segmentos, filtros, s.ui.etiquetas)
  // o filtro aberto fecha com Esc (o foco volta ao botão dele) e com um clique fora
  filtros.addEventListener('keydown', (e) => {
    // no campo de procurar categoria, o primeiro Esc só apaga o texto
    if (e.key !== 'Escape' || !s.painel || (e.target.type === 'search' && e.target.value)) return
    const botao = s.ui.botoes.querySelector(`[data-painel="${s.painel}"]`)
    alternarPainel(s.painel, true)
    botao.focus()
  })
  document.addEventListener('pointerdown', (e) => s.painel && !filtros.contains(e.target) && alternarPainel(s.painel, true))
  s.ui.notaClientes = h('p', { class: 'pm-clientes', hidden: true })
  $('#pm-resumo').replaceChildren(h('div', { class: 'pm-linha' }, s.ui.total, s.ui.verTodas), s.ui.notaClientes, h('div', { class: 'pm-linha' }, h('label', { class: 'check' }, s.ui.todas, 'Marcar todas'), h('span', { class: 'esp' }), s.ui.ordem))

  let espera
  s.ui.q.addEventListener('input', () => {
    clearTimeout(espera)
    espera = setTimeout(() => mudarFiltro({ q: s.ui.q.value }), 200)
  })

  // clicar em qualquer ponto da linha abre a ficha; a caixa de marcar e o nome têm o próprio clique
  lista.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, label')) return
    const l = s.porId.get(e.target.closest('li[data-id]')?.dataset.id)
    if (l && s.mapa && temLugar(l)) abrirFicha(l)
  })
  // a linha sob o ponteiro (ou com o foco) ganha um anel no mapa, mesmo quando o pino está dentro de um grupo
  const apontar = (id) => {
    if (id === s.sobre) return
    s.sobre = id
    atualizarAnel()
  }
  lista.addEventListener('pointerover', (e) => apontar(e.target.closest('li[data-id]')?.dataset.id ?? null))
  lista.addEventListener('pointerleave', () => apontar(null))
  lista.addEventListener('focusin', (e) => apontar(e.target.closest('li[data-id]')?.dataset.id ?? null))
  lista.addEventListener('focusout', (e) => lista.contains(e.relatedTarget) || apontar(null))
}

// Refaz um trecho sem tirar o foco de quem está no teclado: cada controle tem data-chave.
// Se o controle sumiu (uma etiqueta tirada, por exemplo), o foco vai para o primeiro do trecho ou para a busca.
function refazer(el, filhos) {
  const chave = el.contains(document.activeElement) ? document.activeElement.dataset.chave : null
  el.replaceChildren(...filhos.filter(Boolean))
  if (chave) (el.querySelector(`[data-chave="${CSS.escape(chave)}"]`) ?? el.querySelector('button, input') ?? s.ui.q).focus()
}

function mudarFiltro(parte) {
  s.filtro = { ...s.filtro, ...parte }
  aplicar()
}

const alternarNoFiltro = (campo, valor) => mudarFiltro({ [campo]: s.filtro[campo].includes(valor) ? s.filtro[campo].filter((v) => v !== valor) : [...s.filtro[campo], valor] })

function limparFiltros() {
  s.filtro = FILTRO_VAZIO
  s.termoCategoria = ''
  s.ui.q.value = ''
  aplicar()
  s.ui.q.focus()
}

function alternarPainel(chave, peloTeclado) {
  s.painel = s.painel === chave ? null : chave
  for (const b of s.ui.botoes.children) b.setAttribute('aria-expanded', String(s.painel === b.dataset.painel))
  // entra animado só com o ponteiro: ação do teclado não anima
  desenharPainel(Boolean(s.painel) && !peloTeclado)
}

// n é quantas empresas a opção traria com os outros filtros como estão; a opção sem nenhuma fica apagada
const caixa = (chave, rotulo, marcada, n, aoMudar) => h('label', { class: `check${n === 0 ? ' sem-nada' : ''}` }, h('input', { type: 'checkbox', checked: marcada, 'data-chave': chave, onchange: aoMudar }), h('span', {}, rotulo), n != null && h('span', { class: 'n' }, numero(n)))

function desenharFiltros() {
  refazer(
    s.ui.segmentos,
    s.segmentos.map((nome, i) =>
      h('button', { type: 'button', class: 'seg-chip', 'aria-pressed': String(s.filtro.segmentos.includes(nome)), 'data-chave': `seg:${nome}`, onclick: () => alternarNoFiltro('segmentos', nome) }, h('span', { class: `ponto seg-${i % CORES}` }), nome, h('span', { class: 'n' }, numero(s.facetas.segmentos.get(nome) ?? 0))),
    ),
  )
  const ligados = { regiao: s.filtro.locais.length, categoria: s.filtro.categorias.length, mais: (s.filtro.notaMin > 0) + s.filtro.comSite + s.filtro.comCelular + s.filtro.semKanban }
  for (const b of s.ui.botoes.children) {
    const contagem = b.querySelector('.contagem')
    contagem.hidden = !ligados[b.dataset.painel]
    contagem.textContent = ligados[b.dataset.painel]
  }
  const etiquetas = etiquetasDoMapa(s.filtro)
  refazer(s.ui.etiquetas, [
    ...etiquetas.map((e) =>
      h(
        'span',
        { class: 'chip', title: e.rotulo },
        h('span', { class: 'chip-texto' }, e.rotulo),
        h(
          'button',
          {
            type: 'button',
            'aria-label': `Tirar o filtro ${e.rotulo}`,
            'data-chave': `x:${e.campo}:${e.valor}`,
            onclick: () => {
              s.filtro = semEtiqueta(s.filtro, e)
              aplicar()
            },
          },
          icone('x', 12),
        ),
      ),
    ),
    (etiquetas.length > 0 || s.filtro.segmentos.length > 0 || s.filtro.q !== '') && h('button', { type: 'button', class: 'link', 'data-chave': 'limpar', onclick: limparFiltros }, 'Limpar filtros'),
  ])
  desenharPainel()
}

function desenharPainel(animar = false) {
  const el = s.ui.painel
  el.hidden = !s.painel
  el.classList.toggle('entra', animar)
  refazer(el, s.painel ? { regiao: painelRegiao, categoria: painelCategoria, mais: painelMais }[s.painel]() : [])
}

// bairros agrupados por cidade; as cidades procuradas por inteiro e sozinhas vão juntas no fim
function painelRegiao() {
  const grupos = regioes(s.locais)
  const item = ({ valor, rotulo }) => caixa(`local:${valor}`, rotulo, s.filtro.locais.includes(valor), s.facetas.locais.get(valor) ?? 0, () => alternarNoFiltro('locais', valor))
  const bloco = (titulo, itens) => h('fieldset', { class: 'pm-grupo' }, h('legend', {}, titulo), h('div', { class: 'caixas' }, itens.map(item)))
  const comBairros = grupos.filter((g) => g.itens.length > 1)
  const sozinhas = grupos.filter((g) => g.itens.length === 1).flatMap((g) => g.itens)
  return [...comBairros.map((g) => bloco(g.cidade, g.itens)), sozinhas.length > 0 && bloco(comBairros.length ? 'Outras cidades' : 'Cidades', sozinhas)]
}

function painelCategoria() {
  const opcoes = h('div', { class: 'pm-opcoes' })
  const desenhar = () => {
    const { opcoes: lista, resto } = listarOpcoes(s.facetas.categorias, s.filtro.categorias, s.termoCategoria, 10)
    refazer(opcoes, [
      ...lista.map((o) => caixa(`cat:${o.valor}`, o.valor, o.marcada, o.n, () => alternarNoFiltro('categorias', o.valor))),
      !lista.length && h('p', { class: 'muted pequeno' }, 'Nenhuma categoria com esse nome.'),
      resto > 0 && h('p', { class: 'muted pequeno' }, `Mais ${numero(resto)} ${resto === 1 ? 'categoria' : 'categorias'}: digite para procurar.`),
    ])
  }
  desenhar()
  return [
    h('input', {
      type: 'search',
      placeholder: 'Procurar categoria',
      'aria-label': 'Procurar categoria do Google',
      value: s.termoCategoria,
      autocomplete: 'off',
      'data-chave': 'termo-categoria',
      oninput: (e) => {
        s.termoCategoria = e.currentTarget.value
        desenhar()
      },
    }),
    opcoes,
  ]
}

function painelMais() {
  return [
    h('label', {}, 'Nota mínima no Google', h('select', { 'data-chave': 'nota', onchange: (e) => mudarFiltro({ notaMin: Number(e.currentTarget.value) }) }, NOTAS.map(([valor, rotulo]) => h('option', { value: valor, selected: valor === s.filtro.notaMin }, rotulo)))),
    caixa('comSite', 'Só com site', s.filtro.comSite, null, (e) => mudarFiltro({ comSite: e.currentTarget.checked })),
    caixa('comCelular', 'Só com celular, que dá para chamar no WhatsApp', s.filtro.comCelular, null, (e) => mudarFiltro({ comCelular: e.currentTarget.checked })),
    caixa('semKanban', 'Esconder as que já estão no kanban', s.filtro.semKanban, null, (e) => mudarFiltro({ semKanban: e.currentTarget.checked })),
  ]
}

// ---------- filtros, lista e mapa andam juntos ----------
// ajustar: o mapa enquadra o resultado (mudança de filtro); sem ajustar, a área do mapa fica como está
function aplicar({ ajustar = true } = {}) {
  s.filtradas = filtrarLugares(s.lugares, s.filtro)
  s.facetas = facetas(s.lugares, s.filtro)
  desenharFiltros()
  if (s.grupo) {
    s.grupo.clearLayers()
    s.grupo.addLayers(s.filtradas.filter(temLugar).map(pinoDe))
  }
  const aberta = s.aberta && s.filtradas.find((l) => l.place_id === s.aberta)
  if (s.aberta && !aberta) s.mapa.closePopup()
  else if (aberta) s.popup.setContent(() => fichaDoLugar(aberta))
  if (ajustar) {
    // o enquadramento põe todas as filtradas na área do mapa: a lista já pode mostrá-las
    mostrar(ordenarLugares(s.filtradas, s.ordem))
    enquadrar()
  } else aoMoverMapa()
}

function enquadrar() {
  const pontos = s.filtradas.filter(temLugar).map((l) => [l.latitude, l.longitude])
  if (s.mapa && pontos.length) s.mapa.fitBounds(pontos, { padding: [40, 40], maxZoom: 16, animate: !semMovimento() })
  else aoMoverMapa()
}

// sem mapa (ainda carregando ou fora do ar) a lista mostra todas as filtradas
function aoMoverMapa() {
  const b = s.mapa?.getBounds()
  mostrar(ordenarLugares(b ? naArea(s.filtradas, { sul: b.getSouth(), norte: b.getNorth(), oeste: b.getWest(), leste: b.getEast() }) : s.filtradas, s.ordem))
}

// ---------- lista ----------
const sentinela = h('li', { class: 'lm-mais', 'aria-hidden': 'true' }, esqueleto('lm-skel'), esqueleto('lm-skel'))
const observador = new IntersectionObserver((entradas) => entradas.some((e) => e.isIntersecting) && maisLinhas())

function mostrar(lista) {
  s.visiveis = lista
  const ul = $('#pm-lista')
  // mover o mapa sem mudar quem está na área não remonta a lista (ela perderia a rolagem e o foco)
  const assinatura = `${s.ordem}:${s.mapa ? 1 : 0}:${s.filtradas.length}:${lista.map((l) => l.place_id).join()}`
  if (assinatura !== s.assinatura) {
    s.assinatura = assinatura
    s.mostradas = 0
    ul.replaceChildren()
    if (lista.length) maisLinhas()
    else ul.append(h('li', {}, semEmpresas()))
    ul.scrollTop = 0
  }
  $('#pm-resumo').hidden = !s.lugares.length
  s.ui.total.textContent = resumoDaArea(lista.length, s.filtradas.length)
  s.ui.verTodas.hidden = lista.length === s.filtradas.length
  atualizarTodas()
}

function semEmpresas() {
  if (!s.lugares.length) return estado({ titulo: 'Nenhuma empresa ainda', texto: 'Use "Nova busca pelo PC", no topo. Quando a busca terminar, as empresas que ela achou aparecem aqui.' })
  if (!s.filtradas.length) return estado({ titulo: 'Nenhuma empresa com esses filtros', texto: 'Tire um filtro ou procure por outro nome.', acao: h('button', { type: 'button', onclick: limparFiltros }, 'Limpar filtros') })
  return estado({ titulo: 'Nenhuma empresa nesta área do mapa', texto: 'Afaste o mapa ou volte para onde elas estão.', acao: h('button', { type: 'button', onclick: enquadrar }, `Ver as ${numero(s.filtradas.length)} do filtro`) })
}

function maisLinhas() {
  const lote = s.visiveis.slice(s.mostradas, s.mostradas + LOTE)
  s.mostradas += lote.length
  // observar de novo a cada lote: se a sentinela continua à vista depois dele, o próximo já entra
  observador.unobserve(sentinela)
  sentinela.remove()
  $('#pm-lista').append(...lote.map(linha))
  if (s.mostradas < s.visiveis.length) {
    $('#pm-lista').append(sentinela)
    observador.observe(sentinela)
  }
}

function linha(l) {
  const marcada = s.marcadas.has(l.place_id)
  const nome = [h('span', { class: `ponto seg-${l.seg}` }), h('span', { class: 'lm-texto' }, l.nome)]
  return h(
    'li',
    { class: `lm${marcada ? ' sel' : ''}${s.aberta === l.place_id ? ' aberta' : ''}`, 'data-id': l.place_id },
    l.enviado
      ? h('span', { class: 'lm-marcar' }, h('span', { class: 'lm-ja', role: 'img', 'aria-label': 'Já está no kanban', title: 'Já está no kanban' }, icone('ok', 16)))
      : h('label', { class: 'lm-marcar' }, h('input', { type: 'checkbox', checked: marcada, 'aria-label': `Marcar ${l.nome}`, onchange: (e) => marcar(l, e.currentTarget.checked) })),
    // sem mapa ou sem localização não há ficha para abrir: o nome fica como texto
    s.mapa && temLugar(l) ? h('button', { type: 'button', class: 'lm-nome', title: l.nome, onclick: (e) => abrirFicha(l, e.detail === 0) }, nome) : h('span', { class: 'lm-nome', title: l.nome }, nome),
    l.avaliacao != null && h('span', { class: 'lm-nota' }, avaliacao(l.avaliacao)),
    h(
      'p',
      { class: 'lm-linha2' },
      l.categoria && h('span', { class: 'lm-cat' }, l.categoria),
      l.telefone && h('span', { class: 'lm-tel' }, l.telefone),
      l.celular && h('span', { class: 'tag tel-celular' }, 'Celular'),
      l.parecido && h('span', { class: 'tag parecido', title: `Nome parecido com o cliente ativo ${l.parecido}` }, 'Parece cliente'),
      l.enviado && h('span', { class: 'ja' }, 'No kanban'),
    ),
  )
}

// ---------- marcar e mandar ao kanban ----------
function marcar(l, sim) {
  if (sim) s.marcadas.add(l.place_id)
  else s.marcadas.delete(l.place_id)
  refletirMarcacao([l])
}

function marcarTodas(sim) {
  const livres = s.visiveis.filter((l) => !l.enviado)
  for (const l of livres) {
    if (sim) s.marcadas.add(l.place_id)
    else s.marcadas.delete(l.place_id)
  }
  refletirMarcacao(livres)
}

function limparMarcadas() {
  const antes = [...s.marcadas].map((id) => s.porId.get(id))
  s.marcadas.clear()
  refletirMarcacao(antes)
  s.ui.todas.focus()
}

// linha, pino, grupos do mapa, caixa "todas", ficha aberta e barra seguem a mesma seleção
function refletirMarcacao(lugares) {
  const linhas = new Map([...$('#pm-lista').querySelectorAll('li[data-id]')].map((li) => [li.dataset.id, li]))
  for (const l of lugares) {
    const sim = s.marcadas.has(l.place_id)
    const li = linhas.get(l.place_id)
    li?.classList.toggle('sel', sim)
    const marca = li?.querySelector('input')
    if (marca) marca.checked = sim
    s.pinos.get(l.place_id)?.setIcon(iconeDoPino(l))
  }
  s.grupo?.refreshClusters()
  atualizarBotaoDaFicha()
  atualizarTodas()
  desenharBarra()
}

// Na ficha aberta troca só o botão. Remontar a ficha no meio do clique tiraria o botão clicado da página,
// e o Leaflet trataria o clique como se fosse no mapa: a ficha fecharia.
function atualizarBotaoDaFicha() {
  const botao = s.popup?.getElement()?.querySelector('.ficha-acao')
  if (!botao) return
  const marcada = s.marcadas.has(s.aberta)
  botao.textContent = marcada ? 'Desmarcar' : 'Marcar para o kanban'
  botao.classList.toggle('primario', !marcada)
}

function atualizarTodas() {
  const livres = s.visiveis.filter((l) => !l.enviado)
  const n = livres.filter((l) => s.marcadas.has(l.place_id)).length
  Object.assign(s.ui.todas, { disabled: !livres.length, checked: n > 0 && n === livres.length, indeterminate: n > 0 && n < livres.length })
}

// barra escura fixa embaixo, a mesma da Prospecção: aparece com a primeira empresa marcada
function desenharBarra() {
  const barra = $('#barra-lote-mapa')
  if (!barra.childElementCount) {
    barra.append(h('span', { class: 'contagem-lote', 'aria-live': 'polite' }), h('button', { type: 'button', class: 'link', onclick: limparMarcadas }, 'Limpar'), h('button', { type: 'button', class: 'branco', onclick: (e) => mandarMarcadas(e.currentTarget) }))
  }
  const n = s.marcadas.size
  const botao = barra.querySelector('.branco')
  barra.hidden = !n
  barra.querySelector('.contagem-lote').textContent = `${numero(n)} ${n === 1 ? 'empresa marcada' : 'empresas marcadas'}`
  delete botao.dataset.confirmar
  botao.replaceChildren(icone('enviar', 15), `Mandar ${numero(n)} para o kanban`)
}

async function mandarMarcadas(botao) {
  const lugares = [...s.marcadas].map((id) => s.porId.get(id))
  // lead criado não se apaga, só se arquiva um por um: envio grande pede um segundo clique
  if (lugares.length > SEM_CONFIRMAR && !botao.dataset.confirmar) {
    botao.dataset.confirmar = 'sim'
    botao.replaceChildren(icone('alerta', 15), `Confirmar: mandar ${numero(lugares.length)} para o kanban`)
    return
  }
  const restaurar = carregando(botao, 'Mandando…')
  try {
    const novos = await enviarLeads(lugares.map(leadDoLugar))
    const repetidas = lugares.length - novos
    toast(`${numero(novos)} ${novos === 1 ? 'lead novo' : 'leads novos'} na coluna Novo do kanban${repetidas ? `; ${numero(repetidas)} já ${repetidas === 1 ? 'estava' : 'estavam'} no CRM` : ''}`)
    for (const l of lugares) {
      l.enviado = true
      s.pinos.get(l.place_id)?.setIcon(iconeDoPino(l))
    }
    s.marcadas.clear()
  } catch (err) {
    toast(err.message, 'erro')
  }
  restaurar()
  // as linhas enviadas trocam a caixa pelo "No kanban"; com o filtro de esconder, saem da lista e do mapa
  s.assinatura = ''
  aplicar({ ajustar: false })
  desenharBarra()
  if (!s.marcadas.size) s.ui.todas.focus()
}

// ---------- mapa ----------
async function montarMapa() {
  const el = $('#mapa-geral')
  let L
  try {
    L = await carregarAgrupador()
  } catch (err) {
    console.error('mapa:', err.message)
    el.replaceChildren(h('p', { class: 'sem-mapa' }, 'Não foi possível carregar o mapa agora. A lista ao lado continua funcionando.'))
    return
  }
  const animar = !semMovimento()
  s.L = L
  s.mapa = L.map(el, { zoomAnimation: animar, fadeAnimation: animar, markerZoomAnimation: animar })
  // a página manda sem Referer (no-referrer); a política dos tiles do OpenStreetMap pede o Referer, então só o tile envia a origem
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(s.mapa)
  // o agrupamento precisa do zoom definido antes de entrar no mapa
  const pontos = s.lugares.filter(temLugar).map((l) => [l.latitude, l.longitude])
  if (pontos.length) s.mapa.fitBounds(pontos, { padding: [40, 40], animate: false })
  else s.mapa.setView([-23.55, -46.64], 11)
  s.grupo = L.markerClusterGroup({ maxClusterRadius: 46, showCoverageOnHover: false, animate: animar, iconCreateFunction: iconeDoGrupo, spiderLegPolylineOptions: { weight: 1.5, color: '#0b1238', opacity: 0.45 } }).addTo(s.mapa)
  s.grupo.on('click', (e) => abrirFicha(e.layer.options.lugar))
  s.popup = L.popup({ maxWidth: 320, minWidth: 250, autoPanPadding: [24, 24], offset: [0, -4] })
  s.anel = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<span class="anel"></span>', iconSize: [36, 36], iconAnchor: [18, 18] }), interactive: false, keyboard: false, zIndexOffset: 1000 })
  // o mapa andar para caber a ficha não muda a lista: quem clicou numa linha não perde o lugar nela
  s.mapa.on('autopanstart', () => (s.pularMovimento = true))
  s.mapa.on('moveend', () => {
    if (s.pularMovimento) s.pularMovimento = false
    else aoMoverMapa()
  })
  s.mapa.on('popupclose', aoFecharFicha)
  $('#legenda-mapa').hidden = false
  aplicar()
}

function pinoDe(l) {
  let pino = s.pinos.get(l.place_id)
  if (!pino) {
    pino = s.L.marker([l.latitude, l.longitude], { icon: iconeDoPino(l), keyboard: false, lugar: l })
    s.pinos.set(l.place_id, pino)
  }
  return pino
}

// o HTML do pino só leva classes fixas e números calculados aqui; nome e endereço nunca viram HTML
const iconeDoPino = (l) => s.L.divIcon({ className: '', html: `<span class="pe seg-${l.seg}${l.enviado ? ' ja' : s.marcadas.has(l.place_id) ? ' sel' : ''}"></span>`, iconSize: [20, 20], iconAnchor: [10, 10] })

// círculo com a contagem: verde quando todas as empresas dele já estão no kanban, senão a cor do segmento
// quando são todas do mesmo; ganha o anel quando alguma está marcada
function iconeDoGrupo(grupo) {
  const lugares = grupo.getAllChildMarkers().map((p) => p.options.lugar)
  const cor = lugares.every((l) => l.enviado) ? ' ja' : lugares.every((l) => l.seg === lugares[0].seg) ? ` seg-${lugares[0].seg}` : ''
  const lado = lugares.length < 10 ? 30 : lugares.length < 100 ? 36 : 44
  return s.L.divIcon({
    className: '',
    html: `<span class="pg${cor}${lugares.some((l) => s.marcadas.has(l.place_id)) ? ' sel' : ''}">${numero(lugares.length)}</span>`,
    iconSize: [lado, lado],
    iconAnchor: [lado / 2, lado / 2],
  })
}

// anel no lugar da empresa apontada na lista ou, sem nenhuma, da ficha aberta
function atualizarAnel(comMovimento = false) {
  if (!s.mapa) return
  const l = s.porId.get(s.sobre ?? s.aberta)
  s.anel.remove()
  if (!l || !temLugar(l)) return
  s.anel.setLatLng([l.latitude, l.longitude]).addTo(s.mapa)
  s.anel.getElement().firstElementChild.classList.toggle('chega', comMovimento)
}

// ---------- ficha da empresa (abre no mapa, no lugar dela) ----------
function abrirFicha(l, peloTeclado = false) {
  s.aberta = l.place_id
  s.devolverFoco = peloTeclado ? document.activeElement : null
  s.popup.setLatLng([l.latitude, l.longitude]).setContent(() => fichaDoLugar(l)).openOn(s.mapa)
  // o anel chega fechando sobre o lugar só no clique: ação do teclado não anima
  atualizarAnel(!peloTeclado)
  marcarLinhaAberta()
  const balao = s.popup.getElement()
  balao.querySelector('.leaflet-popup-close-button')?.setAttribute('aria-label', 'Fechar a ficha')
  if (peloTeclado) balao.querySelector('.ficha-pino a, .ficha-pino button')?.focus()
}

function aoFecharFicha() {
  s.aberta = null
  atualizarAnel()
  marcarLinhaAberta()
  if (s.devolverFoco?.isConnected) s.devolverFoco.focus()
  s.devolverFoco = null
}

function marcarLinhaAberta() {
  const ul = $('#pm-lista')
  ul.querySelector('li.aberta')?.classList.remove('aberta')
  const posicao = s.visiveis.findIndex((l) => l.place_id === s.aberta)
  if (posicao < 0) return
  // a ficha aberta pelo pino pode ser de uma linha que a lista ainda não montou
  while (s.mostradas <= posicao) maisLinhas()
  const li = ul.querySelector(`li[data-id="${CSS.escape(s.aberta)}"]`)
  li.classList.add('aberta')
  // só rola quando a lista tem rolagem própria; no celular quem rola é a página, e ela sairia do mapa
  if (ul.scrollHeight > ul.clientHeight) li.scrollIntoView({ block: 'nearest' })
}

// Montada com h() (sem HTML em texto): nome, endereço e links vêm do Google e nunca viram HTML
function fichaDoLugar(l) {
  const marcada = s.marcadas.has(l.place_id)
  const externo = { target: '_blank', rel: 'noopener noreferrer' }
  const tipo = tipoTelefone(l.telefone)
  const whatsapp = linkWhatsApp(l.telefone)
  return h(
    'div',
    { class: 'ficha-pino', onkeydown: (e) => e.key === 'Escape' && s.mapa.closePopup() },
    // o nome abre a ficha; segmento e categoria vêm logo abaixo, sem rótulo miúdo por cima do nome
    h('p', { class: 'fp-nome' }, h('strong', {}, l.nome)),
    h('p', { class: 'fp-seg' }, h('span', { class: `ponto seg-${l.seg}` }), [l.segmentos.join(', '), l.categoria].filter(Boolean).join(' · ')),
    // o nome é comparado com a lista de clientes ativos: parecido não esconde, só avisa (dado inferido)
    l.parecido && h('p', { class: 'fp-aviso' }, icone('alerta', 14), h('span', {}, 'Nome parecido com o cliente ativo ', h('strong', {}, l.parecido), '. Confira antes de mandar ao kanban.')),
    l.avaliacao != null && h('p', {}, avaliacao(l.avaliacao), h('span', { class: 'muted' }, ' no Google')),
    l.endereco && h('p', {}, l.endereco),
    // o tipo do telefone é deduzido pelo formato do número (dado inferido, avisado na etiqueta)
    l.telefone && h('p', { class: 'fp-tel' }, h('a', { href: `tel:${l.telefone.replace(/[^\d+]/g, '')}` }, l.telefone), tipo !== 'outro' && h('span', { class: `tag tel-${tipo}`, title: 'Deduzido pelo formato do número' }, tipo === 'celular' ? 'Celular' : 'Fixo')),
    h('p', { class: 'fp-links' }, whatsapp && h('a', { href: whatsapp, ...externo }, icone('conversa', 14), 'WhatsApp'), l.site && h('a', { href: l.site, ...externo }, icone('site', 14), 'Site'), l.link_maps && h('a', { href: l.link_maps, ...externo }, icone('mapa', 14), 'Google Maps')),
    h('p', { class: 'muted fp-origem' }, `Pesquisa em ${l.locais.map(rotuloLocal).join(', ')}`),
    l.enviado ? h('p', { class: 'ja' }, 'Já está no kanban') : h('button', { type: 'button', class: `ficha-acao${marcada ? '' : ' primario'}`, onclick: () => marcar(l, !s.marcadas.has(l.place_id)) }, marcada ? 'Desmarcar' : 'Marcar para o kanban'),
  )
}
