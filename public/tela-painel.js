// Aba Painel: o relatório que a gerência acompanha, na ordem em que se lê (pedido do Filipe em 12/11/2026):
// a frase do período, a atividade, o funil, onde rende e o que precisa de atenção. Uma pessoa só faz a captação,
// então não há placar por pessoa. Os números vêm prontos do banco (public.painel_gerencial); os textos, de painel.js.
import { painelGerencial } from './crm.js'
import { comparar, conversoes, duracao, manchete, PERIODOS, parados, periodo, rotuloBalde, semContato, taxa } from './painel.js'
import { ROTULOS as R } from './rotulos.js'
import { $, esqueleto, estado, h, icone } from './ui.js'

const numero = (n) => n.toLocaleString('pt-BR')
const plural = (n, um, varios) => `${numero(n)} ${n === 1 ? um : varios}`
const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const ORIGEM = { maps: 'Google Maps', receita: 'Prospecção por CNPJ', manual: 'Cadastro manual' }
const POR = { day: 'por dia', week: 'por semana', month: 'por mês' }
const EM_ANDAMENTO = ['novo', 'contato', 'qualificado', 'proposta', 'negociacao']
const REGIOES_VISIVEIS = 8

let ligado = false
let abrirLead = () => {}
let escolhido = guardado()
let pedido = 0
let desenhado = false

function guardado() {
  try {
    return localStorage.getItem('painel-periodo') ?? '7'
  } catch {
    return '7'
  }
}

// CSP sem 'unsafe-inline': tamanho de barra vai por variável CSS pelo CSSOM, nunca por atributo style
const comValor = (el, v) => (el.style.setProperty('--v', String(v)), el)

export async function carregarPainel({ abrirLead: abrir }) {
  abrirLead = abrir
  if (!ligado) ligar()
  const per = periodo(escolhido)
  for (const b of document.querySelectorAll('#painel-periodos button')) b.setAttribute('aria-pressed', String(b.dataset.periodo === per.chave))
  const corpo = $('#painel-corpo')
  // na primeira vez, esqueleto; ao trocar de período, o painel anterior fica esmaecido até o novo chegar
  if (!desenhado) corpo.replaceChildren(esqueleto('titulo'), esqueleto('linha'), esqueleto('bloco'), esqueleto('bloco'), esqueleto('bloco'))
  corpo.setAttribute('aria-busy', 'true')
  const meu = ++pedido
  try {
    const p = await painelGerencial(per)
    if (meu !== pedido) return
    corpo.replaceChildren(blocoManchete(p, per), blocoAtividade(p, per), blocoFunil(p, per), blocoOndeRende(p), blocoAtencao(p))
    corpo.classList.toggle('chegou', !desenhado)
    desenhado = true
    $('#painel-hora').textContent = `Atualizado às ${hora.format(new Date())}`
  } catch (err) {
    if (meu !== pedido) return
    desenhado = false
    $('#painel-hora').textContent = ''
    corpo.replaceChildren(estado({ tipo: 'erro', titulo: 'O painel não carregou', texto: err.message, acao: h('button', { type: 'button', onclick: () => carregarPainel({ abrirLead }) }, 'Tentar de novo') }))
  } finally {
    if (meu === pedido) corpo.removeAttribute('aria-busy')
  }
}

function ligar() {
  ligado = true
  $('#painel-periodos').append(
    ...Object.entries(PERIODOS).map(([chave, p]) =>
      h('button', { type: 'button', 'data-periodo': chave, 'aria-pressed': 'false', onclick: () => escolher(chave) }, p.rotulo),
    ),
  )
  // gráfico de colunas: uma parada de Tab só; as setas andam de coluna em coluna
  $('#painel-corpo').addEventListener('keydown', (e) => {
    const atual = e.target.closest?.('.pn-barras > li')
    if (!atual) return
    const todas = [...atual.parentElement.children]
    const i = todas.indexOf(atual)
    const j = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: todas.length - 1 }[e.key]
    if (j == null || !todas[j]) return
    e.preventDefault()
    for (const li of todas) li.tabIndex = -1
    todas[j].tabIndex = 0
    todas[j].focus()
  })
}

