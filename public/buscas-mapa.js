// Buscas novas pelo PC entrando no mapa das empresas (aba Google Maps, com o CRM online ligado).
// O PC acha as empresas. Quando a busca termina, esta tela guarda o resultado no CRM online (lugaresDaBusca, em
// lugares.js), tira a busca do PC e o mapa relê as empresas. A faixa no painel do mapa mostra as buscas que rodam e o
// que entrou; "Buscas feitas" lista cada busca guardada (um ramo num lugar), com Ver no mapa e Excluir.
import { resumoBusca } from './campos.js'
import { buscaJaGuardada, buscasGuardadas, excluirBusca, guardarBusca } from './crm.js'
import { lugaresDaBusca, origemDaBusca } from './lugares.js'
import { mostrarBusca, recarregarMapa } from './mapa.js'
import { $, api, carregando, esqueleto, estado, fecharDialogo, h, icone, toast } from './ui.js'

const numero = (n) => n.toLocaleString('pt-BR')
const quando = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const ESPERA = 5000 // entre uma conferência e outra enquanto alguma busca roda
const rodando = (b) => b.status === 'pendente' || b.status === 'executando'

let temPc = false
let timer
let noPc = [] // buscas que ainda estão no PC: rodando, paradas com erro ou que não deu para guardar
let pcFora = false // o PC não respondeu quando havia busca rodando
let avisos = [] // o que entrou no mapa nesta visita, para a faixa mostrar
const problemas = new Map() // id da busca -> por que não deu para guardar
const guardando = new Set()

// Chamado quando a aba Google Maps abre: desenha a faixa e, com o PC ao alcance, confere as buscas dele
export function iniciarBuscas(comPc) {
  temPc = comPc
  desenharFaixa()
  if (temPc) acompanharBuscas()
}

// Confere as buscas do PC e guarda as que terminaram; repete enquanto alguma roda, em qualquer aba
export async function acompanharBuscas() {
  clearTimeout(timer)
  let itens
  try {
    itens = (await api('/api/buscas?limit=100')).itens
  } catch (err) {
    // PC desligado: o mapa continua. Só avisa (e tenta de novo mais devagar) se havia busca rodando nele
    console.error('buscas do PC:', err.message)
    pcFora = pcFora || noPc.some(rodando)
    if (pcFora) timer = setTimeout(acompanharBuscas, ESPERA * 6)
    desenharFaixa()
    return
  }
  pcFora = false
  for (const b of itens) if (b.status === 'importado') await guardar(b)
  noPc = itens.filter((b) => b.status !== 'importado' || problemas.has(b.id))
  desenharFaixa()
  if (noPc.some(rodando)) timer = setTimeout(acompanharBuscas, ESPERA)
}

// buscas que este navegador já guardou: cobre a busca que não trouxe nenhuma empresa completa, que não deixa rastro no banco
const VISTAS = 'buscas-do-pc-guardadas'
const vistas = (() => {
  try {
    return new Set(JSON.parse(localStorage.getItem(VISTAS) ?? '[]'))
  } catch {
    return new Set()
  }
})()
function marcarVista(id) {
  vistas.add(id)
  try {
    localStorage.setItem(VISTAS, JSON.stringify([...vistas].slice(-500)))
  } catch {}
}
const tentouTirar = new Set() // no PC antigo a saída falha: tenta uma vez por visita, sem encher o console

// guardada, sai do PC; o PC numa versão sem essa rota recusa, e a busca fica lá (buscaJaGuardada evita gravar de novo)
function tirarGuardada(b) {
  if (tentouTirar.has(b.id)) return
  tentouTirar.add(b.id)
  return api(`/api/buscas/${b.id}`, { method: 'DELETE' }).catch((err) => console.error('busca guardada, mas não saiu do PC:', err.message))
}

