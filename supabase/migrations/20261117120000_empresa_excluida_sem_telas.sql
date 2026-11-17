-- Empresa excluída fecha também as telas de quem é dela (achado na conferência das outras telas, 17/11/2026).
-- A RLS já escondia os dados (crm.minha_empresa() ignora empresa excluída), mas crm.pode() e crm.membro_ativo() olhavam
-- só o membro: public.minhas_telas() continuava devolvendo as telas, e a API do PC, que confere essa lista e não os dados,
-- deixava quem era da empresa excluída usar a Prospecção e as buscas do Google. Agora o membro de empresa excluída não
-- abre nenhuma tela. O administrador, que não é de uma empresa, segue igual. No PC vale em até 1 minuto (ele guarda a
-- lista por 1 minuto). Trazer a empresa de volta (deleted_at = null) devolve as telas.
--
-- Voltar atrás (SQL Editor): as duas funções como eram. Rode isto antes de voltar a migration de várias empresas,
-- porque as funções novas leem public.empresas.
-- create or replace function crm.membro_ativo() returns boolean language sql stable security definer set search_path = '' as $fn$ select exists (select 1 from public.membros where user_id = (select auth.uid()) and ativo) $fn$;
-- create or replace function crm.pode(variadic telas public.tela[]) returns boolean language sql stable security definer set search_path = '' as $fn$ select exists (select 1 from public.membros m where m.user_id = (select auth.uid()) and m.ativo and (m.papel = 'admin' or exists (select 1 from public.membro_telas t where t.user_id = m.user_id and t.tela = any (telas)))) $fn$;

-- membro ativo: o da equipe, e a empresa dele existe e não foi excluída (o administrador não depende de empresa)
create or replace function crm.membro_ativo() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.membros m
    where m.user_id = (select auth.uid()) and m.ativo
      and (m.papel = 'admin' or exists (select 1 from public.empresas e where e.id = m.empresa_id and e.deleted_at is null))
  )
$fn$;

-- abre a tela: administrador abre todas; membro, as liberadas, e só enquanto a empresa dele existir
create or replace function crm.pode(variadic telas public.tela[]) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.membros m
    where m.user_id = (select auth.uid()) and m.ativo
      and (m.papel = 'admin' or (
        exists (select 1 from public.empresas e where e.id = m.empresa_id and e.deleted_at is null)
        and exists (select 1 from public.membro_telas t where t.user_id = m.user_id and t.tela = any (telas))
      ))
  )
$fn$;