function escolher(chave) {
  escolhido = chave
  try {
    localStorage.setItem('painel-periodo', chave)
  } catch {
    // navegação privada sem armazenamento: o período vale só até recarregar
  }
  carregarPainel({ abrirLead })
}

const secao = (id, titulo, nota, ...conteudo) =>
  h('section', { class: 'pn-secao', 'aria-labelledby': `${id}-titulo` }, h('h3', { id: `${id}-titulo`, tabindex: '-1' }, titulo), nota && h('p', { class: 'muted pequeno pn-nota' }, nota), ...conteudo)

// ---------- a frase do período e os números dela ----------
function blocoManchete(p, per) {
  const { titulo, linhas } = manchete(p, per)
  const n = parados(p.hoje.parados.faixas)
  const pc = p.primeiro_contato
  return h(
    'section',
    { class: 'pn-manchete', 'aria-labelledby': 'pn-manchete-titulo' },
    h('h2', { id: 'pn-manchete-titulo' }, titulo),
    h('p', { class: 'pn-linhas' }, linhas.join(' '), n > 0 && ' ', n > 0 && h('button', { type: 'button', class: 'link', onclick: () => $('#pn-atencao-titulo')?.focus() }, 'Ver os parados')),
    p.anterior && h('p', { class: 'muted pequeno pn-comparado' }, `Setas: comparação com os ${per.anteriores}.`),
    h(
      'dl',
      { class: 'pn-numeros' },
      figura('Contatos feitos', p.atual.contatos, p.anterior?.contatos),
      figura('Leads novos', p.atual.leads_novos, p.anterior?.leads_novos),
      figura('Avanços de etapa', p.atual.avancos, p.anterior?.avancos),
      figura('Ganhos', p.atual.ganhos, p.anterior?.ganhos, p.atual.perdidos ? plural(p.atual.perdidos, 'perdido', 'perdidos') : null),
      figura('Até o primeiro contato', null, null, pc.com_contato ? `mediana de ${plural(pc.com_contato, 'lead', 'leads')}${pc.sem_contato ? `; ${numero(pc.sem_contato)} sem contato` : ''}` : pc.leads ? `nenhum dos ${numero(pc.leads)} teve contato` : 'nenhum lead novo', duracao(pc.mediana_horas) ?? 'sem dado'),
      figura('Empresas encontradas', p.atual.empresas_novas, p.anterior?.empresas_novas, 'novas no Google Maps'),
    ),
  )
}

function figura(rotulo, valor, anterior, nota, texto) {
  const c = valor != null && comparar(valor, anterior)
  return h(
    'div',
    { class: 'pn-num' },
    h('dt', {}, rotulo),
    h('dd', { class: 'pn-valor' }, texto ?? numero(valor)),
    c && h('dd', { class: `pn-delta pn-${c.sentido}` }, c.sentido !== 'igual' && icone('seta', 14), c.texto),
    nota && h('dd', { class: 'muted pequeno' }, nota),
  )
}

// ---------- atividade ----------
function blocoAtividade(p, per) {
  const { serie, tipos } = p
  const unidade = p.periodo.unidade
  const totalTipos = tipos.reduce((s, t) => s + t.total, 0)
  return secao(
    'pn-atividade',
    'Atividade',
    `Contato é o atendimento registrado na ficha do lead; mudar a etapa no kanban não conta. Dias no horário de Brasília.`,
    h('div', { class: 'pn-graficos' }, colunas('Contatos', serie, 'contatos', unidade, per), colunas('Leads novos', serie, 'leads', unidade, per)),
    totalTipos > 0 &&
      h(
        'div',
        { class: 'pn-bloco' },
        h('h4', {}, 'Como foram os contatos'),
        medidores(tipos.map((t) => ({ nome: R.tipo[t.tipo] ?? t.tipo, valor: t.total, de: totalTipos, texto: `${numero(t.total)} · ${taxa(t.total, totalTipos)}` }))),
      ),
    tabelaSerie(serie, unidade),
  )
}

