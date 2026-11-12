// Leads, kanban, histórico e equipe no Supabase. Quem vê o quê a RLS decide; aqui é só leitura e gravação.
import { mensagemErro, termoBusca } from './campos.js'
import { lerTudo } from './lugares.js'
import { STATUS } from './rotulos.js'
import { supabase } from './supa.js'

const cliente = () => {
  if (!supabase) throw new Error('O CRM online não está ligado neste computador.')
  return supabase
}

const ok = ({ data, error, count }) => {
  if (error) {
    console.error('CRM:', error.code, error.message)
    throw new Error(mensagemErro(error))
  }
  return { data, count }
}

// Uma consulta só para o quadro inteiro (antes eram sete, uma por coluna, e a tela levava uns 2 a 3 s)
// shortcut: traz os 1000 leads ativos mais recentes; acima disso os totais das colunas ficam por baixo (avisado na tela)
export const LIMITE_KANBAN = 1000
export async function kanban() {
  const { data } = ok(
    await cliente()
      .from('leads_kanban')
      .select('id,nome,categoria,telefone,temperatura,avaliacao,status,updated_at,ultimo_atendimento')
      .order('updated_at', { ascending: false })
      .limit(LIMITE_KANBAN),
  )
  const colunas = STATUS.map((status) => {
    const doStatus = data.filter((l) => l.status === status)
    return { status, total: doStatus.length, itens: doStatus.slice(0, 100) }
  })
  return { colunas, cortado: data.length >= LIMITE_KANBAN }
}

// colunas que a tela deixa ordenar (o nome vai direto para o order do PostgREST)
export const ORDENAVEIS = ['nome', 'status', 'temperatura', 'ultimo_atendimento', 'created_at']

// lê da view do kanban (só leads ativos) porque ela já traz o último atendimento para ordenar
export async function listarLeads({ q, status, temperatura, ordem = 'ultimo_atendimento', crescente = false, page = 1, limit = 25 }) {
  let consulta = cliente().from('leads_kanban').select('id,nome,categoria,status,temperatura,ultimo_atendimento,created_at', { count: 'exact' })
  if (status) consulta = consulta.eq('status', status)
  if (temperatura) consulta = consulta.eq('temperatura', temperatura)
  const termo = termoBusca(q)
  if (termo) consulta = consulta.or(`nome.ilike.*${termo}*,categoria.ilike.*${termo}*,telefone.ilike.*${termo}*`)
  const coluna = ORDENAVEIS.includes(ordem) ? ordem : 'ultimo_atendimento'
  // lead sem contato ou sem temperatura vai para o fim nos dois sentidos; o desempate mantém a página estável
  consulta = consulta.order(coluna, { ascending: crescente, nullsFirst: false })
  if (coluna !== 'created_at') consulta = consulta.order('created_at', { ascending: false })
  const pagina = Math.max(1, Number(page) || 1)
  const de = (pagina - 1) * limit
  const { data, count } = ok(await consulta.order('id').range(de, de + limit - 1))
  return { itens: data, total: count ?? 0, pagina, paginas: Math.max(1, Math.ceil((count ?? 0) / limit)) }
}

// Quais destas empresas já estão no CRM (inclusive arquivadas, que o banco também não deixa voltar): Map cnpj -> arquivada?
export async function jaNoCrm(cnpjs) {
  if (!supabase || !cnpjs.length) return new Map()
  const { data } = ok(await cliente().from('leads').select('cnpj,deleted_at').in('cnpj', cnpjs))
  return new Map(data.map((l) => [l.cnpj, l.deleted_at != null]))
}

export async function lerLead(id) {
  const [lead, historico] = await Promise.all([
    cliente().from('leads').select('*').eq('id', id).is('deleted_at', null).single(),
    cliente().from('atendimentos').select('id,tipo,descricao,data').eq('lead_id', id).order('data', { ascending: false }).limit(500),
  ])
  return { ...ok(lead).data, atendimentos: ok(historico).data }
}

