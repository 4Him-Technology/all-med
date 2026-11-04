-- Equipe: todo membro ativo vê e trabalha os mesmos leads e o mesmo kanban (pedido do Filipe em 03/11/2026).
-- Quem entra na equipe é cadastrado pela função "usuarios" (supabase/functions/usuarios), só por um admin;
-- o app não grava em membros. Quem tem conta mas não é membro ativo não vê nada.
--
-- Rollback (volta ao "cada um vê só o que é seu"):
--   drop policy "leads: equipe lê" on public.leads; drop policy "leads: equipe cria" on public.leads;
--   drop policy "leads: equipe altera os ativos" on public.leads;
--   drop policy "atendimentos: equipe lê" on public.atendimentos; drop policy "atendimentos: equipe registra" on public.atendimentos;
--   recriar as policies "dono" e as constraints (user_id, cnpj) e (user_id, place_id) da migration 20261027150000_crm.sql;
--   drop table public.membros; drop type public.membro_papel; drop function crm.membro_ativo();

create type public.membro_papel as enum ('admin', 'membro');

create table public.membros (
  -- membro sem conta não existe; a função nunca apaga a conta, só desativa (e a conta de quem criou lead não apaga)
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (char_length(email) <= 200),               -- sensível: dado pessoal
  nome text not null check (char_length(btrim(nome)) between 1 and 100), -- sensível: dado pessoal
  papel public.membro_papel not null default 'membro',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger membros_updated_at before update on public.membros
  for each row execute function crm.set_updated_at();

-- quem já tinha conta antes da equipe existir (o dono do sistema) entra como admin
insert into public.membros (user_id, email, nome, papel)
  select id, coalesce(email, ''), coalesce(nullif(split_part(email, '@', 1), ''), 'Admin'), 'admin' from auth.users;

-- security definer: as policies consultam membros sem depender da RLS da própria membros (e sem recursão)
create function crm.membro_ativo() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.membros where user_id = (select auth.uid()) and ativo)
$fn$;
revoke all on function crm.membro_ativo() from public;
grant execute on function crm.membro_ativo() to authenticated;

-- ---------- membros: o app só lê ----------
revoke all on public.membros from anon, authenticated;
grant select (user_id, email, nome, papel, ativo, created_at) on public.membros to authenticated;
alter table public.membros enable row level security;
-- o desativado ainda lê a própria linha, para a tela explicar por que está sem acesso
create policy "membros: equipe vê a equipe" on public.membros
  for select to authenticated using ((select crm.membro_ativo()) or user_id = (select auth.uid()));
-- sem policy de INSERT, UPDATE ou DELETE: só a função "usuarios", com a chave secreta, mexe aqui

-- ---------- leads e atendimentos da equipe ----------
drop policy "leads: dono lê" on public.leads;
drop policy "leads: dono cria" on public.leads;
drop policy "leads: dono altera os ativos" on public.leads;
drop policy "atendimentos: dono lê" on public.atendimentos;
drop policy "atendimentos: dono registra no próprio lead" on public.atendimentos;

create policy "leads: equipe lê" on public.leads
  for select to authenticated using ((select crm.membro_ativo()));
-- user_id é quem criou: sempre o próprio usuário
create policy "leads: equipe cria" on public.leads
  for insert to authenticated with check ((select crm.membro_ativo()) and user_id = (select auth.uid()));
create policy "leads: equipe altera os ativos" on public.leads
  for update to authenticated using ((select crm.membro_ativo()) and deleted_at is null) with check ((select crm.membro_ativo()));

create policy "atendimentos: equipe lê" on public.atendimentos
  for select to authenticated using ((select crm.membro_ativo()));
create policy "atendimentos: equipe registra" on public.atendimentos
  for insert to authenticated
  with check (
    (select crm.membro_ativo())
    and user_id = (select auth.uid())
    and tipo <> 'status'
    and exists (select 1 from public.leads l where l.id = lead_id and l.deleted_at is null)
  );

-- a mesma empresa (CNPJ ou lugar do Maps) entra uma vez na equipe, não mais uma vez por usuário
alter table public.leads drop constraint leads_cnpj_unico, drop constraint leads_place_id_unico;
alter table public.leads add constraint leads_cnpj_unico unique (cnpj), add constraint leads_place_id_unico unique (place_id);

-- os índices começavam por user_id porque cada um via só os seus; agora o kanban e a lista são da equipe toda
drop index public.leads_usuario_status_idx, public.leads_usuario_criacao_idx;
-- kanban e filtro por etapa dos leads ativos
create index leads_status_idx on public.leads (status, updated_at desc) where deleted_at is null;
-- lista de leads, mais novos primeiro
create index leads_criacao_idx on public.leads (created_at desc) where deleted_at is null;
-- chave estrangeira para auth.users (antes coberta pelos índices únicos que começavam por user_id)
create index leads_usuario_idx on public.leads (user_id);

-- RESTRICT: com a equipe, apagar a conta de quem criou um lead ou registrou um atendimento apagaria o trabalho de todos;
-- para tirar alguém, desativa-se o membro
alter table public.leads drop constraint leads_user_id_fkey,
  add constraint leads_user_id_fkey foreign key (user_id) references auth.users (id) on delete restrict;
alter table public.atendimentos drop constraint atendimentos_user_id_fkey,
  add constraint atendimentos_user_id_fkey foreign key (user_id) references auth.users (id) on delete restrict;

-- a mudança de etapa fica no histórico em nome de quem mudou (antes era sempre o dono do lead)
create or replace function crm.registrar_mudanca_status() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if new.status is distinct from old.status then
    insert into public.atendimentos (lead_id, user_id, tipo, descricao)
    values (new.id, coalesce((select auth.uid()), new.user_id), 'status',
            format('Status alterado de %s para %s', crm.rotulo_status(old.status), crm.rotulo_status(new.status)));
  end if;
  return new;
end
$fn$;
