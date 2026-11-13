-- Painel gerencial, segunda versão (pedido do Filipe em 12/11/2026: "o painel gerencial ficou muito basico"): a mesma
-- função public.painel_gerencial, com a mesma trava (crm.pode('painel')) e as mesmas chaves de antes, mais estes cortes:
-- - atual e anterior: arquivados no período e dias com contato;
-- - pipeline: dos leads não arquivados, de qualquer data, quantos chegaram pelo menos até cada etapa;
-- - tempo_etapas: por etapa, as passagens que terminaram no período (mediana em dias) e, hoje, quantos estão nela e há quanto tempo;
-- - ciclo: dos ganhos do período, a mediana de dias desde que o lead entrou e de contatos até o ganho;
-- - ritmo: contatos do período por dia da semana e hora (horário de São Paulo);
-- - temperaturas: leads não arquivados por temperatura e etapa;
-- - territorio: empresas do Google Maps por segmento e local da busca, e quantas viraram lead;
-- - garimpo: das empresas do Google Maps, quantas viraram lead, tiveram contato, chegaram a Qualificado e foram ganhas;
-- - origens: também quantos chegaram a Qualificado; hoje: também o total de arquivados.
-- O tempo numa etapa vem do histórico de mudança de etapa (só o trigger grava); a primeira passagem começa quando o lead entrou.
-- Só troca a função: não muda tabela nem dado. Roda depois da 20261112150000_painel_gerencial.sql.
--
-- Rollback: rode de novo a função da migration 20261112150000_painel_gerencial.sql, trocando "create function" por
--           "create or replace function" (a tela nova mostra "sem dado" nos cortes que a função antiga não devolve).

create or replace function public.painel_gerencial(p_de timestamptz default null, p_ate timestamptz default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $fn$
with
fim as (select coalesce(p_ate, now()) as ate),
per as (
  select de, ate, p_de is not null as compara,
    case when ate - de <= interval '31 days' then 'day' when ate - de <= interval '190 days' then 'week' else 'month' end as unidade
  from (
    select f.ate, least(f.ate, coalesce(p_de,
      least((select min(created_at) from public.leads where deleted_at is null),
            (select min(data) from public.atendimentos),
            (select min(created_at) from public.maps_lugares where deleted_at is null)),
      f.ate - interval '30 days')) as de
    from fim f
  ) x
),
janelas as (
  select 'atual' as qual, de, ate from per
  union all
  select 'anterior', de - (ate - de), de - interval '1 microsecond' from per where compara
),
ls as (select id, nome, status, temperatura, origem, place_id, created_at from public.leads where deleted_at is null),
contatos as (select lead_id, data, tipo from public.atendimentos where tipo <> 'status'),
-- ordem de cada etapa no funil (perdido fica de fora: é saída, não etapa)
etapa as (
  select e.status, e.ordem::int
  from unnest(array['novo', 'contato', 'qualificado', 'proposta', 'negociacao', 'ganho']::public.lead_status[]) with ordinality e(status, ordem)
),
mudancas as (
  select a.lead_id, a.data,
    (select s from unnest(enum_range(null::public.lead_status)) s where crm.rotulo_status(s) = m.p[1]) as de_status,
    (select s from unnest(enum_range(null::public.lead_status)) s where crm.rotulo_status(s) = m.p[2]) as para_status
  from public.atendimentos a
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
    'empresas_novas', (select count(distinct m.place_id) from public.maps_lugares m where m.deleted_at is null and m.created_at between j.de and j.ate),
    'arquivados', (select count(*) from public.leads l where l.deleted_at between j.de and j.ate),
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
    exists (select 1 from public.leads l where l.place_id = m.place_id) as virou_lead,
    coalesce(ll.ganho, false) as ganho, coalesce(ll.com_contato, false) as com_contato, coalesce(ll.ordem, 0) >= 3 as qualificado
  from public.maps_lugares m
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
    'clientes_ativos', (select count(*) from public.clientes_ativos where deleted_at is null),
    'arquivados', (select count(*) from public.leads where deleted_at is not null),
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
-- quem não abre a tela Painel não recebe nada
where (select crm.pode('painel'))
$fn$;

comment on function public.painel_gerencial(timestamptz, timestamptz) is
  'Números da aba Painel no período [p_de, p_ate] (sem p_de: desde o começo; sem p_ate: agora). Só para quem abre a tela Painel (crm.pode); os outros recebem null.';

-- No Supabase as funções novas em public já nascem liberadas para anon: tira de todos e devolve só para quem está logado
revoke all on function public.painel_gerencial(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.painel_gerencial(timestamptz, timestamptz) to authenticated;