async function guardar(b) {
  if (guardando.has(b.id)) return
  guardando.add(b.id)
  try {
    const origem = origemDaBusca(b)
    if (!origem) throw new Error('a busca não diz o lugar, então não dá para pôr no mapa')
    // já guardada antes (e talvez excluída depois): não grava de novo nem anuncia
    if (vistas.has(b.id) || (await buscaJaGuardada(origem, b.updated_at))) {
      marcarVista(b.id)
      await tirarGuardada(b)
      return
    }
    const { linhas, fora } = lugaresDaBusca(b, await api(`/api/buscas/${b.id}/leads`))
    if (linhas.length) await guardarBusca(linhas)
    marcarVista(b.id)
    await tirarGuardada(b)
    problemas.delete(b.id)
    avisos = [{ ...origem, n: linhas.length, fora }, ...avisos.filter((a) => a.segmento !== origem.segmento || a.local_busca !== origem.local_busca)].slice(0, 3)
    await recarregarMapa()
  } catch (err) {
    problemas.set(b.id, err.message)
  } finally {
    guardando.delete(b.id)
  }
}

// ---------- faixa no painel do mapa ----------
let assinatura = ''

function desenharFaixa() {
  const el = $('#pm-buscas')
  el.hidden = false
  if (!el.childElementCount) el.append(h('div', { class: 'pb-itens', 'aria-live': 'polite' }), h('button', { type: 'button', class: 'pb-lista', onclick: abrirBuscasFeitas }, icone('quadro', 14), 'Buscas feitas'))
  // só refaz quando muda o que mostra: refazer a cada conferência repetiria a entrada animada e o anúncio do leitor de tela
  const nova = JSON.stringify([pcFora, noPc.map((b) => [b.id, b.status, b.erro, problemas.get(b.id)]), avisos])
  if (nova === assinatura) return
  assinatura = nova
  el.firstElementChild.replaceChildren(
    ...[pcFora && h('p', { class: 'pb-item pb-erro' }, icone('alerta', 14), h('span', {}, 'O PC não está respondendo. As buscas que rodavam nele entram no mapa quando ele voltar.')), ...noPc.map(itemDoPc), ...avisos.map(itemAviso)].filter(Boolean),
  )
}

const itemDoPc = (b) =>
  rodando(b)
    ? h('p', { class: 'pb-item' }, h('span', { class: 'prog', role: 'progressbar', 'aria-label': `Buscando ${b.nome}` }, h('span')), h('span', { class: 'pb-texto' }, h('strong', {}, b.nome), h('span', { class: 'muted' }, ` · buscando, ${resumoBusca(b)}`)))
    : h(
        'p',
        { class: 'pb-item pb-erro' },
        icone('alerta', 14),
        h('span', { class: 'pb-texto' }, h('strong', {}, b.nome), `: ${problemas.get(b.id) ?? resumoBusca(b)}`),
        h('button', { type: 'button', class: 'link', onclick: (e) => tirarDoPc(b, e.currentTarget) }, 'Tirar'),
      )

function itemAviso(a) {
  const entrou = a.n ? `${numero(a.n)} ${a.n === 1 ? 'empresa entrou' : 'empresas entraram'} no mapa` : 'nenhuma empresa com telefone e nota'
  const deFora = a.fora ? `; ${numero(a.fora)} sem telefone ou nota ${a.fora === 1 ? 'ficou' : 'ficaram'} de fora` : ''
  return h(
    'p',
    { class: 'pb-item pb-ok' },
    icone('ok', 14),
    h('span', { class: 'pb-texto' }, h('strong', {}, `${a.segmento} em ${a.local_busca}`), `: ${entrou}${deFora}.`),
    a.n > 0 && h('button', { type: 'button', class: 'link', onclick: () => mostrarBusca(a.segmento, a.local_busca) }, 'Ver no mapa'),
    h(
      'button',
      {
        type: 'button',
        class: 'pb-fechar',
        'aria-label': 'Fechar o aviso',
        onclick: () => {
          avisos = avisos.filter((x) => x !== a)
          desenharFaixa()
          $('#pm-buscas .pb-lista').focus()
        },
      },
      icone('x', 14),
    ),
  )
}

// busca que falhou (ou que não deu para guardar) sai do PC
async function tirarDoPc(b, botao) {
  const restaurar = carregando(botao, 'Tirando…')
  try {
    await api(`/api/buscas/${b.id}`, { method: 'DELETE' })
    problemas.delete(b.id)
    await acompanharBuscas()
    $('#pm-buscas .pb-lista').focus()
  } catch (err) {
    restaurar()
    toast(err.message, 'erro')
  }
}

