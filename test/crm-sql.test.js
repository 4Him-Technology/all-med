// Roda as migrations do CRM (supabase/migrations) num Postgres em memória com o esquema auth simulado como no Supabase
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url)
const ANA = '11111111-1111-4111-8111-111111111111' // admin da equipe
const BRUNO = '22222222-2222-4222-8222-222222222222' // membro
const CARLA = '33333333-3333-4333-8333-333333333333' // tem conta, mas não é da equipe
const DANI = '44444444-4444-4444-8444-444444444444' // membro desativado
const EDU = '55555555-5555-4555-8555-555555555555' // membro que só prospecta: Prospecção e Google Maps
const FABI = '66666666-6666-4666-8666-666666666666' // membro só com o Kanban
const TODAS = ['kanban', 'leads', 'prospeccao', 'buscas', 'clientes']
let db

const AUTH_SUPABASE = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`
const ARQUIVOS = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()
const migrar = async (banco, arquivos = ARQUIVOS) => {
  for (const f of arquivos) await banco.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'))
}
// as telas que o admin liberou para cada um (a carga entra direto, como dona das tabelas)
const liberar = (uid, telas) => db.query('insert into public.membro_telas (user_id, tela) select $1, unnest($2::text[])::public.tela', [uid, telas])

before(async () => {
  db = new PGlite()
  await db.exec(AUTH_SUPABASE)
  await migrar(db)
  for (const [id, email] of [[ANA, 'ana@x.com'], [BRUNO, 'bruno@x.com'], [CARLA, 'carla@x.com'], [DANI, 'dani@x.com'], [EDU, 'edu@x.com'], [FABI, 'fabi@x.com']]) await db.query('insert into auth.users values ($1, $2)', [id, email])
  await db.query(
    `insert into public.membros (user_id, email, nome, papel, ativo) values
      ($1, 'ana@x.com', 'Ana', 'admin', true), ($2, 'bruno@x.com', 'Bruno', 'membro', true), ($3, 'dani@x.com', 'Dani', 'membro', false),
      ($4, 'edu@x.com', 'Edu', 'membro', true), ($5, 'fabi@x.com', 'Fabi', 'membro', true)`,
    [ANA, BRUNO, DANI, EDU, FABI],
  )
  await liberar(BRUNO, TODAS)
  // desativado não abre nada, mesmo com telas liberadas
  await liberar(DANI, TODAS)
  await liberar(EDU, ['prospeccao', 'buscas'])
  await liberar(FABI, ['kanban'])
})

// executa como um usuário logado do Supabase (papel authenticated + sub do JWT)
async function como(uid, sql, params) {
  await db.exec('set role authenticated')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid])
  try {
    return (await db.query(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}
const novoLead = async (uid, campos = {}) => {
  const c = { nome: 'Empresa', ...campos }
  const cols = Object.keys(c)
  return (await como(uid, `insert into public.leads (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(c)))[0]
}

test('a equipe vê e trabalha os mesmos leads; quem está fora ou foi desativado não vê nada', async () => {
  const l = await novoLead(ANA, { nome: 'Clínica da Ana' })
  assert.equal(l.user_id, ANA)
  assert.equal(l.status, 'novo')
  assert.equal(l.origem, 'manual')
  assert.equal((await como(BRUNO, 'select * from public.leads where id = $1', [l.id])).length, 1)
  assert.equal((await como(BRUNO, `update public.leads set temperatura = 'quente' where id = $1 returning id`, [l.id])).length, 1)
  for (const fora of [CARLA, DANI]) {
    assert.equal((await como(fora, 'select * from public.leads where id = $1', [l.id])).length, 0)
    assert.equal((await como(fora, `update public.leads set nome = 'roubado' where id = $1 returning id`, [l.id])).length, 0)
    await assert.rejects(novoLead(fora, { nome: 'intruso' }), /row-level security/)
  }
})

test('não dá para criar lead em nome de outro nem trocar quem criou', async () => {
  await assert.rejects(como(ANA, `insert into public.leads (nome, user_id) values ('x', $1)`, [BRUNO]), /permission denied|row-level security/)
  const l = await novoLead(ANA)
  await assert.rejects(como(ANA, 'update public.leads set user_id = $1 where id = $2', [BRUNO, l.id]), /permission denied/)
  await assert.rejects(como(ANA, `update public.leads set created_at = now() where id = $1`, [l.id]), /permission denied/)
})

test('lead não é apagado de verdade; arquivar é preencher deleted_at', async () => {
  const l = await novoLead(ANA)
  await assert.rejects(como(ANA, 'delete from public.leads where id = $1', [l.id]), /permission denied/)
  await como(BRUNO, 'update public.leads set deleted_at = now() where id = $1', [l.id])
  assert.equal((await como(ANA, 'select * from public.leads_kanban where id = $1', [l.id])).length, 0)
  // arquivado não é mais editável
  assert.equal((await como(ANA, `update public.leads set nome = 'volta' where id = $1 returning id`, [l.id])).length, 0)
})

test('mudança de status entra sozinha no histórico, em nome de quem mudou, só quando muda', async () => {
  const l = await novoLead(ANA)
  await como(BRUNO, `update public.leads set status = 'proposta' where id = $1`, [l.id])
  await como(BRUNO, `update public.leads set status = 'proposta', observacoes = 'x' where id = $1`, [l.id])
  const h = await como(ANA, 'select tipo, descricao, user_id from public.atendimentos where lead_id = $1', [l.id])
  assert.deepEqual(h, [{ tipo: 'status', descricao: 'Status alterado de Novo para Proposta', user_id: BRUNO }])
  const [atual] = await como(ANA, 'select created_at, updated_at from public.leads where id = $1', [l.id])
  assert.ok(atual.updated_at > atual.created_at)
})

test('atendimento manual em qualquer lead da equipe, nunca forjando mudança de status', async () => {
  const l = await novoLead(ANA)
  const [a] = await como(BRUNO, `insert into public.atendimentos (lead_id, tipo, descricao) values ($1, 'ligacao', 'Falei com a dona') returning *`, [l.id])
  assert.equal(a.user_id, BRUNO)
  await assert.rejects(como(ANA, `insert into public.atendimentos (lead_id, tipo, descricao) values ($1, 'status', 'forjado')`, [l.id]), /row-level security/)
  await assert.rejects(como(CARLA, `insert into public.atendimentos (lead_id, tipo, descricao) values ($1, 'ligacao', 'intruso')`, [l.id]), /row-level security/)
  assert.equal((await como(CARLA, 'select * from public.atendimentos where lead_id = $1', [l.id])).length, 0)
  await assert.rejects(como(ANA, `update public.atendimentos set descricao = 'editado' where id = $1`, [a.id]), /permission denied/)
  await assert.rejects(como(ANA, 'delete from public.atendimentos where id = $1', [a.id]), /permission denied/)
})

