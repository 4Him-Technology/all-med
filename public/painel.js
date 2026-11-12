// Aba Painel: períodos, comparações e textos, sem DOM (testado em test/painel.test.js).
// Os números chegam prontos do banco (public.painel_gerencial); aqui só se escolhe o período e se escreve o que eles dizem.

const numero = (n) => n.toLocaleString('pt-BR')
const plural = (n, um, varios) => `${numero(n)} ${n === 1 ? um : varios}`

// rotulo vai no botão; frase entra no meio da manchete; anteriores diz com o que se compara
export const PERIODOS = {
  7: { rotulo: '7 dias', frase: 'nos últimos 7 dias', anteriores: '7 dias anteriores', dias: 7 },
  30: { rotulo: '30 dias', frase: 'nos últimos 30 dias', anteriores: '30 dias anteriores', dias: 30 },
  90: { rotulo: '90 dias', frase: 'nos últimos 90 dias', anteriores: '90 dias anteriores', dias: 90 },
  365: { rotulo: '12 meses', frase: 'nos últimos 12 meses', anteriores: '12 meses anteriores', dias: 365 },
  tudo: { rotulo: 'Desde o começo', frase: 'desde o começo', anteriores: null, dias: null },
}

// "Últimos 7 dias" é hoje mais os 6 dias anteriores, a partir da meia-noite; o fim é sempre agora (o banco usa now())
export function periodo(chave, agora = new Date()) {
  const c = Object.hasOwn(PERIODOS, chave) ? String(chave) : '30'
  const { dias } = PERIODOS[c]
  const de = dias && new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - (dias - 1)).toISOString()
  return { chave: c, ...PERIODOS[c], de: de || null, ate: null }
}

// diferença em número, não em porcentagem: com poucos leads, "+100%" pode ser um lead a mais.
// O texto é curto porque vai embaixo de cada número; com o que se compara, a tela diz uma vez só
export function comparar(atual, anterior) {
  if (anterior == null) return null
  const d = atual - anterior
  if (!d) return { sentido: 'igual', texto: 'igual' }
  return { sentido: d > 0 ? 'subiu' : 'caiu', texto: `${numero(Math.abs(d))} a ${d > 0 ? 'mais' : 'menos'}` }
}

export function taxa(n, total) {
  if (!total) return null
  const p = (n / total) * 100
  return `${p.toLocaleString('pt-BR', { maximumFractionDigits: p > 0 && p < 1 ? 1 : 0 })}%`
}

// conversão de cada etapa a partir da anterior (a primeira não tem de onde converter)
export const conversoes = (etapas) => etapas.map((e, i) => ({ ...e, taxa: i && etapas[i - 1].leads ? e.leads / etapas[i - 1].leads : null }))

export function duracao(horas) {
  if (horas == null) return null
  if (horas < 1) return 'menos de 1 h'
  if (horas < 48) return `${Math.round(horas)} h`
  return `${(horas / 24).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
}

export const semContato = ({ dias, nunca }) => (nunca ? `nunca teve contato, entrou há ${plural(dias, 'dia', 'dias')}` : `${plural(dias, 'dia', 'dias')} sem contato`)

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
// o banco manda o início do dia, da semana ou do mês como 'AAAA-MM-DD', já no horário de São Paulo
export function rotuloBalde(inicio, unidade) {
  const [a, m, d] = inicio.split('-')
  if (unidade === 'month') return `${MESES[m - 1]}/${a.slice(2)}`
  return `${unidade === 'week' ? 'sem. ' : ''}${d}/${m}`
}

export const parados = (faixas) => faixas.de_8_a_14 + faixas.de_15_a_30 + faixas.mais_de_30

// A frase que abre o painel: o que foi feito no período, como os contatos se comparam e quantos leads esperam contato
export function manchete({ periodo: per, atual, anterior, hoje }, { frase, anteriores }) {
  const feitos = [plural(atual.contatos, 'contato', 'contatos'), atual.leads_novos && plural(atual.leads_novos, 'lead novo', 'leads novos'), atual.ganhos && plural(atual.ganhos, 'ganho', 'ganhos')].filter(Boolean)
  const titulo = atual.contatos || atual.leads_novos || atual.ganhos ? `${feitos.slice(0, -1).join(', ')}${feitos.length > 1 ? ' e ' : ''}${feitos.at(-1)} ${frase}.` : `Nenhum contato registrado ${frase}.`
  const linhas = []
  const d = per.compara && anterior ? atual.contatos - anterior.contatos : 0
  if (d) linhas.push(`${Math.abs(d) === 1 ? 'É' : 'São'} ${plural(Math.abs(d), 'contato', 'contatos')} a ${d > 0 ? 'mais' : 'menos'} que nos ${anteriores}.`)
  else if (per.compara && anterior && atual.contatos) linhas.push(`O mesmo número de contatos dos ${anteriores}.`)
  const n = parados(hoje.parados.faixas)
  linhas.push(n ? `${plural(n, 'lead em andamento está', 'leads em andamento estão')} há mais de 7 dias sem contato.` : 'Nenhum lead em andamento está parado há mais de 7 dias.')
  return { titulo, linhas }
}
