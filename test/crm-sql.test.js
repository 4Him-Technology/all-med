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
let db

const AUTH_SUPABASE = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`
const migrar = async (banco) => {
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) await banco.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'))
}

before(async () => {
  db = new PGlite()
  await db.exec(AUTH_SUPABASE)
  await migrar(db)
  for (const [id, email] of [[ANA, 'ana@x.com'], [BRUNO, 'bruno@x.com'], [CARLA, 'carla@x.com'], [DANI, 'dani@x.com']]) await db.query('insert into auth.users values ($1, $2)', [id, email])
  await db.query(
    `insert into public.membros (user_id, email, nome, papel, ativo) values
      ($1, 'ana@x.com', 'Ana', 'admin', true), ($2, 'bruno@x.com', 'Bruno', 'membro', true), ($3, 'dani@x.com', 'Dani', 'membro', false)`,
    [ANA, BRUNO, DANI],
  )
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
  assert.deepEqual(nomes, ['Ana', 'Bruno', 'Dani'])
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

test('Google Maps no CRM online: o app só lê; quem grava é a carga', async () => {
  await assert.rejects(como(ANA, `insert into public.maps_lugares (place_id, segmento, local_busca, nome, endereco, telefone, avaliacao) values ('0xmaps3:0x3', 'S', 'L', 'N', 'E', 'T', 3)`), /permission denied/)
  await assert.rejects(como(ANA, `update public.maps_lugares set nome = 'x'`), /permission denied/)
  await assert.rejects(como(ANA, 'delete from public.maps_lugares'), /permission denied/)
  await db.exec('set role anon')
  try {
    await assert.rejects(db.query('select * from public.maps_empresas'), /permission denied/)
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