test('a mesma empresa não entra duas vezes na equipe, nem depois de arquivada', async () => {
  await novoLead(ANA, { nome: 'A', cnpj: '11111111000101', origem: 'receita' })
  await assert.rejects(novoLead(BRUNO, { nome: 'A de novo', cnpj: '11111111000101' }), (err) => err.code === '23505')
  // importação do Maps ignora o que já existe
  await novoLead(ANA, { nome: 'P', place_id: 'ChIJ1' })
  const r = await como(BRUNO, `insert into public.leads (nome, place_id) values ('P', 'ChIJ1'), ('Q', 'ChIJ2') on conflict (place_id) do nothing returning nome`)
  assert.deepEqual(r.map((x) => x.nome), ['Q'])
})

test('o banco recusa dado inválido', async () => {
  for (const campos of [{ nome: '' }, { site: 'javascript:alert(1)' }, { cnpj: '123' }, { emails: ['nao-e-email'] }, { avaliacao: 7 }, { nome: 'x'.repeat(201) }]) {
    await assert.rejects(novoLead(ANA, campos), (err) => err.code === '23514', JSON.stringify(campos))
  }
  assert.deepEqual((await novoLead(ANA, { emails: ['a@b.com.br'] })).emails, ['a@b.com.br'])
})

test('visitante sem login não lê nem grava', async () => {
  await db.exec('set role anon')
  try {
    await assert.rejects(db.query('select * from public.leads'), /permission denied/)
    await assert.rejects(db.query(`insert into public.leads (nome) values ('x')`), /permission denied/)
    await assert.rejects(db.query('select * from public.leads_kanban'), /permission denied/)
    await assert.rejects(db.query('select * from public.membros'), /permission denied/)
  } finally {
    await db.exec('reset role')
  }
})

test('kanban traz o último contato sem contar mudança de status, para a equipe toda', async () => {
  const l = await novoLead(BRUNO, { nome: 'Kanban do Bruno' })
  await como(BRUNO, `insert into public.atendimentos (lead_id, tipo, descricao, data) values ($1, 'whatsapp', 'oi', '2026-10-01T10:00:00Z')`, [l.id])
  await como(BRUNO, `update public.leads set status = 'contato' where id = $1`, [l.id])
  const [k] = await como(ANA, 'select status, ultimo_atendimento from public.leads_kanban where id = $1', [l.id])
  assert.equal(k.status, 'contato')
  assert.equal(new Date(k.ultimo_atendimento).toISOString(), '2026-10-01T10:00:00.000Z')
  assert.equal((await como(CARLA, 'select * from public.leads_kanban where id = $1', [l.id])).length, 0)
})

test('lista de leads ordena pelo último contato e o envio em lote por CNPJ ignora os repetidos', async () => {
  const a = await novoLead(ANA, { nome: 'Lista A', cnpj: '33333333000101', origem: 'receita' })
  await como(ANA, `insert into public.atendimentos (lead_id, tipo, descricao, data) values ($1, 'ligacao', 'oi', '2026-10-02T10:00:00Z')`, [a.id])
  const lote = await como(BRUNO, `insert into public.leads (nome, cnpj, origem) values ('Lista A de novo', '33333333000101', 'receita'), ('Lista B', '44444444000101', 'receita') on conflict (cnpj) do nothing returning nome`)
  assert.deepEqual(lote.map((l) => l.nome), ['Lista B'])
  const lista = await como(ANA, `select nome, origem, created_at, total_avaliacoes from public.leads_kanban where nome like 'Lista %' order by ultimo_atendimento asc nulls first`)
  assert.deepEqual(lista.map((l) => l.nome), ['Lista B', 'Lista A'])
  assert.ok(lista.every((l) => l.created_at && l.origem === 'receita'))
})

test('a equipe vê quem faz parte dela, mas ninguém se cadastra nem muda o próprio papel pelo app', async () => {
  const nomes = (await como(BRUNO, 'select nome from public.membros order by nome')).map((m) => m.nome)
  assert.deepEqual(nomes, ['Ana', 'Bruno', 'Dani', 'Edu', 'Fabi'])
  // a lista de usuários mostra quem ainda não fez o primeiro acesso
  assert.equal((await como(ANA, 'select ativado_em from public.membros where user_id = $1', [BRUNO]))[0].ativado_em, null)
  await assert.rejects(como(BRUNO, 'update public.membros set ativado_em = now() where user_id = $1', [BRUNO]), /permission denied/)
  assert.equal((await como(CARLA, 'select nome from public.membros')).length, 0)
  // desativado ainda enxerga a própria linha, para a tela explicar por que está sem acesso
  assert.deepEqual((await como(DANI, 'select nome, ativo from public.membros')), [{ nome: 'Dani', ativo: false }])
  await assert.rejects(como(CARLA, `insert into public.membros (user_id, email, nome) values ($1, 'carla@x.com', 'Carla')`, [CARLA]), /permission denied/)
  await assert.rejects(como(BRUNO, `update public.membros set papel = 'admin' where user_id = $1`, [BRUNO]), /permission denied/)
})

test('conta que criou leads não pode ser apagada: desativa-se o membro', async () => {
  await novoLead(BRUNO, { nome: 'Do Bruno' })
  // 23001 = restrict_violation
  await assert.rejects(db.query('delete from auth.users where id = $1', [BRUNO]), (err) => err.code === '23001')
})

test('quem já tinha conta quando a equipe foi criada vira admin', async () => {
  const banco = new PGlite()
  await banco.exec(AUTH_SUPABASE)
  // a primeira migration já cria tabelas ligadas a auth.users; a conta existe antes da migration da equipe
  await banco.query(`insert into auth.users values ($1, 'dono@exemplo.com')`, [ANA])
  await migrar(banco)
  assert.deepEqual((await banco.query('select nome, papel, ativo from public.membros')).rows, [{ nome: 'dono', papel: 'admin', ativo: true }])
  // quem já entrava com senha conta como primeiro acesso feito
  assert.ok((await banco.query('select ativado_em from public.membros')).rows[0].ativado_em)
})

