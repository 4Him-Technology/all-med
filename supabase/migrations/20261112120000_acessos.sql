-- Acessos por tela (pedido do Filipe em 12/11/2026): o administrador escolhe quais telas cada pessoa abre.
-- Administrador abre todas. A tela some do site, e o banco também recusa: as policies das tabelas de cada tela
-- passam a pedir crm.pode('<tela>') em vez de só crm.membro_ativo(). A API do PC confere a mesma lista
-- (public.minhas_telas) antes de abrir a base de CNPJ (Prospecção) e as buscas do Google (Google Maps).
-- Quem já era da equipe recebe as cinco telas de hoje: nada muda até o administrador tirar alguma.
--
-- Que tabela cada tela abre:
--   leads e atendimentos     Kanban ou Leads (ler, editar, registrar atendimento)
--   leads (criar)            Kanban, Leads, Prospecção ou Google Maps; quem só prospecta vê apenas os leads que ele criou
--   maps_lugares (ler)       Google Maps, e Clientes ativos (a coluna "Escondidas no mapa")
--   maps_lugares (gravar)    Google Maps (guardar e excluir as buscas do PC); roda depois de 20261112110000_maps_buscas_do_pc.sql
--   clientes_ativos (ler)    Clientes ativos, Prospecção e Google Maps (é o que esconde quem já é cliente)
--   clientes_ativos (gravar) Clientes ativos
--
-- Rollback (volta a "todo membro ativo abre tudo"): copie as linhas abaixo sem o "-- " do começo e rode no SQL Editor.
-- Testado em test/crm-sql.test.js. Se alguma tela nova (como o Painel gerencial) já usa crm.pode, desfaça ela antes.
-- drop policy "leads: lê quem abre a tela" on public.leads;
-- drop policy "leads: cria quem abre a tela" on public.leads;
-- drop policy "leads: altera quem abre a tela" on public.leads;
-- drop policy "atendimentos: lê quem abre a tela" on public.atendimentos;
-- drop policy "atendimentos: registra quem abre a tela" on public.atendimentos;
-- drop policy "maps_lugares: lê quem abre a tela" on public.maps_lugares;
-- drop policy "maps_lugares: guarda quem abre a tela" on public.maps_lugares;
-- drop policy "maps_lugares: atualiza e exclui quem abre a tela" on public.maps_lugares;
-- drop policy "clientes_ativos: lê quem abre a tela" on public.clientes_ativos;
-- drop policy "clientes_ativos: cadastra quem abre a tela" on public.clientes_ativos;
-- drop policy "clientes_ativos: altera quem abre a tela" on public.clientes_ativos;
-- create policy "leads: equipe lê" on public.leads for select to authenticated using ((select crm.membro_ativo()));
-- create policy "leads: equipe cria" on public.leads for insert to authenticated with check ((select crm.membro_ativo()) and user_id = (select auth.uid()));
-- create policy "leads: equipe altera os ativos" on public.leads for update to authenticated using ((select crm.membro_ativo()) and deleted_at is null) with check ((select crm.membro_ativo()));
-- create policy "atendimentos: equipe lê" on public.atendimentos for select to authenticated using ((select crm.membro_ativo()));
-- create policy "atendimentos: equipe registra" on public.atendimentos for insert to authenticated with check ((select crm.membro_ativo()) and user_id = (select auth.uid()) and tipo <> 'status' and exists (select 1 from public.leads l where l.id = lead_id and l.deleted_at is null));
-- create policy "maps_lugares: equipe lê" on public.maps_lugares for select to authenticated using ((select crm.membro_ativo()));
-- create policy "maps_lugares: equipe guarda" on public.maps_lugares for insert to authenticated with check ((select crm.membro_ativo()));
-- create policy "maps_lugares: equipe atualiza e exclui" on public.maps_lugares for update to authenticated using ((select crm.membro_ativo())) with check ((select crm.membro_ativo()));
-- create policy "clientes_ativos: equipe lê" on public.clientes_ativos for select to authenticated using ((select crm.membro_ativo()));
-- create policy "clientes_ativos: equipe cadastra" on public.clientes_ativos for insert to authenticated with check ((select crm.membro_ativo()));
-- create policy "clientes_ativos: equipe altera" on public.clientes_ativos for update to authenticated using ((select crm.membro_ativo())) with check ((select crm.membro_ativo()));
-- drop function public.minhas_telas();
-- drop table public.membro_telas;
-- drop function crm.pode(public.tela[]);
-- drop function crm.admin();
-- drop type public.tela;

-- 'painel' é o Painel gerencial, que ainda vai ser criado: já existe aqui para a tela nova só usar crm.pode('painel').
-- Tela nova depois dessa: alter type public.tela add value '<tela>'.
create type public.tela as enum ('kanban', 'leads', 'prospeccao', 'buscas', 'clientes', 'painel');

create table public.membro_telas (
  -- CASCADE: a permissão é da pessoa e não tem valor sozinha; some se o membro um dia for apagado
  user_id uuid not null references public.membros (user_id) on delete cascade,
  tela public.tela not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a mesma tela entra uma vez por pessoa; a chave começa por user_id e também serve à chave estrangeira
  primary key (user_id, tela)
);
comment on table public.membro_telas is 'Telas que cada membro abre, escolhidas pelo administrador. Administrador abre todas sem precisar de linha aqui.';

create trigger membro_telas_updated_at before update on public.membro_telas
  for each row execute function crm.set_updated_at();

-- quem já era da equipe continua abrindo o que abria (o Painel gerencial fica para o administrador liberar)
insert into public.membro_telas (user_id, tela)
  select m.user_id, t.tela from public.membros m
  cross join unnest(array['kanban', 'leads', 'prospeccao', 'buscas', 'clientes']::public.tela[]) as t (tela);

