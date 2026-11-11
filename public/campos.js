// Funções puras (sem Supabase) para o front; testadas em test/campos.test.js

// Formulário vem todo em texto: vazio vira null e os e-mails viram lista, como nas colunas do banco
export function camposLead(form) {
  const out = {}
  for (const [k, v] of Object.entries(form)) {
    if (k === 'emails') {
      out.emails = String(v ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
    } else out[k] = typeof v === 'string' ? v.trim() || null : v
  }
  return out
}

// tira o que tem significado na sintaxe de filtro do PostgREST (vírgula, parênteses, curingas, aspas)
export const termoBusca = (q) =>
  String(q ?? '')
    .replace(/[,()*%\\"]/g, ' ')
    .trim()
    .slice(0, 100)

// Busca do Google Maps a partir dos campos separados: cada ramo vira um termo "<ramo> em <bairro>, <cidade>"
export function buscaMaps({ ramos, cidade, bairro }) {
  const lista = [
    ...new Set(
      String(ramos ?? '')
        .split(/[,\n]/)
        .map((r) => r.trim())
        .filter(Boolean),
    ),
  ]
  const local = [bairro, cidade].map((v) => String(v ?? '').trim()).filter(Boolean).join(', ')
  return { nome: `${lista.join(', ')} · ${String(cidade ?? '').trim()}`.slice(0, 200), keywords: lista.map((r) => `${r} em ${local}`) }
}

// id do cartão de um grupo do Google Maps guardado no CRM online; vai em atributo id do HTML, então sem espaço nem acento
export const idGrupoMaps = ({ local_busca, segmento }) =>
  `crm-${`${local_busca} ${segmento}`
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`

const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const mesmoDia = (a, b) => a.toDateString() === b.toDateString()

// "hoje, 09:12", "ontem" ou a data: o que interessa na lista é há quanto tempo ninguém fala com o lead
export function ultimoContato(iso, agora = new Date()) {
  if (!iso) return null
  const d = new Date(iso)
  if (mesmoDia(d, agora)) return `hoje, ${hora.format(d)}`
  if (mesmoDia(d, new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1))) return 'ontem'
  return dia.format(d)
}

// texto ao lado do nome no cartão da busca; só a busca em andamento formata a hora, porque o cartão do CRM online não tem data
export function resumoBusca(b) {
  if (b.status === 'executando') return `começou às ${hora.format(new Date(b.created_at))}`
  if (b.status === 'pendente') return 'esperando a vez'
  if (b.status === 'falhou') return b.erro ?? 'a busca parou com erro'
  if (!b.encontrados) return 'nenhuma empresa encontrada'
  return `${b.encontrados} ${b.encontrados === 1 ? 'encontrada' : 'encontradas'}${b.enviados ? ` · ${b.enviados} no kanban` : ''}`
}

const MENSAGENS = {
  23505: 'Essa empresa já está no CRM',
  23514: 'Algum campo está com valor inválido (confira site, e-mails e tamanhos)',
  23502: 'Falta preencher um campo obrigatório',
  42501: 'Sem permissão para isso. Entre de novo.',
  PGRST116: 'Lead não encontrado (pode ter sido arquivado)',
  PGRST301: 'Sua sessão expirou. Entre de novo.',
}
export const mensagemErro = (e) => MENSAGENS[e?.code] ?? e?.message ?? 'Não foi possível concluir. Tente de novo.'
