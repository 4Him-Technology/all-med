-- A aba Leads passa a ler da mesma view do kanban para ordenar pelo último contato.
-- create or replace só acrescenta colunas no fim; o select já concedido ao authenticated vale para elas
-- e o security_invoker mantém a RLS de leads valendo.
-- Rollback: rodar de novo o create view da migration 20261027150000_crm.sql (sem as três colunas novas).
create or replace view public.leads_kanban with (security_invoker = true) as
  select l.id, l.nome, l.categoria, l.telefone, l.temperatura, l.avaliacao, l.status, l.updated_at,
    (select max(a.data) from public.atendimentos a where a.lead_id = l.id and a.tipo <> 'status') as ultimo_atendimento,
    l.total_avaliacoes, l.origem, l.created_at
  from public.leads l
  where l.deleted_at is null;
