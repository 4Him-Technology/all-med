-- Clientes ativos (pedido do Filipe em 11/11/2026): empresas que já contratam e não podem ser prospectadas de novo.
-- A tela "Clientes ativos" lista, cadastra e tira. O mapa do Google Maps e as buscas novas pelo PC escondem, e a Prospecção marca,
-- a empresa cujo nome bate com o de um cliente (a regra fica em public/clientes.js). A equipe toda lê e edita.
-- Carga inicial: um arquivo SQL rodado no SQL Editor, gerado da planilha do Filipe e fora do git, porque é a lista de clientes.
--
-- Rollback: drop table public.clientes_ativos;

create table public.clientes_ativos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.clientes_ativos is 'Clientes que já contratam: não aparecem nas pesquisas de prospecção.';

-- O mesmo cliente (sem contar caixa e espaço nas pontas) entra uma vez só entre os ativos; tirado da lista, pode voltar.
-- O índice também é o que a carga usa: on conflict (lower(btrim(nome))) where deleted_at is null do nothing.
create unique index clientes_ativos_nome_unico on public.clientes_ativos (lower(btrim(nome))) where deleted_at is null;

create trigger clientes_ativos_updated_at before update on public.clientes_ativos
  for each row execute function crm.set_updated_at();

-- Permissões: tira tudo e devolve só o necessário. DELETE não é concedido: tirar da lista é preencher deleted_at.
revoke all on public.clientes_ativos from anon, authenticated;
grant select on public.clientes_ativos to authenticated;
grant insert (nome) on public.clientes_ativos to authenticated;
grant update (nome, deleted_at) on public.clientes_ativos to authenticated;

alter table public.clientes_ativos enable row level security;
create policy "clientes_ativos: equipe lê" on public.clientes_ativos
  for select to authenticated using ((select crm.membro_ativo()));
create policy "clientes_ativos: equipe cadastra" on public.clientes_ativos
  for insert to authenticated with check ((select crm.membro_ativo()));
create policy "clientes_ativos: equipe altera" on public.clientes_ativos
  for update to authenticated using ((select crm.membro_ativo())) with check ((select crm.membro_ativo()));
