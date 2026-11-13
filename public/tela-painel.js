// Aba Painel: o relatório que a gerência acompanha (pedido do Filipe em 12/11/2026; segunda versão no mesmo dia, porque a
// primeira "ficou muito basica"). Usa a largura toda, em duas colunas: os números do período, o ritmo dos contatos ao lado dos
// tipos de contato e da temperatura por etapa, os leads em cada etapa, funil e tempo em cada etapa, atividade, onde rende,
// e o que precisa de atenção. Uma pessoa só faz a captação, então não há placar por pessoa.
// Os números vêm prontos do banco (public.painel_gerencial); os textos e as contas pequenas, de painel.js.
import { painelGerencial } from './crm.js'
import { comparar, conversoes, duracao, grade, nivel, PERIODOS, parados, periodo, rotuloBalde, semContato, taxa } from './painel.js'
import { ROTULOS as R } from './rotulos.js'
import { $, esqueleto, estado, h, icone } from './ui.js'

const numero = (n) => n.toLocaleString('pt-BR')
const plural = (n, um, varios) => `${numero(n)} ${n === 1 ? um : varios}`
const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const ORIGEM = { maps: 'Google Maps', receita: 'Prospecção por CNPJ', manual: 'Cadastro manual' }
const POR = { day: 'por dia', week: 'por semana', month: 'por mês' }
const EM_ANDAMENTO = ['novo', 'contato', 'qualificado', 'proposta', 'negociacao']
const TODAS = [...EM_ANDAMENTO, 'ganho', 'perdido']
const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const DIAS_INTEIROS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']
const LOCAIS_VISIVEIS = 8
const dias = (d) => duracao(d * 24)

let ligado = false
let abrirLead = null
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
const largo = (el) => (el?.classList.add('pn-largo'), el)