export const criarLead = async (campos) => ok(await cliente().from('leads').insert(campos).select().single()).data
export const atualizarLead = async (id, campos) => ok(await cliente().from('leads').update(campos).eq('id', id).select().single()).data
export const arquivarLead = async (id) => ok(await cliente().from('leads').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id').single())
export const registrarAtendimento = async (leadId, a) => ok(await cliente().from('atendimentos').insert({ lead_id: leadId, ...a }).select('id').single())

// Manda leads em lotes; os que já estão no CRM da equipe (mesmo place_id do Maps ou mesmo CNPJ) o banco ignora
export async function enviarLeads(leads, chave = 'place_id') {
  let novos = 0
  for (let i = 0; i < leads.length; i += 500) {
    const { data } = ok(await cliente().from('leads').upsert(leads.slice(i, i + 500), { onConflict: chave, ignoreDuplicates: true }).select('id'))
    novos += data.length
  }
  return novos
}

// ---------- Google Maps guardado no CRM online ----------
// Todas as empresas da pesquisa, para o mapa: uma linha por empresa, segmento e local da busca; enviado diz se já virou lead.
// Vem em páginas porque a API devolve no máximo 1000 linhas por vez; a ordem fixa não deixa uma linha cair entre duas páginas.
export const empresasMaps = () =>
  lerTudo(async (de, ate) =>
    ok(
      await cliente()
        .from('maps_empresas')
        .select('place_id,segmento,servico,local_busca,nome,categoria,endereco,telefone,site,avaliacao,latitude,longitude,link_maps,enviado', { count: 'exact' })
        .order('nome')
        .order('place_id')
        .order('segmento')
        .order('local_busca')
        .range(de, ate),
    ),
  )

// Guarda no CRM online as empresas de uma busca do PC (lugaresDaBusca). A mesma busca de novo atualiza as que já
// estavam e traz de volta as de uma busca excluída; vai em partes para não passar do tamanho de uma chamada.
export async function guardarBusca(linhas) {
  for (let i = 0; i < linhas.length; i += 500) ok(await cliente().from('maps_lugares').upsert(linhas.slice(i, i + 500), { onConflict: 'place_id,segmento,local_busca' }))
}

// As buscas guardadas, uma por segmento e local, da mais nova para a mais antiga
// shortcut: lê até 1000 buscas; acima disso, ler em páginas com lerTudo
export const buscasGuardadas = async () =>
  ok(await cliente().from('maps_grupos').select('local_busca,segmento,encontrados,enviados,ultima').order('ultima', { ascending: false }).limit(1000)).data

// Excluir a busca tira as empresas dela do mapa (deleted_at); o que já virou lead continua no kanban. Devolve quantas saíram.
export async function excluirBusca({ segmento, local_busca }) {
  const { data } = ok(await cliente().from('maps_lugares').update({ deleted_at: new Date().toISOString() }).eq('segmento', segmento).eq('local_busca', local_busca).is('deleted_at', null).select('id'))
  return data.length
}

// ---------- clientes ativos ----------
// Uma lista só, lida inteira e guardada até alguém mudar: o mapa, as buscas do PC e a Prospecção conferem nela.
// shortcut: lê até 1000 clientes de uma vez; acima disso, ler em páginas com lerTudo
let pedidoClientes
export function clientesAtivos() {
  pedidoClientes ??= (async () => ok(await cliente().from('clientes_ativos').select('id,nome').is('deleted_at', null).order('nome').limit(1000)).data)().catch((err) => {
    pedidoClientes = null
    throw err
  })
  return pedidoClientes
}

export async function cadastrarCliente(nome) {
  const { error } = await cliente().from('clientes_ativos').insert({ nome })
  if (error?.code === '23505') throw new Error('Esse cliente já está na lista.')
  ok({ error })
  pedidoClientes = null
}

// tirar da lista não apaga: preenche deleted_at, e o cliente volta a aparecer nas pesquisas
export async function tirarCliente(id) {
  ok(await cliente().from('clientes_ativos').update({ deleted_at: new Date().toISOString() }).eq('id', id))
  pedidoClientes = null
}

// ---------- equipe ----------
// a linha de quem está logado diz se ele entra nos leads (ativo) e se cadastra usuários (admin)
export const meuPerfil = async (userId) => ok(await cliente().from('membros').select('nome,papel,ativo').eq('user_id', userId).maybeSingle()).data
export const listarMembros = async () => ok(await cliente().from('membros').select('user_id,nome,email,papel,ativo,ativado_em').order('nome')).data

// ---------- acessos por tela ----------
// as telas que a pessoa logada abre (administrador: todas); o banco confere de novo em cada tabela
export const minhasTelas = async () => ok(await cliente().rpc('minhas_telas')).data
// só o administrador lê as telas de todos e muda (RLS de membro_telas)
export const listarAcessos = async () => ok(await cliente().from('membro_telas').select('user_id,tela')).data
export async function definirAcesso(userId, tela, liberar) {
  const tabela = cliente().from('membro_telas')
  const { error } = liberar ? await tabela.insert({ user_id: userId, tela }) : await tabela.delete().eq('user_id', userId).eq('tela', tela)
  // já liberada (outro administrador ao mesmo tempo): o resultado é o mesmo
  if (error?.code !== '23505') ok({ error })
}

// cadastrar, desativar e reativar passam pela função "usuarios", a única com a chave secreta
export async function gerirUsuario(corpo) {
  const { data, error } = await cliente().functions.invoke('usuarios', { body: corpo })
  if (!error) return data
  console.error('usuarios:', error.message)
  const motivo = await error.context?.json?.().then((j) => j.erro, () => null)
  throw new Error(motivo ?? 'O cadastro de usuários não respondeu. Confira se a função "usuarios" está instalada no CRM online.')
}

// sem login: quem o admin cadastrou digita o e-mail e cria a própria senha, uma vez só
export const primeiroAcesso = (email, senha) => gerirUsuario({ acao: 'primeiro_acesso', email, senha })

export async function trocarSenha(senha) {
  const { error } = await cliente().auth.updateUser({ password: senha })
  if (!error) return
  console.error('senha:', error.code)
  throw new Error({ same_password: 'A senha nova é igual à atual.', weak_password: 'Senha fraca: use pelo menos 8 caracteres.' }[error.code] ?? 'Não foi possível trocar a senha.')
}