-- security definer, como crm.membro_ativo(): as policies consultam membros e membro_telas sem depender da RLS delas
create function crm.admin() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.membros where user_id = (select auth.uid()) and ativo and papel = 'admin')
$fn$;

-- verdadeiro se a pessoa logada é membro ativo e abre ao menos uma das telas (administrador abre todas)
create function crm.pode(variadic telas public.tela[]) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.membros m
    where m.user_id = (select auth.uid()) and m.ativo
      and (m.papel = 'admin' or exists (select 1 from public.membro_telas t where t.user_id = m.user_id and t.tela = any (telas)))
  )
$fn$;

revoke all on function crm.admin(), crm.pode(public.tela[]) from public;
grant execute on function crm.admin(), crm.pode(public.tela[]) to authenticated;

-- a lista que o site usa para mostrar as abas e que a API do PC confere; o banco confere de novo em cada tabela
create function public.minhas_telas() returns text[]
language sql stable set search_path = '' as $fn$
  select coalesce(array_agg(t::text order by t), '{}') from unnest(enum_range(null::public.tela)) as t where crm.pode(t)
$fn$;
-- no Supabase a função nova em public já nasce liberada para anon: tira e devolve só para quem está logado
revoke all on function public.minhas_telas() from public, anon, authenticated;
grant execute on function public.minhas_telas() to authenticated;

-- ---------- membro_telas: só o administrador grava ----------
-- liberar é inserir a linha; tirar é apagar (é permissão, não histórico). UPDATE não é concedido.
revoke all on public.membro_telas from anon, authenticated;
grant select (user_id, tela) on public.membro_telas to authenticated;
grant insert (user_id, tela) on public.membro_telas to authenticated;
grant delete on public.membro_telas to authenticated;
alter table public.membro_telas enable row level security;
create policy "membro_telas: admin vê todas, cada um as suas" on public.membro_telas
  for select to authenticated using ((select crm.admin()) or user_id = (select auth.uid()));
create policy "membro_telas: admin libera" on public.membro_telas
  for insert to authenticated with check ((select crm.admin()));
create policy "membro_telas: admin tira" on public.membro_telas
  for delete to authenticated using ((select crm.admin()));

-- ---------- leads e atendimentos: Kanban e Leads ----------
drop policy "leads: equipe lê" on public.leads;
drop policy "leads: equipe cria" on public.leads;
drop policy "leads: equipe altera os ativos" on public.leads;
drop policy "atendimentos: equipe lê" on public.atendimentos;
drop policy "atendimentos: equipe registra" on public.atendimentos;

-- quem só prospecta vê o lead que ele mesmo mandou: é o que o envio em lote lê de volta para contar os novos
create policy "leads: lê quem abre a tela" on public.leads
  for select to authenticated
  using ((select crm.pode('kanban', 'leads')) or (user_id = (select auth.uid()) and (select crm.pode('prospeccao', 'buscas'))));
-- Novo lead (Kanban e Leads) e o envio ao kanban (Prospecção e Google Maps); user_id é sempre quem criou
create policy "leads: cria quem abre a tela" on public.leads
  for insert to authenticated
  with check ((select crm.pode('kanban', 'leads', 'prospeccao', 'buscas')) and user_id = (select auth.uid()));
create policy "leads: altera quem abre a tela" on public.leads
  for update to authenticated
  using ((select crm.pode('kanban', 'leads')) and deleted_at is null) with check ((select crm.pode('kanban', 'leads')));

create policy "atendimentos: lê quem abre a tela" on public.atendimentos
  for select to authenticated using ((select crm.pode('kanban', 'leads')));
create policy "atendimentos: registra quem abre a tela" on public.atendimentos
  for insert to authenticated
  with check (
    (select crm.pode('kanban', 'leads'))
    and user_id = (select auth.uid())
    and tipo <> 'status'
    and exists (select 1 from public.leads l where l.id = lead_id and l.deleted_at is null)
  );

-- ---------- empresas do Google Maps ----------
-- guardar e excluir as buscas do PC (20261112110000_maps_buscas_do_pc.sql) é da tela Google Maps
drop policy "maps_lugares: equipe lê" on public.maps_lugares;
drop policy "maps_lugares: equipe guarda" on public.maps_lugares;
drop policy "maps_lugares: equipe atualiza e exclui" on public.maps_lugares;
create policy "maps_lugares: lê quem abre a tela" on public.maps_lugares
  for select to authenticated using ((select crm.pode('buscas', 'clientes')));
create policy "maps_lugares: guarda quem abre a tela" on public.maps_lugares
  for insert to authenticated with check ((select crm.pode('buscas')));
create policy "maps_lugares: atualiza e exclui quem abre a tela" on public.maps_lugares
  for update to authenticated using ((select crm.pode('buscas'))) with check ((select crm.pode('buscas')));

-- ---------- clientes ativos ----------
drop policy "clientes_ativos: equipe lê" on public.clientes_ativos;
drop policy "clientes_ativos: equipe cadastra" on public.clientes_ativos;
drop policy "clientes_ativos: equipe altera" on public.clientes_ativos;
create policy "clientes_ativos: lê quem abre a tela" on public.clientes_ativos
  for select to authenticated using ((select crm.pode('clientes', 'prospeccao', 'buscas')));
create policy "clientes_ativos: cadastra quem abre a tela" on public.clientes_ativos
  for insert to authenticated with check ((select crm.pode('clientes')));
create policy "clientes_ativos: altera quem abre a tela" on public.clientes_ativos
  for update to authenticated using ((select crm.pode('clientes'))) with check ((select crm.pode('clientes')));
