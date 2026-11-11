-- Empresas do Google Maps guardadas no CRM online (pedido do Filipe em 10/11/2026): a aba Google Maps abre estas
-- empresas em qualquer computador, sem o PC. Cada linha é uma empresa achada numa busca, que se identifica pelo
-- local da busca (cidade/bairro) e pelo segmento. Só entra empresa com endereço, telefone e nota do Google.
-- A equipe só lê; quem grava é a carga, rodada no SQL Editor. Mandar para o kanban continua sendo criar o lead.
--
-- Rollback: drop view public.maps_grupos, public.maps_empresas; drop table public.maps_lugares;

create table public.maps_lugares (
  id uuid primary key default gen_random_uuid(),
  place_id text not null check (char_length(place_id) between 1 and 300),
  segmento text not null check (char_length(btrim(segmento)) between 1 and 100),
  servico text check (char_length(servico) <= 200),
  local_busca text not null check (char_length(btrim(local_busca)) between 1 and 200),
  nome text not null check (char_length(btrim(nome)) between 1 and 200),
  categoria text check (char_length(categoria) <= 200),
  endereco text not null check (char_length(btrim(endereco)) between 1 and 500),
  bairro text check (char_length(bairro) <= 200),
  cidade text check (char_length(cidade) <= 200),
  cep text check (cep ~ '^[0-9]{5}-?[0-9]{3}$'),
  telefone text not null check (char_length(btrim(telefone)) between 1 and 50), -- sensível: dado pessoal quando é empresário individual
  site text check (site ~* '^https?://' and char_length(site) <= 500),
  avaliacao numeric(2, 1) not null check (avaliacao between 0 and 5),
  total_avaliacoes integer check (total_avaliacoes >= 0),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  link_maps text check (link_maps ~* '^https?://' and char_length(link_maps) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- a mesma empresa entra uma vez em cada busca, e a carga pode rodar de novo sem duplicar.
  -- O índice começa por place_id, que é por onde a view cruza com os leads.
  constraint maps_lugares_unico unique (place_id, segmento, local_busca)
);

-- os cartões da tela agrupam e abrem por local da busca e segmento, só com as empresas ativas
create index maps_lugares_grupo_idx on public.maps_lugares (local_busca, segmento) where deleted_at is null;

create trigger maps_lugares_updated_at before update on public.maps_lugares
  for each row execute function crm.set_updated_at();

-- security_invoker: quem consulta as views passa pela RLS das tabelas, inclusive a dos leads
create view public.maps_empresas with (security_invoker = true) as
  select m.id, m.place_id, m.segmento, m.servico, m.local_busca, m.nome, m.categoria, m.endereco, m.bairro, m.cidade, m.cep,
         m.telefone, m.site, m.avaliacao, m.total_avaliacoes, m.latitude, m.longitude, m.link_maps,
         -- já virou lead (mesmo arquivado, que o banco também não deixa entrar de novo)
         exists (select 1 from public.leads l where l.place_id = m.place_id) as enviado
  from public.maps_lugares m
  where m.deleted_at is null;

create view public.maps_grupos with (security_invoker = true) as
  select local_busca, segmento, count(*)::int as encontrados, (count(*) filter (where enviado))::int as enviados
  from public.maps_empresas
  group by local_busca, segmento;

revoke all on public.maps_lugares, public.maps_empresas, public.maps_grupos from anon, authenticated;
grant select on public.maps_lugares, public.maps_empresas, public.maps_grupos to authenticated;

alter table public.maps_lugares enable row level security;
create policy "maps_lugares: equipe lê" on public.maps_lugares
  for select to authenticated using ((select crm.membro_ativo()));
-- sem policy de INSERT, UPDATE ou DELETE: o app só lê; a carga roda no SQL Editor
