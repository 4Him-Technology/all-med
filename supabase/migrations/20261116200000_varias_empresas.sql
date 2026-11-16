-- Várias empresas, etapa 1: o banco (pedido do Filipe em 16/11/2026: "terá o módulo da All Med, Módulo da Empresa B e a
-- possibilidade de ser criado mais módulos. o admin deve ter acesso a todos. [...] cada empresa é totalmente independente").
-- Escolhas dele: cada membro é de uma empresa só; o administrador (papel admin) é o geral e entra em todas; não há
-- administrador por empresa; o mesmo site e o mesmo visual para todas; Painel de cada empresa, sem somar todas; empresa
-- nova é o administrador quem cria, pela tela (etapa 3).
-- - public.empresas: a All Med é a primeira, e tudo o que existe hoje passa a ser dela.
-- - empresa_id em leads, maps_lugares e clientes_ativos (o histórico de atendimentos segue o lead) e em membros.
-- - Os únicos passam a valer dentro de cada empresa: a mesma empresa prospectada pode ser lead na All Med e na Empresa B.
-- - Isolamento na RLS: além da tela, toda policy pede que a linha seja da empresa de quem está logado
--   (crm.minha_empresa()), ou que ele seja o administrador (crm.admin()). Não depende de filtro na tela.
-- - O Painel (security definer, não passa pela RLS) recebe a empresa (p_empresa) e confere o acesso dentro dele.
-- - Quem grava sem dizer a empresa usa crm.empresa_padrao(): a do membro; para o administrador, a carga no SQL Editor e a
--   função usuarios, a única empresa que existir. Assim o site, o PC e a função usuarios de hoje continuam funcionando
--   enquanto só existe a All Med. Com a segunda empresa, o administrador tem de dizer a empresa (etapas 2 a 4).
-- - O envio em lote e a gravação das buscas do site usam "on conflict" na chave única, que muda: public/crm.js muda junto.
-- A exclusão de registro do histórico (public.excluir_atendimento) não precisa mudar: só o administrador exclui, e ele
-- entra em todas as empresas.
--
-- Rollback, enquanto só existir a All Med (com outra empresa, os únicos de antes não voltam se houver repetidos entre elas):
--   1. copie as linhas abaixo sem o "-- " do começo e rode no SQL Editor;
--   2. rode de novo a função public.painel_gerencial da 20261112200000_painel_mais_cortes.sql (o bloco da função, até
--      $fn$;, e as duas linhas de revoke e grant logo depois dele);
--   3. reverta o PR no GitHub (o site volta a usar as chaves únicas de antes).
-- Testado em test/crm-sql.test.js.
-- drop function public.painel_gerencial(timestamptz, timestamptz, uuid);
-- drop view public.maps_grupos;
-- drop view public.maps_empresas;
-- drop view public.leads_kanban;
-- drop policy "membros: cada empresa vê a sua equipe" on public.membros;
-- drop policy "leads: lê quem é da empresa e abre a tela" on public.leads;
-- drop policy "leads: cria quem é da empresa e abre a tela" on public.leads;
-- drop policy "leads: altera quem é da empresa e abre a tela" on public.leads;
-- drop policy "atendimentos: lê quem é da empresa e abre a tela" on public.atendimentos;
-- drop policy "atendimentos: registra quem é da empresa e abre a tela" on public.atendimentos;
-- drop policy "maps_lugares: lê quem é da empresa e abre a tela" on public.maps_lugares;
-- drop policy "maps_lugares: guarda quem é da empresa e abre a tela" on public.maps_lugares;
-- drop policy "maps_lugares: atualiza e exclui quem é da empresa e abre a tela" on public.maps_lugares;
-- drop policy "clientes_ativos: lê quem é da empresa e abre a tela" on public.clientes_ativos;
-- drop policy "clientes_ativos: cadastra quem é da empresa e abre a tela" on public.clientes_ativos;
-- drop policy "clientes_ativos: altera quem é da empresa e abre a tela" on public.clientes_ativos;
-- alter table public.leads drop column empresa_id;
-- alter table public.maps_lugares drop column empresa_id;
-- alter table public.clientes_ativos drop column empresa_id;
-- alter table public.membros drop column empresa_id;
-- drop table public.empresas;
-- drop function crm.empresa_padrao();
-- drop function crm.minha_empresa();
-- alter table public.leads add constraint leads_cnpj_unico unique (cnpj), add constraint leads_place_id_unico unique (place_id);
-- create index leads_status_idx on public.leads (status, updated_at desc) where deleted_at is null;
-- create index leads_criacao_idx on public.leads (created_at desc) where deleted_at is null;
-- alter table public.maps_lugares add constraint maps_lugares_unico unique (place_id, segmento, local_busca);
-- create index maps_lugares_grupo_idx on public.maps_lugares (local_busca, segmento) where deleted_at is null;
-- create unique index clientes_ativos_nome_unico on public.clientes_ativos (lower(btrim(nome))) where deleted_at is null;
-- create view public.leads_kanban with (security_invoker = true) as select l.id, l.nome, l.categoria, l.telefone, l.temperatura, l.avaliacao, l.status, l.updated_at, (select max(a.data) from public.atendimentos a where a.lead_id = l.id and a.tipo <> 'status') as ultimo_atendimento, l.total_avaliacoes, l.origem, l.created_at from public.leads l where l.deleted_at is null;
-- create view public.maps_empresas with (security_invoker = true) as select m.id, m.place_id, m.segmento, m.servico, m.local_busca, m.nome, m.categoria, m.endereco, m.bairro, m.cidade, m.cep, m.telefone, m.site, m.avaliacao, m.total_avaliacoes, m.latitude, m.longitude, m.link_maps, exists (select 1 from public.leads l where l.place_id = m.place_id) as enviado, m.updated_at from public.maps_lugares m where m.deleted_at is null;
-- create view public.maps_grupos with (security_invoker = true) as select local_busca, segmento, count(*)::int as encontrados, (count(*) filter (where enviado))::int as enviados, max(updated_at) as ultima from public.maps_empresas group by local_busca, segmento;
-- revoke all on public.leads_kanban, public.maps_empresas, public.maps_grupos from anon, authenticated;
-- grant select on public.leads_kanban, public.maps_empresas, public.maps_grupos to authenticated;
-- create policy "membros: equipe vê a equipe" on public.membros for select to authenticated using ((select crm.membro_ativo()) or user_id = (select auth.uid()));
-- create policy "leads: lê quem abre a tela" on public.leads for select to authenticated using ((select crm.pode('kanban', 'leads')) or (user_id = (select auth.uid()) and (select crm.pode('prospeccao', 'buscas'))));
-- create policy "leads: cria quem abre a tela" on public.leads for insert to authenticated with check ((select crm.pode('kanban', 'leads', 'prospeccao', 'buscas')) and user_id = (select auth.uid()));
-- create policy "leads: altera quem abre a tela" on public.leads for update to authenticated using ((select crm.pode('kanban', 'leads')) and deleted_at is null) with check ((select crm.pode('kanban', 'leads')));
-- create policy "atendimentos: lê quem abre a tela" on public.atendimentos for select to authenticated using ((select crm.pode('kanban', 'leads')));
-- create policy "atendimentos: registra quem abre a tela" on public.atendimentos for insert to authenticated with check ((select crm.pode('kanban', 'leads')) and user_id = (select auth.uid()) and tipo <> 'status' and exists (select 1 from public.leads l where l.id = lead_id and l.deleted_at is null));
-- create policy "maps_lugares: lê quem abre a tela" on public.maps_lugares for select to authenticated using ((select crm.pode('buscas', 'clientes')));
-- create policy "maps_lugares: guarda quem abre a tela" on public.maps_lugares for insert to authenticated with check ((select crm.pode('buscas')));
-- create policy "maps_lugares: atualiza e exclui quem abre a tela" on public.maps_lugares for update to authenticated using ((select crm.pode('buscas'))) with check ((select crm.pode('buscas')));
-- create policy "clientes_ativos: lê quem abre a tela" on public.clientes_ativos for select to authenticated using ((select crm.pode('clientes', 'prospeccao', 'buscas')));
-- create policy "clientes_ativos: cadastra quem abre a tela" on public.clientes_ativos for insert to authenticated with check ((select crm.pode('clientes')));
-- create policy "clientes_ativos: altera quem abre a tela" on public.clientes_ativos for update to authenticated using ((select crm.pode('clientes'))) with check ((select crm.pode('clientes')));

-- ---------- empresas ----------
create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.empresas is 'Empresas atendidas pelo sistema (All Med, Empresa B...), independentes: cada uma com os seus leads, mapa, clientes e equipe.';

-- o mesmo nome (sem contar caixa e espaço nas pontas) não se repete entre as empresas que existem
create unique index empresas_nome_unico on public.empresas (lower(btrim(nome))) where deleted_at is null;

create trigger empresas_updated_at before update on public.empresas
  for each row execute function crm.set_updated_at();

-- tudo o que existe hoje é da All Med
insert into public.empresas (nome) values ('All Med');

-- ---------- membros: cada membro é de uma empresa ----------
-- RESTRICT: empresa não se apaga de verdade (deleted_at); o banco não deixa sumir a empresa de quem é dela
alter table public.membros add column empresa_id uuid references public.empresas (id) on delete restrict;
update public.membros set empresa_id = (select id from public.empresas);
-- o administrador entra em todas: a empresa da linha dele não decide nada e pode ficar vazia
alter table public.membros add constraint membros_membro_tem_empresa check (papel = 'admin' or empresa_id is not null);
-- chave estrangeira, e a equipe de cada empresa na policy de membros
create index membros_empresa_idx on public.membros (empresa_id);
grant select (empresa_id) on public.membros to authenticated;

-- security definer, como crm.membro_ativo(): as policies consultam membros e empresas sem depender da RLS delas.
-- A empresa de quem está logado: a do membro ativo, se ela não foi excluída. O administrador não tem uma: entra em todas.
create function crm.minha_empresa() returns uuid
language sql stable security definer set search_path = '' as $fn$
  select m.empresa_id
  from public.membros m join public.empresas e on e.id = m.empresa_id and e.deleted_at is null
  where m.user_id = (select auth.uid()) and m.ativo and m.papel = 'membro'
$fn$;
revoke all on function crm.minha_empresa() from public;
grant execute on function crm.minha_empresa() to authenticated;

-- A empresa de quem grava sem dizer qual: a do membro; para o administrador, a carga no SQL Editor e a função usuarios,
-- a única empresa que existir (com duas ou mais, nenhuma, e o banco recusa a linha sem empresa).
-- Sem revoke: a função usuarios grava em membros com a chave secreta, que não é authenticated, e esta função só devolve
-- a empresa de quem chama ou a única que existe.
create function crm.empresa_padrao() returns uuid
language sql stable security definer set search_path = '' as $fn$
  select coalesce(
    crm.minha_empresa(),
    (select e.id from public.empresas e where e.deleted_at is null and (select count(*) from public.empresas where deleted_at is null) = 1)
  )
$fn$;
alter table public.membros alter column empresa_id set default crm.empresa_padrao();

-- ---------- dono de cada dado ----------
-- A coluna nasce com a All Med em todas as linhas: o padrão é calculado uma vez, agora (a única empresa), sem regravar
-- as linhas nem disparar o trigger de updated_at, pelo qual o kanban e as buscas feitas se ordenam.
-- RESTRICT: empresa não se apaga de verdade (deleted_at); o banco não deixa sumir a empresa de quem tem dados.
-- O histórico de atendimentos não tem coluna própria: é da empresa do lead.
alter table public.leads add column empresa_id uuid not null default crm.empresa_padrao() references public.empresas (id) on delete restrict;
alter table public.maps_lugares add column empresa_id uuid not null default crm.empresa_padrao() references public.empresas (id) on delete restrict;
alter table public.clientes_ativos add column empresa_id uuid not null default crm.empresa_padrao() references public.empresas (id) on delete restrict;

-- Os únicos passam a valer dentro de cada empresa: a mesma empresa prospectada pode ser lead na All Med e na Empresa B,
-- e o mesmo cliente pode estar nas duas listas. Começam por empresa_id e também servem às chaves estrangeiras.
alter table public.leads drop constraint leads_cnpj_unico, drop constraint leads_place_id_unico,
  add constraint leads_cnpj_unico unique (empresa_id, cnpj), add constraint leads_place_id_unico unique (empresa_id, place_id);
alter table public.maps_lugares drop constraint maps_lugares_unico,
  add constraint maps_lugares_unico unique (empresa_id, place_id, segmento, local_busca);
drop index public.clientes_ativos_nome_unico;
create unique index clientes_ativos_nome_unico on public.clientes_ativos (empresa_id, lower(btrim(nome))) where deleted_at is null;

-- o kanban, a lista de leads e as buscas feitas passam a ser de uma empresa: os índices começam por ela
drop index public.leads_status_idx, public.leads_criacao_idx, public.maps_lugares_grupo_idx;
create index leads_status_idx on public.leads (empresa_id, status, updated_at desc) where deleted_at is null;
create index leads_criacao_idx on public.leads (empresa_id, created_at desc) where deleted_at is null;
create index maps_lugares_grupo_idx on public.maps_lugares (empresa_id, local_busca, segmento) where deleted_at is null;

-- Quem grava pode dizer a empresa (o administrador, com duas ou mais, tem de dizer); a policy confere se ela é de quem
-- grava. Lead e cliente não mudam de empresa. No mapa, o upsert do PostgREST regrava as colunas que envia, inclusive as
-- da chave única, por isso o update de empresa_id; a policy também confere a empresa nova.
grant insert (empresa_id) on public.leads, public.maps_lugares, public.clientes_ativos to authenticated;
grant update (empresa_id) on public.maps_lugares to authenticated;

-- ---------- empresas: cada um lê a sua; só o administrador vê todas, cria, renomeia e exclui (deleted_at) ----------
revoke all on public.empresas from anon, authenticated;
grant select on public.empresas to authenticated;
grant insert (nome) on public.empresas to authenticated;
grant update (nome, deleted_at) on public.empresas to authenticated;
alter table public.empresas enable row level security;
-- o administrador vê também as excluídas, para trazer de volta
create policy "empresas: administrador vê todas, membro a dele" on public.empresas
  for select to authenticated using ((select crm.admin()) or id = (select crm.minha_empresa()));
create policy "empresas: administrador cria" on public.empresas
  for insert to authenticated with check ((select crm.admin()));
create policy "empresas: administrador altera" on public.empresas
  for update to authenticated using ((select crm.admin())) with check ((select crm.admin()));
-- sem policy nem grant de DELETE: empresa se exclui com deleted_at

-- ---------- isolamento: além da tela, a linha tem de ser da empresa de quem está logado (o administrador entra em todas) ----------
-- Os nomes das policies mudam de propósito: um script antigo que tente trocá-las pelo nome falha, em vez de tirar o isolamento.
-- O (select ...) faz o Postgres calcular a empresa e o papel uma vez por consulta, não uma vez por linha.
drop policy "membros: equipe vê a equipe" on public.membros;
create policy "membros: cada empresa vê a sua equipe" on public.membros
  for select to authenticated
  using ((select crm.admin()) or user_id = (select auth.uid()) or empresa_id = (select crm.minha_empresa()));

drop policy "leads: lê quem abre a tela" on public.leads;
drop policy "leads: cria quem abre a tela" on public.leads;
drop policy "leads: altera quem abre a tela" on public.leads;
create policy "leads: lê quem é da empresa e abre a tela" on public.leads
  for select to authenticated
  using (((select crm.admin()) or empresa_id = (select crm.minha_empresa()))
         and ((select crm.pode('kanban', 'leads')) or (user_id = (select auth.uid()) and (select crm.pode('prospeccao', 'buscas')))));
create policy "leads: cria quem é da empresa e abre a tela" on public.leads
  for insert to authenticated
  with check (((select crm.admin()) or empresa_id = (select crm.minha_empresa()))
              and (select crm.pode('kanban', 'leads', 'prospeccao', 'buscas')) and user_id = (select auth.uid()));
create policy "leads: altera quem é da empresa e abre a tela" on public.leads
  for update to authenticated
  using (((select crm.admin()) or empresa_id = (select crm.minha_empresa())) and (select crm.pode('kanban', 'leads')) and deleted_at is null)
  with check (((select crm.admin()) or empresa_id = (select crm.minha_empresa())) and (select crm.pode('kanban', 'leads')));

-- o histórico é da empresa do lead
drop policy "atendimentos: lê quem abre a tela" on public.atendimentos;
drop policy "atendimentos: registra quem abre a tela" on public.atendimentos;
create policy "atendimentos: lê quem é da empresa e abre a tela" on public.atendimentos
  for select to authenticated
  using ((select crm.pode('kanban', 'leads'))
         and exists (select 1 from public.leads l where l.id = lead_id and ((select crm.admin()) or l.empresa_id = (select crm.minha_empresa()))));
create policy "atendimentos: registra quem é da empresa e abre a tela" on public.atendimentos
  for insert to authenticated
  with check (
    (select crm.pode('kanban', 'leads'))
    and user_id = (select auth.uid())
    and tipo <> 'status'
    and exists (select 1 from public.leads l where l.id = lead_id and l.deleted_at is null
                and ((select crm.admin()) or l.empresa_id = (select crm.minha_empresa())))
  );

drop policy "maps_lugares: lê quem abre a tela" on public.maps_lugares;
drop policy "maps_lugares: guarda quem abre a tela" on public.maps_lugares;
drop policy "maps_lugares: atualiza e exclui quem abre a tela" on public.maps_lugares;
create policy "maps_lugares: lê quem é da empresa e abre a tela" on public.maps_lugares
  for select to authenticated
  using (((select crm.admin()) or empresa_id = (select crm.minha_empresa())) and (select crm.pode('buscas', 'clientes')));
create policy "maps_lugares: guarda quem é da empresa e abre a tela" on public.maps_lugares
  for insert to authenticated
  with check (((select crm.admin()) or empresa_id = (select crm.minha_empresa())) and (select crm.pode('buscas')));
create policy "maps_lugares: atualiza e exclui quem é da empresa e abre a tela" on public.maps_lugares
  for update to authenticated
  using (((select crm.admin()) or empresa_id = (select crm.minha_empresa())) and (select crm.pode('buscas')))
  with check (((select crm.admin()) or empresa_id = (select crm.minha_empresa())) and (select crm.pode('buscas')));

drop policy "clientes_ativos: lê quem abre a tela" on public.clientes_ativos;
drop policy "clientes_ativos: cadastra quem abre a tela" on public.clientes_ativos;
drop policy "clientes_ativos: altera quem abre a tela" on public.clientes_ativos;
create policy "clientes_ativos: lê quem é da empresa e abre a tela" on public.clientes_ativos
  for select to authenticated
  using (((select crm.admin()) or empresa_id = (select crm.minha_empresa())) and (select crm.pode('clientes', 'prospeccao', 'buscas')));
create policy "clientes_ativos: cadastra quem é da empresa e abre a tela" on public.clientes_ativos
  for insert to authenticated
  with check (((select crm.admin()) or empresa_id = (select crm.minha_empresa())) and (select crm.pode('clientes')));
create policy "clientes_ativos: altera quem é da empresa e abre a tela" on public.clientes_ativos
  for update to authenticated
  using (((select crm.admin()) or empresa_id = (select crm.minha_empresa())) and (select crm.pode('clientes')))
  with check (((select crm.admin()) or empresa_id = (select crm.minha_empresa())) and (select crm.pode('clientes')));

-- ---------- views: a empresa de cada linha, e "no kanban" só pelos leads da mesma empresa ----------
-- colunas novas entram no fim: create or replace mantém as que já existem e os grants das views;
-- security_invoker mantém a RLS das tabelas valendo para quem consulta
create or replace view public.leads_kanban with (security_invoker = true) as
  select l.id, l.nome, l.categoria, l.telefone, l.temperatura, l.avaliacao, l.status, l.updated_at,
    (select max(a.data) from public.atendimentos a where a.lead_id = l.id and a.tipo <> 'status') as ultimo_atendimento,
    l.total_avaliacoes, l.origem, l.created_at, l.empresa_id
  from public.leads l
  where l.deleted_at is null;

create or replace view public.maps_empresas with (security_invoker = true) as
  select m.id, m.place_id, m.segmento, m.servico, m.local_busca, m.nome, m.categoria, m.endereco, m.bairro, m.cidade, m.cep,
         m.telefone, m.site, m.avaliacao, m.total_avaliacoes, m.latitude, m.longitude, m.link_maps,
         -- para o administrador, que lê as duas empresas, um lead da All Med não marca o lugar da Empresa B
         exists (select 1 from public.leads l where l.empresa_id = m.empresa_id and l.place_id = m.place_id) as enviado,
         m.updated_at, m.empresa_id
  from public.maps_lugares m
  where m.deleted_at is null;

create or replace view public.maps_grupos with (security_invoker = true) as
  select local_busca, segmento, count(*)::int as encontrados, (count(*) filter (where enviado))::int as enviados, max(updated_at) as ultima, empresa_id
  from public.maps_empresas
  group by empresa_id, local_busca, segmento;

-- ---------- Painel de cada empresa ----------
-- A mesma função, com a empresa no fim (p_empresa): sem ela, a de quem está logado (para o administrador, a única que
-- existir), e o site de hoje, que chama com dois parâmetros, continua funcionando. Ela roda como dona das tabelas e não
-- passa pela RLS: lê só as linhas da empresa (lds, ats, mls, cls) e confere o acesso no fim. Daí para baixo, as contas
-- são as mesmas da 20261112200000_painel_mais_cortes.sql.
drop function public.painel_gerencial(timestamptz, timestamptz);
create function public.painel_gerencial(p_de timestamptz default null, p_ate timestamptz default null, p_empresa uuid default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $fn$
with
-- a empresa do Painel: a pedida ou, sem ela, a de quem está logado
alvo as (select coalesce(p_empresa, crm.empresa_padrao()) as id),
-- só as linhas dessa empresa; o histórico é o dos leads dela
lds as (select * from public.leads where empresa_id = (select id from alvo)),
ats as (select * from public.atendimentos where lead_id in (select id from lds)),
mls as (select * from public.maps_lugares where empresa_id = (select id from alvo)),
cls as (select * from public.clientes_ativos where empresa_id = (select id from alvo)),
fim as (select coalesce(p_ate, now()) as ate),
per as (
  select de, ate, p_de is not null as compara,
    case when ate - de <= interval '31 days' then 'day' when ate - de <= interval '190 days' then 'week' else 'month' end as unidade
  from (
    select f.ate, least(f.ate, coalesce(p_de,
      least((select min(created_at) from lds where deleted_at is null),
            (select min(data) from ats),
            (select min(created_at) from mls where deleted_at is null)),
      f.ate - interval '30 days')) as de
    from fim f
  ) x
),
janelas as (
  select 'atual' as qual, de, ate from per
  union all
  select 'anterior', de - (ate - de), de - interval '1 microsecond' from per where compara
),
ls as (select id, nome, status, temperatura, origem, place_id, created_at from lds where deleted_at is null),
contatos as (select lead_id, data, tipo from ats where tipo <> 'status'),
-- ordem de cada etapa no funil (perdido fica de fora: é saída, não etapa)
etapa as (
  select e.status, e.ordem::int
  from unnest(array['novo', 'contato', 'qualificado', 'proposta', 'negociacao', 'ganho']::public.lead_status[]) with ordinality e(status, ordem)
),
mudancas as (
  select a.lead_id, a.data,
    (select s from unnest(enum_range(null::public.lead_status)) s where crm.rotulo_status(s) = m.p[1]) as de_status,
    (select s from unnest(enum_range(null::public.lead_status)) s where crm.rotulo_status(s) = m.p[2]) as para_status
  from ats a
  cross join lateral regexp_match(a.descricao, '^Status alterado de (.+) para (.+)$') as m(p)
  where a.tipo = 'status' and m.p is not null and a.lead_id in (select id from ls)
),
-- cada etapa por onde o lead passou e quando: a de entrada (o "de" da primeira mudança, ou a atual) e cada mudança
visitas as (
  select l.id as lead_id, l.created_at as quando,
    coalesce((select m.de_status from mudancas m where m.lead_id = l.id order by m.data limit 1), l.status) as status, 0 as seq
  from ls l
  union all
  select lead_id, data, para_status, 1 from mudancas
),
alcance as (
  select v.lead_id, coalesce(max(e.ordem), 1) as ordem
  from visitas v left join etapa e on e.status = v.status
  group by v.lead_id
),
-- quando o lead entrou na etapa em que está hoje (só Ganho e Perdido interessam)
desfecho as (
  select l.id, l.status, (select max(v.quando) from visitas v where v.lead_id = l.id and v.status = l.status) as quando
  from ls l where l.status in ('ganho', 'perdido')
),
-- cada passagem por uma etapa: quando entrou e quando saiu (saiu nulo: é a etapa em que o lead está hoje);
-- seq desempata a entrada do lead e uma mudança no mesmo instante
estadias as (
  select v.lead_id, v.status, v.quando as entrou,
    lead(v.quando) over (partition by v.lead_id order by v.quando, v.seq) as saiu
  from visitas v
),
numeros as (
  select j.qual, jsonb_build_object(
    'contatos', (select count(*) from contatos c where c.data between j.de and j.ate),
    'leads_novos', (select count(*) from ls where ls.created_at between j.de and j.ate),
    'avancos', (select count(*) from mudancas m join etapa d on d.status = m.de_status join etapa p on p.status = m.para_status
                where m.data between j.de and j.ate and p.ordem > d.ordem),
    'ganhos', (select count(*) from desfecho d where d.status = 'ganho' and d.quando between j.de and j.ate),
    'perdidos', (select count(*) from desfecho d where d.status = 'perdido' and d.quando between j.de and j.ate),
    'empresas_novas', (select count(distinct m.place_id) from mls m where m.deleted_at is null and m.created_at between j.de and j.ate),
    'arquivados', (select count(*) from lds l where l.deleted_at between j.de and j.ate),
    'dias_com_contato', (select count(distinct (c.data at time zone 'America/Sao_Paulo')::date) from contatos c where c.data between j.de and j.ate)
  ) as n
  from janelas j
),
-- os leads que entraram no período: funil, origem e tempo até o primeiro contato
coorte as (
  select l.id, l.status, l.origem, a.ordem,
    extract(epoch from (select min(c.data) from contatos c where c.lead_id = l.id) - l.created_at) / 3600 as horas
  from ls l join alcance a on a.lead_id = l.id, per
  where l.created_at between per.de and per.ate
),
baldes as (
  select b as inicio
  from per, generate_series(date_trunc(per.unidade, per.de at time zone 'America/Sao_Paulo'),
                            date_trunc(per.unidade, per.ate at time zone 'America/Sao_Paulo'), ('1 ' || per.unidade)::interval) b
),
eventos as (
  select 'contatos' as o_que, c.data as quando from contatos c
  union all select 'leads', ls.created_at from ls
  union all select 'ganhos', d.quando from desfecho d where d.status = 'ganho'
),
por_balde as (
  select date_trunc(per.unidade, e.quando at time zone 'America/Sao_Paulo') as inicio, e.o_que, count(*) as n
  from eventos e, per where e.quando between per.de and per.ate
  group by 1, 2
),
-- leads em andamento hoje, contados desde o último contato (ou desde que entraram)
andamento as (
  select l.id, l.nome, l.status, l.temperatura, u.ultimo is null as nunca,
    floor(extract(epoch from now() - coalesce(u.ultimo, l.created_at)) / 86400)::int as dias
  from ls l
  left join lateral (select max(c.data) as ultimo from contatos c where c.lead_id = l.id) u on true
  where l.status not in ('ganho', 'perdido')
),
-- o que aconteceu com cada lugar do Google Maps que virou lead (não arquivado): teve contato, até onde chegou, se foi ganho
lugar_lead as (
  select ls.place_id, bool_or(c.lead_id is not null) as com_contato, max(a.ordem) as ordem, bool_or(ls.status = 'ganho') as ganho
  from ls
  join alcance a on a.lead_id = ls.id
  left join (select distinct lead_id from contatos) c on c.lead_id = ls.id
  where ls.place_id is not null
  group by ls.place_id
),
lugares as (
  select m.segmento, m.local_busca, m.place_id,
    exists (select 1 from lds l where l.place_id = m.place_id) as virou_lead,
    coalesce(ll.ganho, false) as ganho, coalesce(ll.com_contato, false) as com_contato, coalesce(ll.ordem, 0) >= 3 as qualificado
  from mls m
  left join lugar_lead ll on ll.place_id = m.place_id
  where m.deleted_at is null
)
select jsonb_build_object(
  'periodo', (select jsonb_build_object('de', de, 'ate', ate, 'unidade', unidade, 'compara', compara) from per),
  'atual', (select n from numeros where qual = 'atual'),
  'anterior', (select n from numeros where qual = 'anterior'),
  'primeiro_contato', (
    select jsonb_build_object('leads', count(*), 'com_contato', count(horas), 'sem_contato', count(*) - count(horas),
      'mediana_horas', round((percentile_cont(0.5) within group (order by case when horas < 0 then 0 else horas end))::numeric, 1))
    from coorte),
  'funil', jsonb_build_object(
    'etapas', (select jsonb_agg(jsonb_build_object('status', e.status, 'leads', (select count(*) from coorte c where c.ordem >= e.ordem)) order by e.ordem) from etapa e),
    'perdidos', (select count(*) from coorte where status = 'perdido'),
    'em_aberto', (select count(*) from coorte where status not in ('ganho', 'perdido'))),
  'origens', coalesce((
    select jsonb_agg(jsonb_build_object('origem', origem, 'leads', leads, 'com_contato', com_contato, 'qualificados', qualificados, 'ganhos', ganhos, 'perdidos', perdidos) order by leads desc, origem)
    from (select origem, count(*) as leads, count(horas) as com_contato, count(*) filter (where ordem >= 3) as qualificados,
                 count(*) filter (where status = 'ganho') as ganhos,
                 count(*) filter (where status = 'perdido') as perdidos
          from coorte group by origem) o), '[]'),
  'tipos', coalesce((
    select jsonb_agg(jsonb_build_object('tipo', tipo, 'total', total) order by total desc, tipo)
    from (select c.tipo, count(*) as total from contatos c, per where c.data between per.de and per.ate group by c.tipo) t), '[]'),
  'serie', (
    select jsonb_agg(jsonb_build_object('inicio', to_char(b.inicio, 'YYYY-MM-DD'),
      'contatos', coalesce((select n from por_balde p where p.inicio = b.inicio and p.o_que = 'contatos'), 0),
      'leads', coalesce((select n from por_balde p where p.inicio = b.inicio and p.o_que = 'leads'), 0),
      'ganhos', coalesce((select n from por_balde p where p.inicio = b.inicio and p.o_que = 'ganhos'), 0)) order by b.inicio)
    from baldes b),
  'hoje', jsonb_build_object(
    'etapas', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'leads', leads) order by status)
                        from (select status, count(*) as leads from ls group by status) s), '[]'),
    'temperatura', coalesce((select jsonb_agg(jsonb_build_object('temperatura', temperatura, 'leads', leads) order by temperatura nulls last)
                             from (select temperatura, count(*) as leads from andamento group by temperatura) t), '[]'),
    'parados', jsonb_build_object(
      'faixas', (select jsonb_build_object('ate_7', count(*) filter (where dias <= 7), 'de_8_a_14', count(*) filter (where dias between 8 and 14),
                                           'de_15_a_30', count(*) filter (where dias between 15 and 30), 'mais_de_30', count(*) filter (where dias > 30))
                 from andamento),
      'lista', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'status', status, 'temperatura', temperatura, 'dias', dias, 'nunca', nunca) order by dias desc, nome)
                         from (select * from andamento where dias > 7 order by dias desc, nome limit 10) a), '[]')),
    'clientes_ativos', (select count(*) from cls where deleted_at is null),
    'arquivados', (select count(*) from lds where deleted_at is not null),
    'empresas', (select count(distinct place_id) from lugares),
    'empresas_lead', (select count(distinct place_id) filter (where virou_lead) from lugares)),
  -- todos os leads não arquivados, de qualquer data: quantos chegaram pelo menos até cada etapa
  'pipeline', (select jsonb_agg(jsonb_build_object('status', e.status, 'chegaram', (select count(*) from alcance a where a.ordem >= e.ordem)) order by e.ordem) from etapa e),
  -- tempo em cada etapa: passagens que terminaram no período e, hoje, quem está nela e há quanto tempo
  'tempo_etapas', (
    select jsonb_agg(jsonb_build_object(
      'status', e.status,
      'saidas', (select count(*) from estadias s, per where s.status = e.status and s.saiu between per.de and per.ate),
      'mediana_dias', (select round((percentile_cont(0.5) within group (order by extract(epoch from s.saiu - s.entrou) / 86400))::numeric, 1)
                       from estadias s, per where s.status = e.status and s.saiu between per.de and per.ate),
      'agora', (select count(*) from estadias s join ls on ls.id = s.lead_id where s.saiu is null and s.status = e.status and ls.status = e.status),
      'mediana_agora_dias', (select round((percentile_cont(0.5) within group (order by extract(epoch from now() - s.entrou) / 86400))::numeric, 1)
                             from estadias s join ls on ls.id = s.lead_id where s.saiu is null and s.status = e.status and ls.status = e.status)
    ) order by e.ordem)
    from etapa e where e.status <> 'ganho'),
  -- os ganhos do período: dias desde que o lead entrou e quantos contatos ele teve até ser ganho
  'ciclo', (
    select jsonb_build_object('ganhos', count(*),
      'mediana_dias', round((percentile_cont(0.5) within group (order by extract(epoch from d.quando - l.created_at) / 86400))::numeric, 1),
      'mediana_contatos', round((percentile_cont(0.5) within group (order by (select count(*) from contatos c where c.lead_id = d.id and c.data <= d.quando)))::numeric, 1))
    from desfecho d join ls l on l.id = d.id, per
    where d.status = 'ganho' and d.quando between per.de and per.ate),
  -- contatos do período por dia da semana (1 = segunda, 7 = domingo) e hora, no horário de São Paulo
  'ritmo', coalesce((
    select jsonb_agg(jsonb_build_object('dia', dia, 'hora', hora, 'contatos', n) order by dia, hora)
    from (select extract(isodow from c.data at time zone 'America/Sao_Paulo')::int as dia,
                 extract(hour from c.data at time zone 'America/Sao_Paulo')::int as hora, count(*) as n
          from contatos c, per where c.data between per.de and per.ate group by 1, 2) r), '[]'),
  -- leads não arquivados por temperatura e etapa
  'temperaturas', coalesce((
    select jsonb_agg(jsonb_build_object('temperatura', temperatura, 'status', status, 'leads', leads) order by temperatura nulls last, status)
    from (select temperatura, status, count(*) as leads from ls group by 1, 2) t), '[]'),
  -- empresas do Google Maps por segmento e local da busca, e quantas viraram lead
  'territorio', coalesce((
    select jsonb_agg(jsonb_build_object('segmento', segmento, 'local_busca', local_busca, 'empresas', empresas, 'leads', leads) order by segmento, local_busca)
    from (select segmento, local_busca, count(distinct place_id) as empresas, count(distinct place_id) filter (where virou_lead) as leads
          from lugares group by 1, 2) t), '[]'),
  -- do Google Maps ao ganho: encontradas, viraram lead, tiveram contato, chegaram a Qualificado e foram ganhas
  'garimpo', (
    select jsonb_build_object('empresas', count(distinct place_id), 'viraram_lead', count(distinct place_id) filter (where virou_lead),
      'com_contato', count(distinct place_id) filter (where com_contato), 'qualificados', count(distinct place_id) filter (where qualificado),
      'ganhos', count(distinct place_id) filter (where ganho))
    from lugares),
  'segmentos', coalesce((
    select jsonb_agg(jsonb_build_object('segmento', segmento, 'empresas', empresas, 'leads', leads, 'ganhos', ganhos) order by leads desc, empresas desc, segmento)
    from (select segmento, count(distinct place_id) as empresas, count(distinct place_id) filter (where virou_lead) as leads,
                 count(distinct place_id) filter (where ganho) as ganhos
          from lugares group by segmento) s), '[]'),
  'regioes', coalesce((
    select jsonb_agg(jsonb_build_object('local_busca', local_busca, 'empresas', empresas, 'leads', leads, 'ganhos', ganhos) order by leads desc, empresas desc, local_busca)
    from (select local_busca, count(distinct place_id) as empresas, count(distinct place_id) filter (where virou_lead) as leads,
                 count(distinct place_id) filter (where ganho) as ganhos
          from lugares group by local_busca) r), '[]')
)
-- o Painel é de cada empresa: abre para o membro ativo dela e para o administrador; os outros recebem null
where (select id from alvo) is not null and ((select crm.admin()) or (select id from alvo) = (select crm.minha_empresa()))
$fn$;

comment on function public.painel_gerencial(timestamptz, timestamptz, uuid) is
  'Números da aba Painel de uma empresa no período [p_de, p_ate] (sem p_de: desde o começo; sem p_ate: agora; sem p_empresa: a de quem está logado). Para o membro ativo da empresa e para o administrador; os outros recebem null.';

-- No Supabase as funções novas em public já nascem liberadas para anon: tira de todos e devolve só para quem está logado
revoke all on function public.painel_gerencial(timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.painel_gerencial(timestamptz, timestamptz, uuid) to authenticated;