function colunas(titulo, serie, campo, unidade, per) {
  const valores = serie.map((b) => b[campo])
  const max = Math.max(...valores, 0)
  const total = valores.reduce((s, v) => s + v, 0)
  const pico = valores.indexOf(max)
  const resumo = total ? `${numero(total)} ${per.frase}${max > 0 && serie.length > 1 ? ` · mais alto: ${numero(max)} em ${rotuloBalde(serie[pico].inicio, unidade)}` : ''}` : `nenhum ${per.frase}`
  const leitura = h('span', { class: 'pn-leitura', 'aria-hidden': 'true' }, resumo)
  const mostrar = (i) => leitura.replaceChildren(h('strong', {}, numero(valores[i])), ` em ${rotuloBalde(serie[i].inicio, unidade)}`)
  return h(
    'figure',
    { class: 'pn-colunas' },
    h('figcaption', {}, h('strong', {}, `${titulo} ${POR[unidade]}`), leitura),
    h(
      'ol',
      {
        class: 'pn-barras',
        'aria-label': `${titulo} ${POR[unidade]}. Setas para andar entre as colunas.`,
        onpointerleave: () => leitura.replaceChildren(resumo),
        onfocusout: (e) => !e.currentTarget.contains(e.relatedTarget) && leitura.replaceChildren(resumo),
      },
      serie.map((b, i) =>
        h(
          'li',
          {
            tabindex: i === serie.length - 1 ? '0' : '-1',
            'aria-label': `${rotuloBalde(b.inicio, unidade)}: ${numero(b[campo])}`,
            onpointerenter: () => mostrar(i),
            onfocus: () => mostrar(i),
          },
          comValor(h('span', { class: 'pn-barra' }), b[campo] ? Math.max(b[campo] / max, 0.03) : 0),
        ),
      ),
    ),
    h('div', { class: 'pn-eixo', 'aria-hidden': 'true' }, h('span', {}, rotuloBalde(serie[0].inicio, unidade)), serie.length > 1 && h('span', {}, rotuloBalde(serie.at(-1).inicio, unidade))),
  )
}

// o gêmeo em tabela dos gráficos: os mesmos números para teclado, leitor de tela e quem prefere ler
function tabelaSerie(serie, unidade) {
  return h(
    'details',
    { class: 'pn-tabela' },
    h('summary', {}, 'Ver os números em tabela'),
    h(
      'div',
      { class: 'tabela-wrap' },
      h(
        'table',
        { class: 'tabela' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, { day: 'Dia', week: 'Semana', month: 'Mês' }[unidade]), h('th', { scope: 'col', class: 'num' }, 'Contatos'), h('th', { scope: 'col', class: 'num' }, 'Leads novos'), h('th', { scope: 'col', class: 'num' }, 'Ganhos'))),
        h('tbody', {}, serie.map((b) => h('tr', {}, h('td', {}, rotuloBalde(b.inicio, unidade)), h('td', { class: 'num' }, numero(b.contatos)), h('td', { class: 'num' }, numero(b.leads)), h('td', { class: 'num' }, numero(b.ganhos))))),
      ),
    ),
  )
}

// lista de medidores: nome, barra da parte sobre o todo e o número ao lado
const medidores = (linhas) =>
  h(
    'ul',
    { class: 'pn-medidores' },
    linhas.map((l) =>
      h('li', {}, h('span', { class: 'pn-nome' }, l.nome), h('span', { class: 'pn-trilho', 'aria-hidden': 'true' }, comValor(h('span', {}), l.de ? l.valor / l.de : 0)), h('span', { class: 'pn-fig' }, l.texto)),
    ),
  )

