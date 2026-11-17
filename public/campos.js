// Funções puras (sem Supabase) para o front; testadas em test/campos.test.js

// sem acento e em minúsculas, para comparar com texto digitado
export const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()

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

// Em qual empresa a pessoa entra depois do login. O membro é de uma só (o banco só devolve a dele) e entra direto. O
// administrador escolhe entre as que não foram excluídas, a não ser que já tenha escolhido nesta aba (guardada).
// Quem recebe mais de uma também escolhe (o papel pode não ter carregado), em vez de cair na primeira sem ver.
// Sem empresa e sem opções, a conta não tem onde entrar.
export function empresaInicial({ empresas, admin, guardada }) {
  const ativas = empresas.filter((e) => !e.deleted_at)
  if (!admin && ativas.length <= 1) return { empresa: ativas[0] ?? null, opcoes: [] }
  return { empresa: ativas.find((e) => e.id === guardada) ?? null, opcoes: ativas }
}

// Excluir empresa não fica à mão: só a empresa aberta agora (quem exclui está vendo o que exclui) e nunca a única ativa,
// porque sem nenhuma ninguém entra. Devolve a empresa como está no banco (com o nome de agora) ou o motivo de não poder.
export function exclusaoEmpresa({ empresas, atualId }) {
  const ativas = empresas.filter((e) => !e.deleted_at)
  const empresa = ativas.find((e) => e.id === atualId)
  if (!empresa) return { motivo: 'Para excluir uma empresa, entre nela e abra esta janela de novo.' }
  if (ativas.length < 2) return { motivo: `${empresa.nome} é a única empresa ativa e não pode ser excluída.` }
  return { empresa }
}

// Quem perde o acesso ao excluir a empresa: os membros ativos dela. O administrador continua entrando nas outras.
export function quemPerdeAcesso(membros) {
  if (!membros) return 'Quem é dela perde o acesso ao sistema na hora.'
  const n = membros.filter((m) => m.papel !== 'admin' && m.ativo).length
  if (!n) return 'Ninguém perde o acesso: ela não tem membros ativos.'
  return n === 1 ? '1 pessoa da equipe dela perde o acesso ao sistema na hora.' : `${n} pessoas da equipe dela perdem o acesso ao sistema na hora.`
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

// texto ao lado do nome no cartão da busca; só a busca em andamento formata a hora de início
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