export async function carregarPainel({ abrirLead: abrir }) {
  abrirLead = abrir
  if (!ligado) ligar()
  const per = periodo(escolhido)
  for (const b of document.querySelectorAll('#painel-periodos button')) b.setAttribute('aria-pressed', String(b.dataset.periodo === per.chave))
  const corpo = $('#painel-corpo')
  // na primeira vez, esqueleto com o desenho da grade; ao trocar de período, o painel anterior fica esmaecido até o novo chegar
  if (!desenhado) corpo.replaceChildren(...['titulo pn-largo', 'bloco', 'bloco', 'bloco pn-largo', 'bloco', 'bloco'].map(esqueleto))
  corpo.setAttribute('aria-busy', 'true')
  const meu = ++pedido
  try {
    const p = await painelGerencial(per)
    if (meu !== pedido) return
    corpo.replaceChildren(
      ...[
        // a função antiga do banco não traz os cortes novos: avisa em vez de desenhar zero
        !p.pipeline && largo(estado({ titulo: 'Faltam os números novos do painel', texto: 'O CRM online ainda está com a versão anterior do painel: alguns quadros não aparecem. Fale com o administrador do sistema.' })),
        blocoManchete(p, per),
        // o ritmo dos contatos é o primeiro gráfico (pedido do Filipe): já na primeira tela, logo abaixo dos números
        blocoRitmo(p, per),
        // dois quadros curtos empilhados ao lado do ritmo, para nenhum esticar com espaço vazio
        h('div', { class: 'pn-pilha' }, blocoTipos(p, per), blocoTemperatura(p)),
        blocoEtapas(p),
        blocoFunil(p, per),
        blocoTempo(p, per),
        blocoAtividade(p, per),
        blocoOndeRende(p),
        largo(blocoAtencao(p)),
      ].filter(Boolean),
    )
    corpo.classList.toggle('chegou', !desenhado)
    desenhado = true
    $('#painel-hora').textContent = `Atualizado às ${hora.format(new Date())}`
  } catch (err) {
    if (meu !== pedido) return
    desenhado = false
    $('#painel-hora').textContent = ''
    corpo.replaceChildren(largo(estado({ tipo: 'erro', titulo: 'O painel não carregou', texto: err.message, acao: h('button', { type: 'button', onclick: () => carregarPainel({ abrirLead }) }, 'Tentar de novo') })))
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

// o gêmeo em tabela de um gráfico: os mesmos números para teclado, leitor de tela e quem prefere ler
const emTabela = (cabecalho, linhas) =>
  h(
    'details',
    { class: 'pn-tabela' },
    h('summary', {}, 'Ver os números em tabela'),
    h(
      'div',
      { class: 'tabela-wrap' },
      h(
        'table',
        { class: 'tabela' },
        h('thead', {}, h('tr', {}, cabecalho.map((t, i) => h('th', { scope: 'col', class: i ? 'num' : null }, t)))),
        h('tbody', {}, linhas.map(([rotulo, ...valores]) => h('tr', {}, h('th', { scope: 'row' }, rotulo), valores.map((v) => h('td', { class: 'num' }, typeof v === 'number' ? numero(v) : v))))),
      ),
    ),
  )

// ---------- os números do período (só os números: a frase que os repetia saiu a pedido do Filipe) ----------
function blocoManchete(p, per) {
  const pc = p.primeiro_contato
  const diasPeriodo = Math.ceil((Date.parse(p.periodo.ate) - Date.parse(p.periodo.de)) / 864e5)
  return largo(
    h(
      'section',
      { class: 'pn-manchete', 'aria-labelledby': 'pn-manchete-titulo' },
      // o título fica só para o leitor de tela; na tela, o período já está nos botões de cima
      h('h2', { id: 'pn-manchete-titulo', class: 'sr-only' }, `Números ${per.frase}`),
      p.anterior && h('p', { class: 'muted pequeno pn-comparado' }, `Setas: comparação com os ${per.anteriores}.`),
      h(
        'dl',
        { class: 'pn-numeros' },
        figura('Contatos feitos', p.atual.contatos, p.anterior?.contatos),
        p.atual.dias_com_contato != null && figura('Dias com contato', p.atual.dias_com_contato, p.anterior?.dias_com_contato, `de ${plural(diasPeriodo, 'dia', 'dias')}`),
        figura('Leads novos', p.atual.leads_novos, p.anterior?.leads_novos),
        figura('Avanços de etapa', p.atual.avancos, p.anterior?.avancos),
        figura('Ganhos', p.atual.ganhos, p.anterior?.ganhos, p.atual.perdidos ? plural(p.atual.perdidos, 'perdido', 'perdidos') : null),
        p.atual.arquivados != null && figura('Arquivados', p.atual.arquivados, null, 'saem das contas de leads'),
        figura('Até o primeiro contato', null, null, pc.com_contato ? `mediana de ${plural(pc.com_contato, 'lead', 'leads')}${pc.sem_contato ? `; ${numero(pc.sem_contato)} sem contato` : ''}` : pc.leads ? `nenhum dos ${numero(pc.leads)} teve contato` : 'nenhum lead novo', duracao(pc.mediana_horas) ?? 'sem dado'),
        figura('Empresas encontradas', p.atual.empresas_novas, p.anterior?.empresas_novas, 'novas no Google Maps'),
        figura('Parados há mais de 7 dias', parados(p.hoje.parados.faixas), null, 'em andamento, hoje'),
      ),
    ),
  )
}

// arquivar não é bom nem ruim, então o número não leva seta (anterior nulo)
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

// ---------- leads em cada etapa, hoje ----------
function blocoEtapas(p) {
  if (!p.pipeline) return null
  const hoje = Object.fromEntries(p.hoje.etapas.map((e) => [e.status, e.leads]))
  const qtd = (st) => hoje[st] ?? 0
  const andamento = EM_ANDAMENTO.reduce((s, st) => s + qtd(st), 0)
  const total = TODAS.reduce((s, st) => s + qtd(st), 0)
  const maior = Math.max(...TODAS.map(qtd), 1)
  const conv = Object.fromEntries(conversoes(p.pipeline.map((e) => ({ status: e.status, leads: e.chegaram }))).map((e, i, todas) => [e.status, { ...e, de: todas[i - 1] }]))
  const tempo = Object.fromEntries(p.tempo_etapas.map((t) => [t.status, t]))
  const entraram = p.pipeline[0].chegaram
  const linhaConversao = (st) => {
    if (st === 'novo') return `${plural(entraram, 'lead entrou', 'leads entraram')} desde o começo`
    if (st === 'perdido') return total ? `${taxa(qtd(st), total)} de todos` : null
    const c = conv[st]
    return c.de.leads ? `${taxa(c.leads, c.de.leads)} dos que chegaram a ${R.status[c.de.status]}` : `ninguém chegou a ${R.status[c.de.status]}`
  }
  return largo(
    secao(
      'pn-etapas',
      'Leads em cada etapa',
      `Hoje: ${plural(total, 'lead', 'leads')} no CRM, ${numero(andamento)} em andamento${p.hoje.arquivados ? ` e ${plural(p.hoje.arquivados, 'arquivado', 'arquivados')} fora da conta` : ''}. A conversão é de todos os leads, desde o começo: quem chegou a uma etapa e também à seguinte (quem pulou uma etapa conta nela).`,
      h(
        'ol',
        { class: 'pn-pipeline' },
        TODAS.map((st) =>
          h(
            'li',
            { class: `st-${st}` },
            h('span', { class: `pill st-${st}` }, R.status[st]),
            h('strong', { class: 'pn-valor' }, numero(qtd(st))),
            h('span', { class: 'pn-trilho', 'aria-hidden': 'true' }, comValor(h('span', {}), qtd(st) / maior)),
            EM_ANDAMENTO.includes(st) && andamento > 0 && h('span', { class: 'pequeno' }, `${taxa(qtd(st), andamento)} dos em andamento`),
            linhaConversao(st) && h('span', { class: 'muted pequeno' }, linhaConversao(st)),
            tempo[st]?.agora > 0 && h('span', { class: 'muted pequeno' }, `estão aqui há ${dias(tempo[st].mediana_agora_dias)} (mediana)`),
          ),
        ),
      ),
    ),
  )
}

// ---------- funil do período ----------
function blocoFunil(p, per) {
  const { etapas, perdidos, em_aberto } = p.funil
  const entraram = etapas[0].leads
  if (!entraram) return secao('pn-funil', 'Funil do período', null, estado({ titulo: `Nenhum lead entrou ${per.frase}`, texto: 'O funil conta os leads que entraram no período e até onde cada um chegou.' }))
  const linhas = conversoes(etapas)
  const temQualificados = p.origens.some((o) => o.qualificados != null)
  return secao(
    'pn-funil',
    'Funil do período',
    `Dos ${plural(entraram, 'lead que entrou', 'leads que entraram')} ${per.frase}, quantos chegaram pelo menos até cada etapa.`,
    h(
      'ol',
      { class: 'pn-funil' },
      linhas.map((e, i) =>
        h(
          'li',
          { class: `st-${e.status}` },
          h('span', { class: 'pn-nome' }, R.status[e.status]),
          h('span', { class: 'pn-trilho', 'aria-hidden': 'true' }, comValor(h('span', {}), e.leads / entraram)),
          h('span', { class: 'pn-fig' }, h('strong', {}, numero(e.leads)), i > 0 && h('span', { class: 'muted' }, e.taxa == null ? ' · ninguém na etapa anterior' : ` · ${taxa(e.leads, linhas[i - 1].leads)} de ${R.status[linhas[i - 1].status]}`)),
        ),
      ),
    ),
    h('p', { class: 'pn-pe' }, `Taxa de ganho: ${taxa(etapas.at(-1).leads, entraram)} dos que entraram. `, `${plural(perdidos, 'perdido', 'perdidos')}, ${numero(em_aberto)} ainda em aberto.`),
    h('h4', {}, 'Por origem'),
    h(
      'div',
      { class: 'tabela-wrap' },
      h(
        'table',
        { class: 'tabela' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Origem'), ...['Leads', 'Com contato', temQualificados && 'Qualificado ou mais', 'Ganhos', 'Perdidos'].filter(Boolean).map((t) => h('th', { scope: 'col', class: 'num' }, t)))),
        h(
          'tbody',
          {},
          p.origens.map((o) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row' }, ORIGEM[o.origem] ?? o.origem),
              h('td', { class: 'num' }, numero(o.leads)),
              h('td', { class: 'num' }, numero(o.com_contato), h('span', { class: 'pn-sub muted' }, taxa(o.com_contato, o.leads))),
              temQualificados && h('td', { class: 'num' }, numero(o.qualificados), h('span', { class: 'pn-sub muted' }, taxa(o.qualificados, o.leads))),
              h('td', { class: 'num' }, numero(o.ganhos)),
              h('td', { class: 'num' }, numero(o.perdidos)),
            ),
          ),
        ),
      ),
    ),
  )
}

// ---------- tempo em cada etapa e ciclo até o ganho ----------
function blocoTempo(p, per) {
  if (!p.tempo_etapas) return null
  const t = p.tempo_etapas
  const maior = Math.max(...t.map((e) => e.mediana_dias ?? 0), 0)
  const c = p.ciclo
  return secao(
    'pn-tempo',
    'Tempo em cada etapa',
    `Quanto tempo o lead fica em cada etapa antes de mudar (mediana das saídas ${per.frase}) e, hoje, há quanto tempo estão os que seguem nela. Vem do histórico de mudança de etapa.`,
    h(
      'ul',
      { class: 'pn-medidores pn-tempos' },
      t.map((e) =>
        h(
          'li',
          {},
          h('span', { class: 'pn-nome' }, R.status[e.status]),
          h('span', { class: 'pn-trilho', 'aria-hidden': 'true' }, comValor(h('span', {}), maior && e.mediana_dias ? e.mediana_dias / maior : 0)),
          h(
            'span',
            { class: 'pn-fig' },
            e.saidas ? h('strong', {}, dias(e.mediana_dias)) : h('span', { class: 'muted' }, 'ninguém saiu'),
            e.saidas > 0 && h('span', { class: 'muted' }, ` · ${plural(e.saidas, 'saída', 'saídas')}`),
            h('span', { class: 'pn-sub muted' }, e.agora ? `hoje ${numero(e.agora)}, há ${dias(e.mediana_agora_dias)}` : 'hoje ninguém'),
          ),
        ),
      ),
    ),
    h('h4', {}, 'Ciclo até o ganho'),
    h(
      'p',
      { class: 'pn-pe' },
      c.ganhos
        ? [
            `${plural(c.ganhos, 'lead ganho', 'leads ganhos')} ${per.frase}: `,
            h('strong', {}, dias(c.mediana_dias)),
            ' desde que entrou e ',
            h('strong', {}, plural(c.mediana_contatos, 'contato', 'contatos')),
            ' até o ganho (medianas).',
          ]
        : `Nenhum lead ganho ${per.frase}: ainda não há ciclo para medir.`,
    ),
  )
}

// ---------- atividade ----------
function blocoAtividade(p, per) {
  const { serie } = p
  const unidade = p.periodo.unidade
  return largo(
    secao(
      'pn-atividade',
      'Atividade',
      'Contato é o atendimento registrado na ficha do lead; mudar a etapa no kanban não conta. Dias no horário de Brasília.',
      h('div', { class: 'pn-graficos' }, colunas('Contatos', serie, 'contatos', unidade, per), colunas('Leads novos', serie, 'leads', unidade, per), colunas('Ganhos', serie, 'ganhos', unidade, per)),
      emTabela(
        [{ day: 'Dia', week: 'Semana', month: 'Mês' }[unidade], 'Contatos', 'Leads novos', 'Ganhos'],
        serie.map((b) => [rotuloBalde(b.inicio, unidade), b.contatos, b.leads, b.ganhos]),
      ),
    ),
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

// ---------- ritmo: dia da semana e hora ----------
function blocoRitmo(p, per) {
  if (!p.ritmo) return null
  const g = grade(p.ritmo)
  const porDia = g.map((d) => d.reduce((s, v) => s + v, 0))
  const porHora = g[0].map((_, hr) => g.reduce((s, d) => s + d[hr], 0))
  const total = porDia.reduce((s, v) => s + v, 0)
  if (!total) return secao('pn-ritmo', 'Ritmo dos contatos', null, estado({ titulo: `Nenhum contato ${per.frase}`, texto: 'Aqui aparecem os dias da semana e as horas em que os contatos são feitos.' }))
  const max = Math.max(...g.flat())
  const diaForte = porDia.indexOf(Math.max(...porDia))
  const horaForte = porHora.indexOf(Math.max(...porHora))
  const ativos = p.atual.dias_com_contato
  const resumo = `${numero(total)} ${per.frase}`
  const leitura = h('span', { class: 'pn-leitura', 'aria-hidden': 'true' }, resumo)
  return secao(
    'pn-ritmo',
    'Ritmo dos contatos',
    `Em que dia da semana e em que hora os contatos foram feitos ${per.frase} (a hora informada na ficha, no horário de Brasília).`,
    h(
      'p',
      { class: 'pn-pe pn-ritmo-resumo' },
      ativos != null && [h('strong', {}, plural(ativos, 'dia', 'dias')), ' com contato, média de ', h('strong', {}, numero(Math.round((total / Math.max(ativos, 1)) * 10) / 10)), ' por dia trabalhado. '],
      `Mais forte: ${DIAS_INTEIROS[diaForte]} (${numero(porDia[diaForte])}) e às ${horaForte}h (${numero(porHora[horaForte])}).`,
    ),
    h(
      'figure',
      { class: 'pn-calor-fig' },
      h('figcaption', {}, leitura),
      h(
        'div',
        { class: 'pn-calor', 'aria-hidden': 'true', onpointerleave: () => leitura.replaceChildren(resumo) },
        h('span', {}),
        ...Array.from({ length: 24 }, (_, hr) => h('span', { class: 'pn-calor-hora' }, hr % 3 ? '' : `${hr}h`)),
        h('span', {}),
        ...g.flatMap((linha, d) => [
          h('span', { class: 'pn-calor-dia' }, DIAS[d]),
          ...linha.map((v, hr) =>
            h('span', {
              class: `pn-celula n${nivel(v, max)}`,
              onpointerenter: () => leitura.replaceChildren(h('strong', {}, plural(v, 'contato', 'contatos')), ` ${DIAS_INTEIROS[d]}, das ${hr}h às ${hr + 1}h`),
            }),
          ),
          h('span', { class: 'pn-calor-total' }, numero(porDia[d])),
        ]),
      ),
      legendaCalor('menos', 'mais contatos'),
    ),
    emTabela(['Dia', ...Array.from({ length: 24 }, (_, hr) => `${hr}h`), 'Total'], g.map((linha, d) => [DIAS_INTEIROS[d], ...linha, porDia[d]])),
  )
}

const legendaCalor = (de, ate) =>
  h('p', { class: 'pn-legenda muted pequeno' }, de, ...[1, 2, 3, 4, 5].map((n) => h('span', { class: `pn-celula n${n}`, 'aria-hidden': 'true' })), ate)

// ---------- tipos de contato ----------
function blocoTipos(p, per) {
  const total = p.tipos.reduce((s, t) => s + t.total, 0)
  return secao(
    'pn-tipos',
    'Como foram os contatos',
    null,
    total
      ? medidores(p.tipos.map((t) => ({ nome: R.tipo[t.tipo] ?? t.tipo, valor: t.total, de: total, texto: `${numero(t.total)} · ${taxa(t.total, total)}` })))
      : estado({ titulo: `Nenhum contato ${per.frase}`, texto: 'Os contatos registrados na ficha aparecem aqui por tipo: ligação, WhatsApp, e-mail, reunião, visita.' }),
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

// ---------- onde rende: do Google Maps ao ganho, e segmento por local ----------
function blocoOndeRende(p) {
  const { empresas, clientes_ativos } = p.hoje
  const nota = `Empresas do Google Maps guardadas no CRM online, desde o começo (busca excluída não conta).${clientes_ativos ? ` ${plural(clientes_ativos, 'cliente ativo fica', 'clientes ativos ficam')} fora das pesquisas.` : ''}`
  if (!empresas) return largo(secao('pn-rende', 'Onde rende', nota, estado({ titulo: 'Nenhuma empresa do Google Maps no CRM online', texto: 'Quando houver buscas guardadas, aqui aparecem os segmentos e os locais que mais viram lead.' })))
  const g = p.garimpo
  const passos = g && [
    ['Encontradas', g.empresas],
    ['Viraram lead', g.viraram_lead],
    ['Tiveram contato', g.com_contato],
    ['Qualificado ou mais', g.qualificados],
    ['Ganhas', g.ganhos],
  ]
  return largo(
    secao(
      'pn-rende',
      'Onde rende',
      nota,
      passos &&
        h(
          'ol',
          { class: 'pn-funil pn-garimpo' },
          passos.map(([nome, n], i) =>
            h(
              'li',
              { class: i === passos.length - 1 ? 'st-ganho' : null },
              h('span', { class: 'pn-nome' }, nome),
              h('span', { class: 'pn-trilho', 'aria-hidden': 'true' }, comValor(h('span', {}), g.empresas ? Math.max(n / g.empresas, n ? 0.004 : 0) : 0)),
              h('span', { class: 'pn-fig' }, h('strong', {}, numero(n)), i > 0 && h('span', { class: 'muted' }, ` · ${taxa(n, passos[i - 1][1]) ?? '–'} de ${passos[i - 1][0].toLowerCase()}`)),
            ),
          ),
        ),
      p.territorio ? territorio(p) : null,
    ),
  )
}

// matriz segmento por local da busca: "leads de empresas" em cada célula; a cor é a parte que virou lead
function territorio(p) {
  const locais = p.regioes.slice(0, LOCAIS_VISIVEIS).map((r) => r.local_busca)
  const outros = p.regioes.length > LOCAIS_VISIVEIS
  const cel = new Map()
  for (const t of p.territorio) {
    const local = locais.includes(t.local_busca) ? t.local_busca : 'Outros'
    const k = `${t.segmento}|${local}`
    const atual = cel.get(k) ?? { empresas: 0, leads: 0 }
    cel.set(k, { empresas: atual.empresas + t.empresas, leads: atual.leads + t.leads })
  }
  const colunas = outros ? [...locais, 'Outros'] : locais
  // a referência da cor vem das células com 10 empresas ou mais: uma célula de 1 empresa que virou lead (100%) apagaria o resto
  const taxas = [...cel.values()].filter((c) => c.empresas >= 10).map((c) => c.leads / c.empresas)
  const maior = Math.max(...(taxas.length ? taxas : [...cel.values()].map((c) => (c.empresas ? c.leads / c.empresas : 0))), 0)
  const celula = (c) =>
    c?.empresas
      ? h('td', { class: `num pn-celula n${nivel(c.leads / c.empresas, maior)}` }, `${numero(c.leads)} de ${numero(c.empresas)}`)
      : h('td', { class: 'num muted' }, '–')
  return h(
    'div',
    { class: 'pn-bloco' },
    h('h4', {}, 'Segmento por local da busca'),
    h('p', { class: 'muted pequeno' }, `Em cada célula, quantas empresas viraram lead de quantas foram encontradas. A cor mais escura é a maior parte que virou lead${maior ? ` (${taxa(maior, 1)}, entre as células com 10 empresas ou mais)` : ''}.${outros ? ` Os ${numero(p.regioes.length - LOCAIS_VISIVEIS)} locais com menos leads ficam em Outros.` : ''}`),
    h(
      'div',
      { class: 'tabela-wrap' },
      h(
        'table',
        { class: 'tabela pn-matriz' },
        h('caption', { class: 'sr-only' }, 'Empresas que viraram lead, por segmento e local da busca'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Segmento'), colunas.map((l) => h('th', { scope: 'col', class: 'num' }, l)), h('th', { scope: 'col', class: 'num' }, 'Total'))),
        h(
          'tbody',
          {},
          p.segmentos.map((s) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row' }, s.segmento),
              colunas.map((l) => celula(cel.get(`${s.segmento}|${l}`))),
              h('td', { class: 'num pn-total' }, `${numero(s.leads)} de ${numero(s.empresas)}`, s.ganhos ? h('span', { class: 'pn-sub' }, plural(s.ganhos, 'ganho', 'ganhos')) : null),
            ),
          ),
        ),
      ),
    ),
    legendaCalor('menor parte', 'maior parte virou lead'),
  )
}

// ---------- precisa de atenção ----------
function blocoAtencao(p) {
  const { faixas, lista } = p.hoje.parados
  const andamento = EM_ANDAMENTO.reduce((s, st) => s + (p.hoje.etapas.find((e) => e.status === st)?.leads ?? 0), 0)
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
                  // quem abre o Painel sem Kanban nem Leads não abre a ficha (o banco não entrega o lead): o nome fica só texto
                  h('td', {}, abrirLead ? h('button', { type: 'button', class: 'link', onclick: () => abrirLead(l.id) }, l.nome) : l.nome),
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
  )
}

// ---------- temperatura por etapa ----------
function blocoTemperatura(p) {
  if (!p.temperaturas) return null
  const linhas = [['quente', 'Quente'], ['morno', 'Morno'], ['frio', 'Frio'], [null, 'Sem temperatura']]
  const v = (t, st) => p.temperaturas.find((x) => x.temperatura === t && x.status === st)?.leads ?? 0
  const max = Math.max(...p.temperaturas.map((x) => x.leads), 0)
  const totalEtapa = (st) => linhas.reduce((s, [t]) => s + v(t, st), 0)
  return secao(
    'pn-temperatura',
    'Temperatura por etapa',
    'Leads no CRM hoje, fora os arquivados. A temperatura é a que está marcada na ficha agora.',
    max
      ? h(
          'div',
          { class: 'tabela-wrap' },
          h(
            'table',
            { class: 'tabela pn-matriz' },
            h('caption', { class: 'sr-only' }, 'Leads por temperatura e etapa'),
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Etapa'), linhas.map(([t, nome]) => h('th', { scope: 'col', class: 'num' }, t ? h('span', { class: `tag t-${t}` }, nome) : nome)), h('th', { scope: 'col', class: 'num' }, 'Total'))),
            h(
              'tbody',
              {},
              TODAS.map((st) =>
                h(
                  'tr',
                  {},
                  h('th', { scope: 'row' }, h('span', { class: `pill st-${st}` }, R.status[st])),
                  linhas.map(([t]) => (v(t, st) ? h('td', { class: `num pn-celula n${nivel(v(t, st), max)}` }, numero(v(t, st))) : h('td', { class: 'num muted' }, '–'))),
                  h('td', { class: 'num pn-total' }, numero(totalEtapa(st))),
                ),
              ),
            ),
          ),
        )
      : estado({ titulo: 'Nenhum lead no CRM', texto: 'Quando houver leads, aqui aparece quantos estão quentes, mornos e frios em cada etapa.' }),
  )
}
