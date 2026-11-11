import { config, supabase } from './supa.js'

export const $ = (s) => document.querySelector(s)

// Monta DOM sem innerHTML: texto vira text node, então dado do usuário ou do scraper nunca é interpretado como HTML
export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  el.append(...filhos.flat().filter((f) => f != null && f !== false && f !== ''))
  return el
}

// Ícones desenhados (traço de 1,75 no grid de 24, estilo Feather/Lucide), sempre decorativos: quem nomeia é o texto ou o aria-label
const TRACOS = {
  x: ['M18 6 6 18', 'm6 6 12 12'],
  mais: ['M5 12h14', 'M12 5v14'],
  estrela: ['m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z'],
  telefone: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'],
  conversa: ['M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z'],
  email: ['M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z', 'm22 6-10 7L2 6'],
  site: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'],
  mapa: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  sair: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  buscar: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.35-4.35'],
  arquivar: ['M21 8v13H3V8', 'M1 3h22v5H1z', 'M10 12h4'],
  externo: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3'],
  ok: ['M20 6 9 17l-5-5'],
  alerta: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 8v4', 'M12 16h.01'],
  girando: ['M21 12a9 9 0 1 1-6.22-8.56'],
  enviar: ['m22 2-7 20-4-9-9-4z', 'M22 2 11 13'],
  quadro: ['M3 3h7v18H3z', 'M14 3h7v11h-7z'],
  seta: ['M12 5v14', 'm19 12-7 7-7-7'],
  baixo: ['m6 9 6 6 6-6'],
  usuario: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  equipe: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  chave: ['M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4'],
}
const SVG = 'http://www.w3.org/2000/svg'

export function icone(nome, tamanho = 16) {
  const s = document.createElementNS(SVG, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: tamanho, height: tamanho, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: `ico ico-${nome}` })) {
    s.setAttribute(k, v)
  }
  for (const d of TRACOS[nome]) {
    const p = document.createElementNS(SVG, 'path')
    p.setAttribute('d', d)
    s.append(p)
  }
  return s
}

// No PC a API é o próprio servidor; no site da internet, o PC pelo túnel (config.urlPc). Vai sempre com o login do CRM.
export async function api(path, { method = 'GET', body } = {}) {
  const token = supabase && (await supabase.auth.getSession()).data.session?.access_token
  const headers = { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) }
  let res
  try {
    res = await fetch((config.local ? '' : config.urlPc) + path, { method, headers, body: body && JSON.stringify(body) })
  } catch {
    throw new Error(config.local ? 'O servidor do PC não respondeu. Confira se o Docker está rodando.' : 'O PC da prospecção está desligado ou sem internet. Prospecção e Google Maps voltam quando ele ligar.')
  }
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.erro ?? `Erro ${res.status}`)
  return json
}

export function toast(msg, tipo = 'ok') {
  const t = $('#toast')
  t.replaceChildren(icone(tipo === 'erro' ? 'alerta' : 'ok', 18), h('span', {}, msg))
  t.dataset.tipo = tipo
  t.classList.add('visivel')
  clearTimeout(toast.timer)
  // erro fica mais tempo na tela: a pessoa precisa ler o que fazer
  toast.timer = setTimeout(() => t.classList.remove('visivel'), tipo === 'erro' ? 7000 : 4000)
}

// Botão em andamento: fica desabilitado, mostra o giro e o texto da ação ("Salvando…"); devolve a função que restaura
export function carregando(botao, texto) {
  if (!botao) return () => {}
  const antes = [...botao.childNodes]
  botao.disabled = true
  botao.setAttribute('aria-busy', 'true')
  botao.replaceChildren(icone('girando'), h('span', {}, texto))
  return () => {
    botao.disabled = false
    botao.removeAttribute('aria-busy')
    botao.replaceChildren(...antes)
  }
}

const semMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// Fecha <dialog> com animação de saída (mais curta que a de entrada); Esc e o fundo escuro passam por aqui também
export function fecharDialogo(dlg) {
  if (!dlg.open || dlg.classList.contains('saindo')) return
  if (semMovimento()) return dlg.close()
  dlg.classList.add('saindo')
  dlg.addEventListener(
    'animationend',
    () => {
      dlg.classList.remove('saindo')
      dlg.close()
    },
    { once: true },
  )
}

export function prepararDialogos() {
  for (const dlg of document.querySelectorAll('dialog')) {
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault()
      fecharDialogo(dlg)
    })
    dlg.addEventListener('click', (e) => e.target === dlg && fecharDialogo(dlg))
  }
}

// Bloco de estado (vazio ou erro) que explica o que aconteceu e qual é o próximo passo
export function estado({ titulo, texto, acao, tipo = 'vazio' }) {
  return h('div', { class: `estado estado-${tipo}`, role: tipo === 'erro' ? 'alert' : null }, icone(tipo === 'erro' ? 'alerta' : 'quadro', 22), h('div', {}, h('strong', {}, titulo), texto && h('p', {}, texto), acao))
}

export const esqueleto = (cls) => h('div', { class: `skel ${cls}`, 'aria-hidden': 'true' })
export { norm } from './campos.js'

// nota do Google com a estrela; total é a quantidade de avaliações, quando a origem informa
const notaBr = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const avaliacao = (n, total) => h('span', { class: 'avaliacao' }, icone('estrela', 13), notaBr(n), total != null && h('span', { class: 'muted' }, `(${total})`))