// ---------- lista "Buscas feitas" ----------
export async function abrirBuscasFeitas() {
  $('#dlg-buscas').showModal()
  await desenharLista()
}

const linhaInteira = (conteudo) => h('tr', {}, h('td', { colspan: 4 }, conteudo))

async function desenharLista() {
  const corpo = $('#lista-buscas-feitas')
  if (!corpo.childElementCount) corpo.replaceChildren(...Array.from({ length: 4 }, () => h('tr', { 'aria-hidden': 'true' }, h('td', { colspan: 4 }, esqueleto('linha')))))
  let grupos
  try {
    grupos = await buscasGuardadas()
  } catch (err) {
    corpo.replaceChildren(linhaInteira(estado({ tipo: 'erro', titulo: 'A lista de buscas não carregou', texto: err.message, acao: h('button', { type: 'button', onclick: desenharLista }, 'Tentar de novo') })))
    return
  }
  const naFila = noPc.filter(rodando)
  if (!grupos.length && !naFila.length) {
    corpo.replaceChildren(linhaInteira(estado({ titulo: 'Nenhuma busca guardada', texto: 'Use "Nova busca pelo PC", no topo. Quando a busca terminar, as empresas entram no mapa e a busca aparece aqui.' })))
    return
  }
  corpo.replaceChildren(
    ...naFila.map((b) => h('tr', {}, h('td', {}, h('strong', {}, b.nome)), h('td', { colspan: 3, class: 'muted pequeno' }, `Rodando no PC: ${resumoBusca(b)}`))),
    ...grupos.map(linhaBusca),
  )
}

const linhaBusca = (g) =>
  h(
    'tr',
    { 'data-chave': `${g.segmento}|${g.local_busca}` },
    h('td', {}, h('strong', {}, g.segmento), h('div', { class: 'muted pequeno' }, g.local_busca)),
    h('td', { class: 'num' }, numero(g.encontrados), g.enviados > 0 && h('div', { class: 'muted pequeno' }, `${numero(g.enviados)} no kanban`)),
    h('td', { class: 'muted pequeno' }, g.ultima ? quando.format(new Date(g.ultima)) : ''),
    h(
      'td',
      { class: 'acao' },
      h(
        'button',
        {
          type: 'button',
          onclick: () => {
            fecharDialogo($('#dlg-buscas'))
            mostrarBusca(g.segmento, g.local_busca)
          },
        },
        'Ver no mapa',
      ),
      h('button', { type: 'button', class: 'excluir', 'aria-label': `Excluir a busca ${g.segmento} em ${g.local_busca}`, onclick: (e) => excluir(g, e.currentTarget), onblur: desarmar }, 'Excluir'),
    ),
  )

// excluir pede um segundo clique: as empresas da busca saem do mapa
function desarmar(e) {
  const b = e.currentTarget
  if (!b.dataset.confirmar || b.disabled) return
  delete b.dataset.confirmar
  b.textContent = 'Excluir'
  b.classList.remove('perigo')
}

async function excluir(g, botao) {
  if (!botao.dataset.confirmar) {
    botao.dataset.confirmar = 'sim'
    botao.textContent = 'Confirmar'
    botao.classList.add('perigo')
    return
  }
  const proxima = botao.closest('tr').nextElementSibling?.dataset.chave
  const restaurar = carregando(botao, 'Excluindo…')
  try {
    const n = await excluirBusca(g)
    toast(`Busca excluída: ${numero(n)} ${n === 1 ? 'empresa saiu' : 'empresas saíram'} do mapa. O que já estava no kanban continua lá.`)
    avisos = avisos.filter((a) => a.segmento !== g.segmento || a.local_busca !== g.local_busca)
    desenharFaixa()
    await desenharLista()
    // o foco segue para a próxima busca da lista, ou para o fechar quando era a última
    ;($(`#lista-buscas-feitas tr[data-chave="${CSS.escape(proxima ?? '')}"] .excluir`) ?? $('#fechar-buscas')).focus()
    recarregarMapa()
  } catch (err) {
    restaurar()
    toast(err.message, 'erro')
  }
}
