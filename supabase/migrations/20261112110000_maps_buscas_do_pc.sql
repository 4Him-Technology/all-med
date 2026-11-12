-- Buscas novas pelo PC entram no mapa (pedido do Filipe em 12/11/2026). Quando uma busca do scraper termina, a tela
-- de quem está logado guarda as empresas dela em maps_lugares, e a equipe pode excluir uma busca inteira, o que preenche
-- deleted_at nas empresas dela. Antes só a carga no SQL Editor gravava. Continua sem DELETE.
-- As views ganham a data da última gravação, para a lista de buscas vir da mais nova para a mais antiga.
--
-- Rollback (rode tudo junto):
--   drop policy "maps_lugares: equipe guarda" on public.maps_lugares;
--   drop policy "maps_lugares: equipe atualiza e exclui" on public.maps_lugares;
--   revoke insert, update on public.maps_lugares from authenticated;
--   drop view public.maps_grupos; drop view public.maps_empresas;
--   e crie as duas views de novo como em 20261110120000_maps_no_crm.sql, com o revoke e o grant de select delas.

-- só as colunas que a tela manda (sem id, created_at e updated_at). O upsert do PostgREST regrava todas as colunas
-- que envia, inclusive as da chave única, por isso o update cobre as mesmas
grant insert (place_id, segmento, local_busca, nome, categoria, endereco, telefone, site, avaliacao, total_avaliacoes, latitude, longitude, link_maps, deleted_at)
  on public.maps_lugares to authenticated;
grant update (place_id, segmento, local_busca, nome, categoria, endereco, telefone, site, avaliacao, total_avaliacoes, latitude, longitude, link_maps, deleted_at)
  on public.maps_lugares to authenticated;

create policy "maps_lugares: equipe guarda" on public.maps_lugares
  for insert to authenticated with check ((select crm.membro_ativo()));
create policy "maps_lugares: equipe atualiza e exclui" on public.maps_lugares
  for update to authenticated using ((select crm.membro_ativo())) with check ((select crm.membro_ativo()));

-- colunas novas entram no fim: create or replace mantém as que já existem e os grants das views
create or replace view public.maps_empresas with (security_invoker = true) as
  select m.id, m.place_id, m.segmento, m.servico, m.local_busca, m.nome, m.categoria, m.endereco, m.bairro, m.cidade, m.cep,
         m.telefone, m.site, m.avaliacao, m.total_avaliacoes, m.latitude, m.longitude, m.link_maps,
         exists (select 1 from public.leads l where l.place_id = m.place_id) as enviado,
         m.updated_at
  from public.maps_lugares m
  where m.deleted_at is null;

create or replace view public.maps_grupos with (security_invoker = true) as
  select local_busca, segmento, count(*)::int as encontrados, (count(*) filter (where enviado))::int as enviados, max(updated_at) as ultima
  from public.maps_empresas
  group by local_busca, segmento;