// ---------- Painel gerencial ----------
// Banco próprio, porque os números somam tudo o que existe nele. O período fica em setembro de 2026 (8 a 14, horário de São Paulo);
// os leads parados contam a partir de agora. O cenário entra direto, como dona das tabelas, para escolher as datas.
const PERIODO = ['2026-09-08T03:00:00Z', '2026-09-15T02:59:59Z']
const L = (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`
let bancoPainel
const painelPronto = () => (bancoPainel ??= montarPainel())
async function montarPainel() {
  const b = new PGlite()
  await b.exec(AUTH_SUPABASE)
  await migrar(b)
  for (const [id, email] of [[ANA, 'ana@x.com'], [BRUNO, 'bruno@x.com'], [CARLA, 'carla@x.com'], [DANI, 'dani@x.com']]) await b.query('insert into auth.users values ($1, $2)', [id, email])
  await b.query(`insert into public.membros (user_id, email, nome, papel, ativo) values ($1, 'ana@x.com', 'Ana', 'admin', true), ($2, 'bruno@x.com', 'Bruno', 'membro', true), ($3, 'dani@x.com', 'Dani', 'membro', false)`, [ANA, BRUNO, DANI])
  await b.query(
    `insert into public.leads (id, user_id, nome, status, temperatura, origem, place_id, cnpj, created_at, deleted_at) values
      ($1, $7, 'Lead Um', 'ganho', null, 'maps', 'p1', null, '2026-09-08T12:00:00Z', null),
      ($2, $7, 'Lead Dois', 'perdido', null, 'receita', null, '55555555000101', '2026-09-09T12:00:00Z', null),
      ($3, $7, 'Lead Três', 'novo', 'quente', 'manual', null, null, '2026-09-10T12:00:00Z', null),
      ($4, $7, 'Lead Quatro', 'contato', null, 'maps', 'p2', null, '2026-09-02T12:00:00Z', null),
      ($5, $7, 'Lead Arquivado', 'novo', null, 'manual', null, null, '2026-09-09T12:00:00Z', '2026-09-10T12:00:00Z'),
      ($6, $7, 'Lead Recente', 'qualificado', null, 'manual', null, null, now() - interval '3 days', null)`,
    [L(1), L(2), L(3), L(4), L(5), L(6), ANA],
  )
  // histórico de etapas no formato que o trigger grava, e os contatos registrados na ficha
  await b.query(
    `insert into public.atendimentos (lead_id, user_id, tipo, descricao, data) values
      ($1, $6, 'status', 'Status alterado de Novo para Em contato', '2026-09-09T12:00:00Z'),
      ($1, $6, 'status', 'Status alterado de Em contato para Proposta', '2026-09-10T12:00:00Z'),
      ($1, $6, 'status', 'Status alterado de Proposta para Ganho', '2026-09-12T12:00:00Z'),
      ($2, $6, 'status', 'Status alterado de Novo para Em contato', '2026-09-10T13:00:00Z'),
      ($2, $6, 'status', 'Status alterado de Em contato para Perdido', '2026-09-13T12:00:00Z'),
      ($3, $6, 'status', 'Status alterado de Novo para Em contato', '2026-09-03T12:00:00Z'),
      ($1, $6, 'ligacao', 'oi', '2026-09-08T15:00:00Z'),
      ($1, $6, 'whatsapp', 'oi', '2026-09-12T01:30:00Z'),
      ($2, $6, 'email', 'oi', '2026-09-10T18:00:00Z'),
      ($3, $6, 'ligacao', 'oi', '2026-09-03T13:00:00Z'),
      ($4, $6, 'visita', 'oi', '2026-09-09T14:00:00Z'),
      ($5, $6, 'outro', 'oi', now() - interval '1 day')`,
    [L(1), L(2), L(4), L(5), L(6), BRUNO],
  )
  // p1 aparece em dois segmentos da mesma busca; p4 foi excluída
  await b.exec(
    `insert into public.maps_lugares (place_id, segmento, local_busca, nome, endereco, telefone, avaliacao, created_at, deleted_at) values
      ('p1', 'Transportadora', 'Lapa', 'Lead Um', 'R. A, 1', '(11) 3333-0001', 4.5, '2026-08-01T12:00:00Z', null),
      ('p1', 'Logística', 'Lapa', 'Lead Um', 'R. A, 1', '(11) 3333-0001', 4.5, '2026-08-01T12:00:00Z', null),
      ('p2', 'Transportadora', 'Osasco', 'Lead Quatro', 'R. B, 2', '(11) 3333-0002', 4.0, '2026-08-01T12:00:00Z', null),
      ('p3', 'Padaria', 'Lapa', 'Padaria Três', 'R. C, 3', '(11) 3333-0003', 4.8, '2026-09-10T12:00:00Z', null),
      ('p4', 'Padaria', 'Osasco', 'Padaria Fechada', 'R. D, 4', '(11) 3333-0004', 3.0, '2026-08-01T12:00:00Z', '2026-08-02T12:00:00Z');
     insert into public.clientes_ativos (nome, deleted_at) values ('Cliente Ativo', null), ('Cliente Tirado', now());`,
  )
  return b
}
async function painelComo(uid, de, ate) {
  const b = await painelPronto()
  await b.exec('set role authenticated')
  await b.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid])
  try {
    return (await b.query('select public.painel_gerencial($1, $2) as p', [de, ate])).rows[0].p
  } finally {
    await b.exec('reset role')
  }
}
const porChave = (linhas, chave, valor) => Object.fromEntries(linhas.map((l) => [l[chave], l[valor]]))

test('Painel: números do período contra o período anterior, sem contar mudança de etapa como contato nem lead arquivado', async () => {
  const p = await painelComo(ANA, ...PERIODO)
  assert.equal(p.periodo.unidade, 'day')
  assert.equal(p.periodo.compara, true)
  // o Lead Arquivado saiu no dia 10; os contatos caíram em 4 dias diferentes (no anterior, num só)
  assert.deepEqual(p.atual, { contatos: 4, leads_novos: 3, avancos: 4, ganhos: 1, perdidos: 1, empresas_novas: 1, arquivados: 1, dias_com_contato: 4 })
  assert.deepEqual(p.anterior, { contatos: 1, leads_novos: 1, avancos: 1, ganhos: 0, perdidos: 0, empresas_novas: 0, arquivados: 0, dias_com_contato: 1 })
  // dos 3 leads do período, 2 tiveram contato (3 h e 30 h depois de entrar) e 1 ainda não
  assert.deepEqual(p.primeiro_contato, { leads: 3, com_contato: 2, sem_contato: 1, mediana_horas: 16.5 })
  assert.deepEqual(porChave(p.tipos, 'tipo', 'total'), { email: 1, ligacao: 1, visita: 1, whatsapp: 1 })
})

test('Painel: funil dos leads que entraram no período conta quem chegou pelo menos até cada etapa', async () => {
  const { funil, origens } = await painelComo(ANA, ...PERIODO)
  // o Lead Um pulou Qualificado e Negociação, mas chegou ao Ganho: conta em todas as etapas até lá
  assert.deepEqual(porChave(funil.etapas, 'status', 'leads'), { novo: 3, contato: 2, qualificado: 1, proposta: 1, negociacao: 1, ganho: 1 })
  assert.deepEqual(funil.etapas.map((e) => e.status), ['novo', 'contato', 'qualificado', 'proposta', 'negociacao', 'ganho'])
  assert.equal(funil.perdidos, 1)
  assert.equal(funil.em_aberto, 1)
  const o = Object.fromEntries(origens.map(({ origem, ...resto }) => [origem, resto]))
  assert.deepEqual(o, {
    maps: { leads: 1, com_contato: 1, qualificados: 1, ganhos: 1, perdidos: 0 },
    receita: { leads: 1, com_contato: 1, qualificados: 0, ganhos: 0, perdidos: 1 },
    manual: { leads: 1, com_contato: 0, qualificados: 0, ganhos: 0, perdidos: 0 },
  })
})

test('Painel: série por dia no horário de São Paulo, com os dias vazios no lugar', async () => {
  const { serie } = await painelComo(ANA, ...PERIODO)
  assert.deepEqual(serie.map((s) => s.inicio), ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'])
  // o WhatsApp das 01:30 UTC do dia 12 foi às 22:30 do dia 11 em São Paulo
  assert.deepEqual(serie.map((s) => s.contatos), [1, 1, 1, 1, 0, 0, 0])
  assert.deepEqual(serie.map((s) => s.leads), [1, 1, 1, 0, 0, 0, 0])
  assert.deepEqual(serie.map((s) => s.ganhos), [0, 0, 0, 0, 1, 0, 0])
})

test('Painel: situação de hoje, com os leads em andamento parados há mais de 7 dias sem contato', async () => {
  const { hoje } = await painelComo(ANA, ...PERIODO)
  assert.deepEqual(porChave(hoje.etapas, 'status', 'leads'), { novo: 1, contato: 1, qualificado: 1, ganho: 1, perdido: 1 })
  assert.deepEqual(hoje.parados.faixas, { ate_7: 1, de_8_a_14: 0, de_15_a_30: 0, mais_de_30: 2 })
  // o mais antigo primeiro; quem nunca teve contato conta desde que entrou
  assert.deepEqual(hoje.parados.lista.map((l) => [l.id, l.nome, l.status, l.temperatura, l.nunca]), [
    [L(4), 'Lead Quatro', 'contato', null, false],
    [L(3), 'Lead Três', 'novo', 'quente', true],
  ])
  assert.ok(hoje.parados.lista.every((l) => l.dias > 30))
  assert.deepEqual(porChave(hoje.temperatura, 'temperatura', 'leads'), { quente: 1, null: 2 })
  assert.equal(hoje.clientes_ativos, 1)
  assert.equal(hoje.arquivados, 1)
  assert.equal(hoje.empresas, 3)
  assert.equal(hoje.empresas_lead, 2)
})

test('Painel: segmentos e locais de busca do Google Maps, com quantas empresas viraram lead e quantas foram ganhas', async () => {
  const { segmentos, regioes } = await painelComo(ANA, ...PERIODO)
  assert.deepEqual(segmentos, [
    { segmento: 'Transportadora', empresas: 2, leads: 2, ganhos: 1 },
    { segmento: 'Logística', empresas: 1, leads: 1, ganhos: 1 },
    { segmento: 'Padaria', empresas: 1, leads: 0, ganhos: 0 },
  ])
  assert.deepEqual(regioes, [
    { local_busca: 'Lapa', empresas: 2, leads: 1, ganhos: 1 },
    { local_busca: 'Osasco', empresas: 1, leads: 1, ganhos: 0 },
  ])
})

test('Painel: etapas desde o começo, tempo em cada etapa e o ciclo até o ganho', async () => {
  const { pipeline, tempo_etapas, ciclo } = await painelComo(ANA, ...PERIODO)
  // todos os leads que não foram arquivados, de qualquer data: o Lead Recente entrou direto em Qualificado
  assert.deepEqual(porChave(pipeline, 'status', 'chegaram'), { novo: 5, contato: 4, qualificado: 2, proposta: 1, negociacao: 1, ganho: 1 })
  // passagens que terminaram no período: Novo (1 dia e 25 h), Em contato (1 dia e 71 h) e Proposta (2 dias)
  const t = Object.fromEntries(tempo_etapas.map(({ status, ...r }) => [status, r]))
  assert.deepEqual(Object.keys(t), ['novo', 'contato', 'qualificado', 'proposta', 'negociacao'])
  assert.deepEqual([t.novo.saidas, t.novo.mediana_dias, t.contato.saidas, t.contato.mediana_dias, t.proposta.saidas, t.proposta.mediana_dias], [2, 1, 2, 2, 1, 2])
  assert.deepEqual([t.qualificado.saidas, t.qualificado.mediana_dias, t.negociacao.saidas], [0, null, 0])
  // quem está na etapa agora e há quanto tempo (o Lead Recente está em Qualificado há 3 dias)
  assert.deepEqual([t.novo.agora, t.contato.agora, t.qualificado.agora, t.proposta.agora, t.proposta.mediana_agora_dias], [1, 1, 1, 0, null])
  assert.ok(Math.abs(t.qualificado.mediana_agora_dias - 3) < 0.2)
  // o Lead Um entrou no dia 8 ao meio-dia e foi ganho no dia 12 ao meio-dia, com 2 contatos antes
  assert.deepEqual(ciclo, { ganhos: 1, mediana_dias: 4, mediana_contatos: 2 })
})

test('Painel: ritmo por dia da semana e hora, temperatura por etapa, território e o funil do Google Maps', async () => {
  const p = await painelComo(ANA, ...PERIODO)
  // dia da semana de 1 (segunda) a 7 (domingo) e hora, no horário de São Paulo (UTC-3, sem horário de verão)
  const celula = (iso) => {
    const d = new Date(Date.parse(iso) - 3 * 3600e3)
    return `${d.getUTCDay() || 7}-${d.getUTCHours()}`
  }
  const esperado = Object.fromEntries(['2026-09-08T15:00:00Z', '2026-09-09T14:00:00Z', '2026-09-10T18:00:00Z', '2026-09-12T01:30:00Z'].map((iso) => [celula(iso), 1]))
  assert.deepEqual(Object.fromEntries(p.ritmo.map((c) => [`${c.dia}-${c.hora}`, c.contatos])), esperado)
  // temperatura por etapa, dos leads não arquivados
  assert.deepEqual(Object.fromEntries(p.temperaturas.map((t) => [`${t.temperatura}/${t.status}`, t.leads])), {
    'quente/novo': 1,
    'null/contato': 1,
    'null/qualificado': 1,
    'null/ganho': 1,
    'null/perdido': 1,
  })
  assert.deepEqual(p.territorio, [
    { segmento: 'Logística', local_busca: 'Lapa', empresas: 1, leads: 1 },
    { segmento: 'Padaria', local_busca: 'Lapa', empresas: 1, leads: 0 },
    { segmento: 'Transportadora', local_busca: 'Lapa', empresas: 1, leads: 1 },
    { segmento: 'Transportadora', local_busca: 'Osasco', empresas: 1, leads: 1 },
  ])
  // das 3 empresas encontradas, 2 viraram lead, as 2 tiveram contato, 1 chegou a Qualificado e 1 foi ganha
  assert.deepEqual(p.garimpo, { empresas: 3, viraram_lead: 2, com_contato: 2, qualificados: 1, ganhos: 1 })
})

test('Painel: sem período escolhido vai desde o começo e não compara', async () => {
  const p = await painelComo(ANA, null, null)
  assert.equal(p.periodo.compara, false)
  assert.equal(p.anterior, null)
  assert.equal(p.atual.leads_novos, 5)
  assert.equal(p.atual.contatos, 6)
  // começa no registro mais antigo (a empresa de agosto): até uns 6 meses a série vai por semana, depois por mês
  const dias = (Date.now() - Date.parse('2026-08-01T12:00:00Z')) / 864e5
  assert.equal(p.periodo.unidade, dias <= 190 ? 'week' : 'month')
  assert.equal(p.periodo.de.slice(0, 10), '2026-08-01')
})

test('Painel: só quem abre a tela Painel recebe os números, mesmo sem abrir o Kanban; os outros recebem null', async () => {
  const b = await painelPronto()
  // Bruno é membro ativo, mas sem tela nenhuma: o administrador ainda não liberou o Painel para ele
  for (const fora of [BRUNO, CARLA, DANI]) assert.equal(await painelComo(fora, ...PERIODO), null)
  await b.query(`insert into public.membro_telas (user_id, tela) values ($1, 'painel'), ($2, 'painel')`, [BRUNO, DANI])
  try {
    // com só o Painel, ele vê os números de todos os leads, que a RLS não deixa ele ler direto
    assert.deepEqual((await painelComo(BRUNO, ...PERIODO)).atual, (await painelComo(ANA, ...PERIODO)).atual)
    await b.exec('set role authenticated')
    await b.query(`select set_config('request.jwt.claim.sub', $1, false)`, [BRUNO])
    assert.equal((await b.query('select id from public.leads')).rows.length, 0)
    await b.exec('reset role')
    // desativado não abre, nem com a tela marcada
    assert.equal(await painelComo(DANI, ...PERIODO), null)
  } finally {
    await b.exec('reset role')
    await b.query('delete from public.membro_telas where user_id in ($1, $2)', [BRUNO, DANI])
  }
  await b.exec('set role anon')
  try {
    await assert.rejects(b.query('select public.painel_gerencial(null, null)'), /permission denied/)
  } finally {
    await b.exec('reset role')
  }
})

test('Painel: lê as etapas do histórico que o trigger grava de verdade', async () => {
  const b = await painelPronto()
  const antes = new Date(Date.now() - 60_000).toISOString()
  await b.exec('set role authenticated')
  // a administradora abre todas as telas, então cria e move o lead pelo caminho normal, com RLS
  await b.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ANA])
  try {
    const [{ id }] = (await b.query(`insert into public.leads (nome) values ('Lead do Trigger') returning id`)).rows
    await b.query(`update public.leads set status = 'qualificado' where id = $1`, [id])
    await b.query(`update public.leads set status = 'ganho' where id = $1`, [id])
  } finally {
    await b.exec('reset role')
  }
  const p = await painelComo(ANA, antes, null)
  assert.deepEqual([p.atual.leads_novos, p.atual.avancos, p.atual.ganhos, p.atual.contatos], [1, 2, 1, 0])
  assert.deepEqual(porChave(p.funil.etapas, 'status', 'leads'), { novo: 1, contato: 1, qualificado: 1, proposta: 1, negociacao: 1, ganho: 1 })
})

// ---------- Google Maps no CRM online ----------
// a carga roda no SQL Editor (sem RLS): aqui ela entra direto, como dona das tabelas
const lugarMaps = (placeId, nome, extra = {}) => {
  const c = { place_id: placeId, segmento: 'Transportadora', servico: 'PCMSO', local_busca: 'Lapa, São Paulo - SP', nome, categoria: 'Serviço de transporte', endereco: 'R. A, 1 - Lapa, São Paulo - SP, 05075-000', telefone: '(11) 3333-4444', avaliacao: 4.5, latitude: -23.52, longitude: -46.7, ...extra }
  const cols = Object.keys(c)
  return db.query(
    `insert into public.maps_lugares (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})
     on conflict (place_id, segmento, local_busca) do update set nome = excluded.nome`,
    Object.values(c),
  )
}

test('Google Maps no CRM online: a equipe vê as empresas por local e segmento, e quais já estão no kanban', async () => {
  await lugarMaps('0xmaps1:0x1', 'Trans A')
  await lugarMaps('0xmaps2:0x2', 'Trans B')
  await novoLead(ANA, { nome: 'Trans A', place_id: '0xmaps1:0x1', origem: 'maps' })
  const grupos = await como(BRUNO, `select segmento, encontrados, enviados from public.maps_grupos where local_busca = 'Lapa, São Paulo - SP'`)
  assert.deepEqual(grupos, [{ segmento: 'Transportadora', encontrados: 2, enviados: 1 }])
  const empresas = await como(BRUNO, `select nome, enviado from public.maps_empresas where local_busca = 'Lapa, São Paulo - SP' order by nome`)
  assert.deepEqual(empresas, [
    { nome: 'Trans A', enviado: true },
    { nome: 'Trans B', enviado: false },
  ])
  for (const fora of [CARLA, DANI]) {
    assert.equal((await como(fora, 'select * from public.maps_empresas')).length, 0)
    assert.equal((await como(fora, 'select * from public.maps_grupos')).length, 0)
  }
})

// o que o site manda ao guardar uma busca do PC: upsert do PostgREST, que regrava todas as colunas enviadas
const guardarDaBusca = (uid, extra = {}) => {
  const c = { place_id: '0xbusca1:0x1', segmento: 'Veterinário', local_busca: 'Centro, Guarulhos', nome: 'Vet A', categoria: 'Veterinário', endereco: 'R. B, 2', telefone: '(11) 2222-3333', site: null, avaliacao: 4.9, total_avaliacoes: 247, latitude: -23.4, longitude: -46.5, link_maps: null, deleted_at: null, ...extra }
  const cols = Object.keys(c)
  return como(
    uid,
    `insert into public.maps_lugares (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})
     on conflict (place_id, segmento, local_busca) do update set ${cols.map((k) => `${k} = excluded.${k}`).join(', ')} returning nome`,
    Object.values(c),
  )
}
const daBusca = (uid) => como(uid, `select nome from public.maps_empresas where local_busca = 'Centro, Guarulhos' order by nome`)

test('Google Maps no CRM online: a equipe guarda o resultado de uma busca do PC e exclui a busca inteira', async () => {
  const inicio = new Date(Date.now() - 1000).toISOString() // a busca do PC terminou antes de ser guardada
  await guardarDaBusca(BRUNO)
  await guardarDaBusca(BRUNO, { place_id: '0xbusca2:0x2', nome: 'Vet B' })
  // a mesma busca de novo atualiza, sem duplicar
  await guardarDaBusca(ANA, { nome: 'Vet A (novo nome)' })
  assert.deepEqual(await daBusca(ANA), [{ nome: 'Vet A (novo nome)' }, { nome: 'Vet B' }])
  const [grupo] = await como(ANA, `select segmento, encontrados, ultima from public.maps_grupos where local_busca = 'Centro, Guarulhos'`)
  assert.equal(grupo.segmento, 'Veterinário')
  assert.equal(grupo.encontrados, 2)
  assert.ok(grupo.ultima instanceof Date)

  // excluir a busca é preencher deleted_at nas empresas dela; o lead que já foi para o kanban não é tocado
  const excluir = `update public.maps_lugares set deleted_at = now() where segmento = 'Veterinário' and local_busca = 'Centro, Guarulhos' and deleted_at is null returning id`
  assert.equal((await como(ANA, excluir)).length, 2)
  assert.deepEqual(await daBusca(BRUNO), [])
  // a busca excluída continua contando como guardada: o site não grava de novo a busca que o PC ainda mostra
  const jaGuardada = `select 1 from public.maps_lugares where segmento = 'Veterinário' and local_busca = 'Centro, Guarulhos' and updated_at >= $1 limit 1`
  assert.equal((await como(BRUNO, jaGuardada, [inicio])).length, 1)
  assert.equal((await como(BRUNO, jaGuardada, [new Date(Date.now() + 60_000).toISOString()])).length, 0)
  // repetir a busca traz a empresa de volta
  await guardarDaBusca(BRUNO)
  assert.deepEqual(await daBusca(ANA), [{ nome: 'Vet A' }])
})

test('Google Maps no CRM online: quem está fora da equipe não grava; ninguém apaga de verdade nem mexe nas datas', async () => {
  for (const fora of [CARLA, DANI]) {
    await assert.rejects(guardarDaBusca(fora, { place_id: '0xfora:0x1' }), /row-level security/)
    assert.equal((await como(fora, 'update public.maps_lugares set deleted_at = now() returning id')).length, 0)
  }
  await assert.rejects(como(ANA, 'delete from public.maps_lugares'), /permission denied/)
  await assert.rejects(como(ANA, 'update public.maps_lugares set created_at = now()'), /permission denied/)
  await assert.rejects(guardarDaBusca(ANA, { place_id: '0xinvalida:0x1', telefone: null }), /telefone/)
  await db.exec('set role anon')
  try {
    await assert.rejects(db.query('select * from public.maps_empresas'), /permission denied/)
    await assert.rejects(db.query(`insert into public.maps_lugares (place_id, segmento, local_busca, nome, endereco, telefone, avaliacao) values ('0xanon:0x1', 'S', 'L', 'N', 'E', 'T', 3)`), /permission denied/)
  } finally {
    await db.exec('reset role')
  }
})

test('Google Maps no CRM online: só entra empresa com endereço, telefone e nota, e a carga roda de novo sem duplicar', async () => {
  for (const falta of ['endereco', 'telefone', 'avaliacao']) await assert.rejects(lugarMaps(`0xmaps-${falta}:0x9`, 'Incompleta', { [falta]: null }), new RegExp(falta))
  await lugarMaps('0xmaps4:0x4', 'Primeira carga')
  await lugarMaps('0xmaps4:0x4', 'Segunda carga')
  assert.deepEqual((await db.query(`select nome from public.maps_lugares where place_id = '0xmaps4:0x4'`)).rows, [{ nome: 'Segunda carga' }])
})

// ---------- clientes ativos (nomes inventados: o repositório é público) ----------
const clientesAtivos = async (uid) => (await como(uid, 'select nome from public.clientes_ativos where deleted_at is null order by nome')).map((c) => c.nome)

test('Clientes ativos: a equipe vê, cadastra e tira; quem está fora não vê nem grava', async () => {
  await como(ANA, `insert into public.clientes_ativos (nome) values ('Metalúrgica Faísca Ltda')`)
  assert.deepEqual(await clientesAtivos(BRUNO), ['Metalúrgica Faísca Ltda'])
  const [{ id }] = await como(BRUNO, `insert into public.clientes_ativos (nome) values ('Padaria Trigo Fino') returning id`)
  assert.equal((await como(BRUNO, 'update public.clientes_ativos set deleted_at = now() where id = $1 returning id', [id])).length, 1)
  assert.deepEqual(await clientesAtivos(ANA), ['Metalúrgica Faísca Ltda'])
  for (const fora of [CARLA, DANI]) {
    assert.deepEqual(await clientesAtivos(fora), [])
    await assert.rejects(como(fora, `insert into public.clientes_ativos (nome) values ('intruso')`), /row-level security/)
    assert.equal((await como(fora, 'update public.clientes_ativos set deleted_at = now() returning id')).length, 0)
  }
  await assert.rejects(como(ANA, 'delete from public.clientes_ativos'), /permission denied/)
  await assert.rejects(como(ANA, 'update public.clientes_ativos set created_at = now()'), /permission denied/)
  await db.exec('set role anon')
  try {
    await assert.rejects(db.query('select * from public.clientes_ativos'), /permission denied/)
  } finally {
    await db.exec('reset role')
  }
})

test('Clientes ativos: o mesmo nome não entra duas vezes na lista, mas volta depois de tirado; a carga roda de novo sem duplicar', async () => {
  await como(ANA, `insert into public.clientes_ativos (nome) values ('Transportes Vento Sul Ltda')`)
  await assert.rejects(como(BRUNO, `insert into public.clientes_ativos (nome) values ('  transportes vento sul ltda ')`), /clientes_ativos_nome_unico/)
  await como(ANA, `update public.clientes_ativos set deleted_at = now() where nome = 'Transportes Vento Sul Ltda'`)
  await como(BRUNO, `insert into public.clientes_ativos (nome) values ('Transportes Vento Sul Ltda')`)
  assert.equal((await clientesAtivos(ANA)).filter((n) => n === 'Transportes Vento Sul Ltda').length, 1)
  const carga = `insert into public.clientes_ativos (nome) values ('Construtora Pedra Lisa Ltda'), ('Transportes Vento Sul Ltda')
    on conflict (lower(btrim(nome))) where deleted_at is null do nothing`
  await db.exec(carga)
  await db.exec(carga)
  assert.equal((await clientesAtivos(ANA)).filter((n) => n === 'Construtora Pedra Lisa Ltda').length, 1)
  await assert.rejects(como(ANA, `insert into public.clientes_ativos (nome) values ('   ')`), /check/)
})

// ---------- acessos: quais telas cada pessoa abre ----------
const minhasTelas = async (uid) => (await como(uid, 'select public.minhas_telas() as t'))[0].t

test('Acessos: cada membro abre só as telas liberadas; administrador abre todas, inclusive as que vierem depois', async () => {
  assert.deepEqual(await minhasTelas(ANA), [...TODAS, 'painel'])
  assert.deepEqual(await minhasTelas(BRUNO), TODAS)
  assert.deepEqual(await minhasTelas(EDU), ['prospeccao', 'buscas'])
  assert.deepEqual(await minhasTelas(FABI), ['kanban'])
  // fora da equipe e desativado (mesmo com telas liberadas) não abrem nada
  assert.deepEqual(await minhasTelas(CARLA), [])
  assert.deepEqual(await minhasTelas(DANI), [])
  await db.exec('set role anon')
  try {
    await assert.rejects(db.query('select public.minhas_telas()'), /permission denied/)
  } finally {
    await db.exec('reset role')
  }
})

test('Acessos: sem Kanban e sem Leads o banco não mostra os leads nem o histórico; quem prospecta manda para o kanban e vê só o que mandou', async () => {
  const daAna = await novoLead(ANA, { nome: 'Lead da Ana', place_id: '0xacesso1:0x1' })
  await como(ANA, `insert into public.atendimentos (lead_id, tipo, descricao) values ($1, 'ligacao', 'oi')`, [daAna.id])
  assert.equal((await como(EDU, 'select * from public.leads where id = $1', [daAna.id])).length, 0)
  assert.equal((await como(EDU, 'select * from public.leads_kanban where id = $1', [daAna.id])).length, 0)
  assert.equal((await como(EDU, 'select * from public.atendimentos where lead_id = $1', [daAna.id])).length, 0)
  assert.equal((await como(EDU, `update public.leads set nome = 'x' where id = $1 returning id`, [daAna.id])).length, 0)
  // o envio em lote da Prospecção e do Google Maps: o repetido o banco ignora, o novo volta para contar
  const lote = await como(EDU, `insert into public.leads (nome, place_id, origem) values ('Repetido', '0xacesso1:0x1', 'maps'), ('Novo do Edu', '0xacesso2:0x2', 'maps') on conflict (place_id) do nothing returning id, nome`)
  assert.deepEqual(lote.map((l) => l.nome), ['Novo do Edu'])
  assert.equal((await como(EDU, 'select * from public.leads where id = $1', [lote[0].id])).length, 1)
  // mas não trabalha o lead: editar e registrar atendimento são do Kanban e da aba Leads
  assert.equal((await como(EDU, `update public.leads set status = 'contato' where id = $1 returning id`, [lote[0].id])).length, 0)
  await assert.rejects(como(EDU, `insert into public.atendimentos (lead_id, tipo, descricao) values ($1, 'ligacao', 'oi')`, [lote[0].id]), /row-level security/)
  // quem só tem o Kanban trabalha os leads da equipe
  assert.equal((await como(FABI, `update public.leads set temperatura = 'quente' where id = $1 returning id`, [daAna.id])).length, 1)
  assert.equal((await como(FABI, 'select * from public.atendimentos where lead_id = $1', [daAna.id])).length, 1)
})

test('Acessos: Google Maps e Clientes ativos só abrem para quem tem a tela', async () => {
  await lugarMaps('0xacesso3:0x3', 'Empresa do mapa')
  await como(ANA, `insert into public.clientes_ativos (nome) values ('Cliente Acesso Ltda')`)
  // quem prospecta vê o mapa e a lista de clientes (para esconder quem já é cliente), mas não mexe na lista
  assert.ok((await como(EDU, 'select * from public.maps_empresas')).length > 0)
  assert.ok((await clientesAtivos(EDU)).includes('Cliente Acesso Ltda'))
  await assert.rejects(como(EDU, `insert into public.clientes_ativos (nome) values ('Outro')`), /row-level security/)
  assert.equal((await como(EDU, 'update public.clientes_ativos set deleted_at = now() returning id')).length, 0)
  // só com o Kanban, nem mapa nem clientes
  assert.equal((await como(FABI, 'select * from public.maps_lugares')).length, 0)
  assert.equal((await como(FABI, 'select * from public.maps_grupos')).length, 0)
  assert.deepEqual(await clientesAtivos(FABI), [])
})

test('Acessos: só quem abre o Google Maps guarda e exclui as buscas do PC no mapa', async () => {
  const local = { local_busca: 'Acesso, Osasco' }
  const excluir = `update public.maps_lugares set deleted_at = now() where local_busca = 'Acesso, Osasco' and deleted_at is null returning id`
  const ativas = async () => (await db.query(`select id from public.maps_lugares where local_busca = 'Acesso, Osasco' and deleted_at is null`)).rows.length
  assert.deepEqual(await guardarDaBusca(EDU, { ...local, place_id: '0xacesso4:0x4' }), [{ nome: 'Vet A' }])
  // só com o Kanban: não guarda nem exclui, nem com o comando que não lê nada de volta (esse não passa pela regra de leitura)
  await assert.rejects(como(FABI, `insert into public.maps_lugares (place_id, segmento, local_busca, nome, endereco, telefone, avaliacao) values ('0xacesso5:0x5', 'S', 'Acesso, Osasco', 'N', 'E', 'T', 3)`), /row-level security/)
  await assert.rejects(guardarDaBusca(FABI, { ...local, place_id: '0xacesso4:0x4', nome: 'Trocado' }), /row-level security/)
  await como(FABI, 'update public.maps_lugares set deleted_at = now()')
  assert.equal(await ativas(), 1)
  assert.equal((await como(FABI, excluir)).length, 0)
  assert.equal((await como(EDU, excluir)).length, 1)
  assert.equal(await ativas(), 0)
})

test('Acessos: só o administrador muda as telas de alguém; cada um vê só as próprias', async () => {
  // a tela Clientes ativos mostra o que cada cliente esconde no mapa: ela também lê as empresas do mapa
  await como(ANA, `insert into public.membro_telas (user_id, tela) values ($1, 'clientes')`, [FABI])
  assert.deepEqual(await minhasTelas(FABI), ['kanban', 'clientes'])
  assert.ok((await como(FABI, 'select * from public.maps_lugares')).length > 0)
  await como(FABI, `insert into public.clientes_ativos (nome) values ('Cliente da Fabi')`)
  await como(ANA, `delete from public.membro_telas where user_id = $1 and tela = 'clientes'`, [FABI])
  assert.deepEqual(await minhasTelas(FABI), ['kanban'])
  // membro não se dá tela nem tira a dos outros, e só enxerga as próprias
  await assert.rejects(como(EDU, `insert into public.membro_telas (user_id, tela) values ($1, 'kanban')`, [EDU]), /row-level security/)
  assert.equal((await como(EDU, 'delete from public.membro_telas where user_id = $1 returning tela', [BRUNO])).length, 0)
  assert.deepEqual((await como(EDU, 'select distinct user_id from public.membro_telas')).map((r) => r.user_id), [EDU])
  assert.equal((await como(ANA, 'select user_id, tela from public.membro_telas')).length, 2 * TODAS.length + 3)
  // a tela que não existe o banco recusa; e só quem é da equipe recebe tela
  await assert.rejects(como(ANA, `insert into public.membro_telas (user_id, tela) values ($1, 'financeiro')`, [FABI]), /invalid input value for enum/)
  await assert.rejects(como(ANA, `insert into public.membro_telas (user_id, tela) values ($1, 'kanban')`, [CARLA]), /foreign key/)
  await assert.rejects(como(ANA, `update public.membro_telas set tela = 'leads' where user_id = $1`, [FABI]), /permission denied/)
  await db.exec('set role anon')
  try {
    await assert.rejects(db.query('select * from public.membro_telas'), /permission denied/)
  } finally {
    await db.exec('reset role')
  }
})

test('Acessos: quem já era da equipe quando as telas chegaram continua abrindo tudo o que abria', async () => {
  const banco = new PGlite()
  await banco.exec(AUTH_SUPABASE)
  const acessos = ARQUIVOS.findIndex((n) => n.endsWith('_acessos.sql'))
  assert.ok(acessos > 0)
  await migrar(banco, ARQUIVOS.slice(0, acessos))
  await banco.query(`insert into auth.users values ($1, 'bruno@x.com')`, [BRUNO])
  await banco.query(`insert into public.membros (user_id, email, nome) values ($1, 'bruno@x.com', 'Bruno')`, [BRUNO])
  await migrar(banco, ARQUIVOS.slice(acessos))
  const telas = (await banco.query('select tela from public.membro_telas order by tela')).rows.map((r) => r.tela)
  // o Painel gerencial ainda não existia: fica para o administrador liberar
  assert.deepEqual(telas, TODAS)
})

test('Acessos: o script de volta do topo da migration devolve tudo a quem é da equipe', async () => {
  const banco = new PGlite()
  await banco.exec(AUTH_SUPABASE)
  await migrar(banco)
  await banco.query(`insert into auth.users values ($1, 'gil@x.com')`, [FABI])
  await banco.query(`insert into public.membros (user_id, email, nome) values ($1, 'gil@x.com', 'Gil')`, [FABI])
  const gravar = async (sql) => {
    await banco.exec('set role authenticated')
    await banco.query(`select set_config('request.jwt.claim.sub', $1, false)`, [FABI])
    try {
      return (await banco.query(sql)).rows
    } finally {
      await banco.exec('reset role')
    }
  }
  const lead = `insert into public.leads (nome) values ('Depois da volta') returning nome`
  const lugar = `insert into public.maps_lugares (place_id, segmento, local_busca, nome, endereco, telefone, avaliacao) values ('0xvolta:0x1', 'S', 'L', 'N', 'E', 'T', 3)`
  // sem tela nenhuma o banco recusa
  await assert.rejects(gravar(lead), /row-level security/)
  await assert.rejects(gravar(lugar), /row-level security/)
  const migration = readFileSync(new URL(ARQUIVOS.find((n) => n.endsWith('_acessos.sql')), MIGRATIONS), 'utf8')
  const volta = migration.split('\n').filter((l) => /^-- (drop|create) /.test(l)).map((l) => l.slice(3)).join('\n')
  await banco.exec(volta)
  assert.deepEqual(await gravar(lead), [{ nome: 'Depois da volta' }])
  await gravar(lugar)
  assert.equal((await banco.query(`select to_regclass('public.membro_telas') as t`)).rows[0].t, null)
})
