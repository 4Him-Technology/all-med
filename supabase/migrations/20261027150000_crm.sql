-- CRM online (Supabase): leads, histórico de atendimentos e kanban.
-- Cada usuário só vê e altera o que é dele (RLS). Padrão: negar tudo e liberar só o necessário.
-- A base de CNPJ não fica aqui: ela roda no PC com Docker (db-local/) e só manda as empresas escolhidas.
--
-- Rollback: drop view public.leads_kanban; drop table public.atendimentos, public.leads;
--           drop type public.atendimento_tipo, public.lead_origem, public.lead_temperatura, public.lead_status;
--           drop schema crm cascade;

create schema crm;
revoke all on schema crm from public;
-- só para o Postgres conseguir checar as constraints e triggers ao gravar; o esquema crm não é exposto pela API
grant usage on schema crm to authenticated;

create type public.lead_status as enum ('novo', 'contato', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido');
create type public.lead_temperatura as enum ('quente', 'morno', 'frio');
create type public.lead_origem as enum ('manual', 'receita', 'maps');
create type public.atendimento_tipo as enum ('ligacao', 'whatsapp', 'email', 'reuniao', 'visita', 'outro', 'status');

create function crm.emails_validos(lista text[]) returns boolean
language sql immutable set search_path = '' as $fn$
  select coalesce(bool_and(e ~ '^[^[:space:]@,]+@[^[:space:]@,]+\.[^[:space:]@,]+$' and char_length(e) <= 200), true)
  from unnest(lista) e
$fn$;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  -- apagar a conta apaga os leads dela: não existe outro dono para herdar
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 200),
  categoria text check (char_length(categoria) <= 200),
  endereco text check (char_length(endereco) <= 500),
  telefone text check (char_length(telefone) <= 50),                -- sensível: dado pessoal quando é empresário individual
  site text check (site ~* '^https?://' and char_length(site) <= 500),
  emails text[] not null default '{}' check (cardinality(emails) <= 20 and crm.emails_validos(emails)), -- sensível (idem)
  observacoes text check (char_length(observacoes) <= 5000),
  status public.lead_status not null default 'novo',
  temperatura public.lead_temperatura,
  avaliacao numeric(2, 1) check (avaliacao between 0 and 5),
  total_avaliacoes integer check (total_avaliacoes >= 0),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  link_maps text check (link_maps ~* '^https?://' and char_length(link_maps) <= 1000),
  place_id text check (char_length(place_id) <= 300),
  cnpj char(14) check (cnpj ~ '^[0-9]{14}$'),
  origem public.lead_origem not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- a mesma empresa não entra duas vezes para o mesmo usuário, nem depois de arquivada.
  -- Estes índices únicos começam por user_id, então também servem à chave estrangeira.
  constraint leads_cnpj_unico unique (user_id, cnpj),
  constraint leads_place_id_unico unique (user_id, place_id)
);

-- kanban e filtro por status dos leads ativos do usuário
create index leads_usuario_status_idx on public.leads (user_id, status, updated_at desc) where deleted_at is null;
-- lista de leads, mais novos primeiro
create index leads_usuario_criacao_idx on public.leads (user_id, created_at desc) where deleted_at is null;

create table public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  -- o histórico acompanha o lead: some junto se um dia o lead for apagado de verdade
  lead_id uuid not null references public.leads (id) on delete cascade,
  -- apagar a conta apaga o histórico dela
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo public.atendimento_tipo not null,
  descricao text not null check (char_length(btrim(descricao)) between 1 and 5000),
  data timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Sem deleted_at: o histórico é imutável (nenhum UPDATE ou DELETE liberado), então não há o que restaurar.

-- histórico do lead em ordem e cálculo do último contato
create index atendimentos_lead_data_idx on public.atendimentos (lead_id, data desc);
-- chave estrangeira para auth.users
create index atendimentos_usuario_idx on public.atendimentos (user_id);

create function crm.set_updated_at() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

create trigger leads_updated_at before update on public.leads
  for each row execute function crm.set_updated_at();
create trigger atendimentos_updated_at before update on public.atendimentos
  for each row execute function crm.set_updated_at();

create function crm.rotulo_status(s public.lead_status) returns text
language sql immutable set search_path = '' as $fn$
  select case s
    when 'novo' then 'Novo' when 'contato' then 'Em contato' when 'qualificado' then 'Qualificado'
    when 'proposta' then 'Proposta' when 'negociacao' then 'Negociação' when 'ganho' then 'Ganho'
    when 'perdido' then 'Perdido' end
$fn$;

-- security definer: o usuário não pode gravar atendimento do tipo "status" (seria forjar histórico),
-- então quem grava é esta função, como dona da tabela
create function crm.registrar_mudanca_status() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if new.status is distinct from old.status then
    insert into public.atendimentos (lead_id, user_id, tipo, descricao)
    values (new.id, new.user_id, 'status',
            format('Status alterado de %s para %s', crm.rotulo_status(old.status), crm.rotulo_status(new.status)));
  end if;
  return new;
end
$fn$;

create trigger leads_historico_status after update of status on public.leads
  for each row execute function crm.registrar_mudanca_status();

revoke all on all functions in schema crm from public;
grant execute on function crm.emails_validos(text[]) to authenticated;

create view public.leads_kanban with (security_invoker = true) as
  select l.id, l.nome, l.categoria, l.telefone, l.temperatura, l.avaliacao, l.status, l.updated_at,
    (select max(a.data) from public.atendimentos a where a.lead_id = l.id and a.tipo <> 'status') as ultimo_atendimento
  from public.leads l
  where l.deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Permissões. No Supabase as tabelas novas em public já nascem liberadas para anon e authenticated,
-- então primeiro tira tudo e depois devolve só o necessário, coluna por coluna (allowlist contra mass assignment).
-- ---------------------------------------------------------------------------------------------
revoke all on public.leads, public.atendimentos, public.leads_kanban from anon, authenticated;

grant select on public.leads, public.atendimentos, public.leads_kanban to authenticated;
grant insert (nome, categoria, endereco, telefone, site, emails, observacoes, status, temperatura,
              avaliacao, total_avaliacoes, latitude, longitude, link_maps, place_id, cnpj, origem)
  on public.leads to authenticated;
-- dono, origem, CNPJ e datas não mudam depois de criados
grant update (nome, categoria, endereco, telefone, site, emails, observacoes, status, temperatura, deleted_at)
  on public.leads to authenticated;
grant insert (lead_id, tipo, descricao, data) on public.atendimentos to authenticated;
-- DELETE não é concedido em nenhuma tabela: arquivar um lead é preencher deleted_at

alter table public.leads enable row level security;
alter table public.atendimentos enable row level security;

-- anon não tem policy nenhuma: não lê nem grava
create policy "leads: dono lê" on public.leads
  for select to authenticated using (user_id = (select auth.uid()));
create policy "leads: dono cria" on public.leads
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "leads: dono altera os ativos" on public.leads
  for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()));
-- leads: sem policy de DELETE (negado)

create policy "atendimentos: dono lê" on public.atendimentos
  for select to authenticated using (user_id = (select auth.uid()));
create policy "atendimentos: dono registra no próprio lead" on public.atendimentos
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and tipo <> 'status'
    and exists (select 1 from public.leads l where l.id = lead_id and l.user_id = (select auth.uid()) and l.deleted_at is null)
  );
-- atendimentos: sem policy de UPDATE nem DELETE (negado, histórico imutável)
