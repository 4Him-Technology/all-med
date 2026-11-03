// Roda a migration do CRM (supabase/migrations) num Postgres em memória com o esquema auth simulado como no Supabase
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url)
const ANA = '11111111-1111-4111-8111-111111111111'
const BRUNO = '22222222-2222-4222-8222-222222222222'
let db

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `)
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'))
  await db.query('insert into auth.users values ($1), ($2)', [ANA, BRUNO])
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

test('cada usuário vê só os próprios leads', async () => {
  const l = await novoLead(ANA, { nome: 'Clínica da Ana' })
  assert.equal(l.user_id, ANA)
  assert.equal(l.status, 'novo')
  assert.equal(l.origem, 'manual')
  assert.equal((await como(BRUNO, 'select * from public.leads where id = $1', [l.id])).length, 0)
  assert.equal((await como(BRUNO, `update public.leads set nome = 'roubado' where id = $1 returning id`, [l.id])).length, 0)
})

test('não dá para criar lead em nome de outro nem trocar o dono', async () => {
  await assert.rejects(como(ANA, `insert into public.leads (nome, user_id) values ('x', $1)`, [BRUNO]), /permission denied|row-level security/)
  const l = await novoLead(ANA)
  await assert.rejects(como(ANA, 'update public.leads set user_id = $1 where id = $2', [BRUNO, l.id]), /permission denied/)
  await assert.rejects(como(ANA, `update public.leads set created_at = now() where id = $1`, [l.id]), /permission denied/)
})

test('lead não é apagado de verdade; arquivar é preencher deleted_at', async () => {
  const l = await novoLead(ANA)
  await assert.rejects(como(ANA, 'delete from public.leads where id = $1', [l.id]), /permission denied/)
  await como(ANA, 'update public.leads set deleted_at = now() where id = $1', [l.id])
  assert.equal((await como(ANA, 'select * from public.leads_kanban where id = $1', [l.id])).length, 0)
  // arquivado não é mais editável
  assert.equal((await como(ANA, `update public.leads set nome = 'volta' where id = $1 returning id`, [l.id])).length, 0)
})

test('mudança de status entra sozinha no histórico, só quando muda', async () => {
  const l = await novoLead(ANA)
  await como(ANA, `update public.leads set status = 'proposta' where id = $1`, [l.id])
  await como(ANA, `update public.leads set status = 'proposta', observacoes = 'x' where id = $1`, [l.id])
  const h = await como(ANA, 'select tipo, descricao from public.atendimentos where lead_id = $1', [l.id])
  assert.deepEqual(h, [{ tipo: 'status', descricao: 'Status alterado de Novo para Proposta' }])
  const [atual] = await como(ANA, 'select created_at, updated_at from public.leads where id = $1', [l.id])
  assert.ok(atual.updated_at > atual.created_at)
})

test('atendimento manual só no próprio lead e nunca forjando mudança de status', async () => {
  const l = await novoLead(ANA)
  const [a] = await como(ANA, `insert into public.atendimentos (lead_id, tipo, descricao) values ($1, 'ligacao', 'Falei com a dona') returning *`, [l.id])
  assert.equal(a.user_id, ANA)
  await assert.rejects(como(ANA, `insert into public.atendimentos (lead_id, tipo, descricao) values ($1, 'status', 'forjado')`, [l.id]), /row-level security/)
  await assert.rejects(como(BRUNO, `insert into public.atendimentos (lead_id, tipo, descricao) values ($1, 'ligacao', 'intruso')`, [l.id]), /row-level security/)
  await assert.rejects(como(ANA, `update public.atendimentos set descricao = 'editado' where id = $1`, [a.id]), /permission denied/)
  await assert.rejects(como(ANA, 'delete from public.atendimentos where id = $1', [a.id]), /permission denied/)
})

test('a mesma empresa não entra duas vezes para o mesmo usuário, mas outro usuário pode ter', async () => {
  await novoLead(ANA, { nome: 'A', cnpj: '11111111000101', origem: 'receita' })
  await assert.rejects(novoLead(ANA, { nome: 'A de novo', cnpj: '11111111000101' }), (err) => err.code === '23505')
  assert.equal((await novoLead(BRUNO, { nome: 'A', cnpj: '11111111000101' })).user_id, BRUNO)
  // importação do Maps ignora o que já existe
  await novoLead(ANA, { nome: 'P', place_id: 'ChIJ1' })
  const r = await como(ANA, `insert into public.leads (nome, place_id) values ('P', 'ChIJ1'), ('Q', 'ChIJ2') on conflict (user_id, place_id) do nothing returning nome`)
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
  } finally {
    await db.exec('reset role')
  }
})

test('kanban traz o último contato sem contar mudança de status', async () => {
  const l = await novoLead(BRUNO, { nome: 'Kanban do Bruno' })
  await como(BRUNO, `insert into public.atendimentos (lead_id, tipo, descricao, data) values ($1, 'whatsapp', 'oi', '2026-10-01T10:00:00Z')`, [l.id])
  await como(BRUNO, `update public.leads set status = 'contato' where id = $1`, [l.id])
  const [k] = await como(BRUNO, 'select status, ultimo_atendimento from public.leads_kanban where id = $1', [l.id])
  assert.equal(k.status, 'contato')
  assert.equal(new Date(k.ultimo_atendimento).toISOString(), '2026-10-01T10:00:00.000Z')
  assert.equal((await como(ANA, 'select * from public.leads_kanban where id = $1', [l.id])).length, 0)
})

test('lista de leads ordena pelo último contato e o envio em lote por CNPJ ignora os repetidos', async () => {
  const a = await novoLead(ANA, { nome: 'Lista A', cnpj: '33333333000101', origem: 'receita' })
  await como(ANA, `insert into public.atendimentos (lead_id, tipo, descricao, data) values ($1, 'ligacao', 'oi', '2026-10-02T10:00:00Z')`, [a.id])
  const lote = await como(ANA, `insert into public.leads (nome, cnpj, origem) values ('Lista A de novo', '33333333000101', 'receita'), ('Lista B', '44444444000101', 'receita') on conflict (user_id, cnpj) do nothing returning nome`)
  assert.deepEqual(lote.map((l) => l.nome), ['Lista B'])
  const lista = await como(ANA, `select nome, origem, created_at, total_avaliacoes from public.leads_kanban where nome like 'Lista %' order by ultimo_atendimento asc nulls first`)
  assert.deepEqual(lista.map((l) => l.nome), ['Lista B', 'Lista A'])
  assert.ok(lista.every((l) => l.created_at && l.origem === 'receita'))
})