// ---------- funil ----------
function blocoFunil(p, per) {
  const { etapas, perdidos, em_aberto } = p.funil
  const entraram = etapas[0].leads
  if (!entraram) return secao('pn-funil', 'Funil', null, estado({ titulo: `Nenhum lead entrou ${per.frase}`, texto: 'O funil conta os leads que entraram no período e até onde cada um chegou.' }))
  const linhas = conversoes(etapas)
  return secao(
    'pn-funil',
    'Funil',
    `Dos ${plural(entraram, 'lead que entrou', 'leads que entraram')} ${per.frase}, quantos chegaram pelo menos até cada etapa. Quem pulou uma etapa conta nela também.`,
    h(
      'ol',
      { class: 'pn-funil' },
      linhas.map((e, i) =>
        h(
          'li',
          { class: `st-${e.status}` },
          h('span', { class: 'pn-nome' }, R.status[e.status]),
          h('span', { class: 'pn-trilho', 'aria-hidden': 'true' }, comValor(h('span', {}), e.leads / entraram)),
          h('span', { class: 'pn-fig' }, h('strong', {}, numero(e.leads)), i > 0 && h('span', { class: 'muted' }, e.taxa == null ? ' · sem leads na etapa anterior' : ` · ${taxa(e.leads, linhas[i - 1].leads)} de ${R.status[linhas[i - 1].status]}`)),
        ),
      ),
    ),
    h('p', { class: 'pn-pe' }, `Ganho: ${taxa(etapas.at(-1).leads, entraram)} dos que entraram. `, `${plural(perdidos, 'perdido', 'perdidos')}, ${plural(em_aberto, 'ainda em aberto', 'ainda em aberto')}.`),
    h('h4', {}, 'De onde vieram'),
    h(
      'div',
      { class: 'tabela-wrap' },
      h(
        'table',
        { class: 'tabela' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Origem'), ...['Leads', 'Com contato', 'Ganhos', 'Perdidos'].map((t) => h('th', { scope: 'col', class: 'num' }, t)))),
        h(
          'tbody',
          {},
          p.origens.map((o) =>
            h('tr', {}, h('td', {}, ORIGEM[o.origem] ?? o.origem), h('td', { class: 'num' }, numero(o.leads)), h('td', { class: 'num' }, `${numero(o.com_contato)} (${taxa(o.com_contato, o.leads)})`), h('td', { class: 'num' }, numero(o.ganhos)), h('td', { class: 'num' }, numero(o.perdidos))),
          ),
        ),
      ),
    ),
  )
}

// ---------- onde rende ----------
function blocoOndeRende(p) {
  const { empresas, empresas_lead, clientes_ativos } = p.hoje
  const nota = `Empresas do Google Maps guardadas no CRM online, desde o começo, e quantas viraram lead.${clientes_ativos ? ` ${plural(clientes_ativos, 'cliente ativo fica', 'clientes ativos ficam')} fora das pesquisas.` : ''}`
  if (!empresas) return secao('pn-rende', 'Onde rende', nota, estado({ titulo: 'Nenhuma empresa do Google Maps no CRM online', texto: 'Quando houver buscas guardadas, aqui aparecem os segmentos e os locais que mais viram lead.' }))
  const linha = (nome, l) => ({ nome, valor: l.leads, de: l.empresas, texto: `${numero(l.leads)} de ${numero(l.empresas)}${l.ganhos ? ` · ${plural(l.ganhos, 'ganho', 'ganhos')}` : ''}` })
  const regioes = h('div', { class: 'pn-bloco' }, h('h4', {}, 'Locais da busca'), medidores(p.regioes.slice(0, REGIOES_VISIVEIS).map((r) => linha(r.local_busca, r))))
  if (p.regioes.length > REGIOES_VISIVEIS) {
    regioes.append(
      h('button', { type: 'button', class: 'link', onclick: (e) => e.currentTarget.replaceWith(medidores(p.regioes.slice(REGIOES_VISIVEIS).map((r) => linha(r.local_busca, r)))) }, `Mostrar os outros ${numero(p.regioes.length - REGIOES_VISIVEIS)}`),
    )
  }
  return secao(
    'pn-rende',
    'Onde rende',
    nota,
    h('p', { class: 'pn-garimpo' }, h('strong', {}, numero(empresas)), ` ${empresas === 1 ? 'empresa encontrada' : 'empresas encontradas'}; `, h('strong', {}, numero(empresas_lead)), ` ${empresas_lead === 1 ? 'virou lead' : 'viraram lead'} (${taxa(empresas_lead, empresas)}).`),
    h('div', { class: 'pn-duas' }, h('div', { class: 'pn-bloco' }, h('h4', {}, 'Segmentos'), medidores(p.segmentos.map((s) => linha(s.segmento, s)))), regioes),
  )
}

// ---------- precisa de atenção ----------
function blocoAtencao(p) {
  const { faixas, lista } = p.hoje.parados
  const etapas = Object.fromEntries(p.hoje.etapas.map((e) => [e.status, e.leads]))
  const andamento = EM_ANDAMENTO.reduce((s, st) => s + (etapas[st] ?? 0), 0)
  const temp = Object.fromEntries(p.hoje.temperatura.map((t) => [t.temperatura ?? 'sem', t.leads]))
  return secao(
    'pn-atencao',
    'Precisa de atenção',
    'Hoje, sem depender do período: leads em andamento (fora Ganho e Perdido) contados desde o último contato, ou desde que entraram.',
    h(
      'dl',
      { class: 'pn-faixas' },
      [['Até 7 dias', faixas.ate_7], ['8 a 14 dias', faixas.de_8_a_14], ['15 a 30 dias', faixas.de_15_a_30], ['Mais de 30 dias', faixas.mais_de_30]].map(([r, v]) => h('div', {}, h('dt', {}, r), h('dd', {}, numero(v)))),
    ),
    lista.length
      ? h(
          'div',
          { class: 'tabela-wrap' },
          h(
            'table',
            { class: 'tabela' },
            h('caption', { class: 'sr-only' }, 'Leads parados há mais tempo'),
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Lead'), h('th', { scope: 'col' }, 'Etapa'), h('th', { scope: 'col' }, 'Temperatura'), h('th', { scope: 'col' }, 'Sem contato'))),
            h(
              'tbody',
              {},
              lista.map((l) =>
                h(
                  'tr',
                  {},
                  h('td', {}, h('button', { type: 'button', class: 'link', onclick: () => abrirLead(l.id) }, l.nome)),
                  h('td', {}, h('span', { class: `pill st-${l.status}` }, R.status[l.status])),
                  h('td', {}, l.temperatura ? h('span', { class: `tag t-${l.temperatura}` }, R.temperatura[l.temperatura]) : h('span', { class: 'muted' }, 'sem')),
                  h('td', {}, semContato(l)),
                ),
              ),
            ),
          ),
        )
      : estado({ titulo: 'Nenhum lead parado', texto: andamento ? 'Todo lead em andamento teve contato nos últimos 7 dias.' : 'Não há lead em andamento agora.' }),
    lista.length < parados(faixas) && h('p', { class: 'muted pequeno' }, `Mostrando os ${numero(lista.length)} parados há mais tempo, de ${numero(parados(faixas))}.`),
    h('h4', {}, `Em andamento hoje: ${plural(andamento, 'lead', 'leads')}`),
    h(
      'ul',
      { class: 'pn-etapas', 'aria-label': 'Leads por etapa hoje' },
      [...EM_ANDAMENTO, 'ganho', 'perdido'].map((st) => h('li', {}, h('span', { class: `pill st-${st}` }, R.status[st]), h('strong', {}, numero(etapas[st] ?? 0)))),
    ),
    andamento > 0 &&
      h(
        'p',
        { class: 'pn-temperaturas' },
        'Temperatura dos em andamento: ',
        ...['quente', 'morno', 'frio'].filter((t) => temp[t]).flatMap((t) => [h('span', { class: `tag t-${t}` }, R.temperatura[t]), ` ${numero(temp[t])}  `]),
        temp.sem ? `sem temperatura ${numero(temp.sem)}` : '',
      ),
  )
}
