-- Base de CNPJ da Receita Federal (dados abertos, atualização mensal) para a busca de empresas.
--
-- Carga mensal (importador/importar.js):
--   1. cnpj_carga.criar_staging() recria as tabelas *_raw (texto puro, unlogged)
--   2. o importador faz COPY de cada arquivo da Receita para a *_raw correspondente
--   3. cnpj_carga.montar('cnpj_novo') monta as tabelas finais num esquema separado
--   4. cnpj_carga.publicar('cnpj_novo', mes) troca de esquema de uma vez; o mês anterior fica em cnpj_anterior
-- Rollback: cnpj_carga.reverter() troca cnpj e cnpj_anterior de lugar.
--
-- As tabelas do esquema cnpj são dado público reconstruído todo mês. A chave é o próprio CNPJ (não há id
-- interno a esconder) e não há created_at/updated_at por linha: a data da carga fica em cnpj.carga.
-- Ninguém lê essas tabelas direto: o acesso é só pelas funções public.* (security definer) liberadas para authenticated.

create schema if not exists cnpj_carga;
revoke all on schema cnpj_carga from public;

-- maiúsculas e sem acento, para comparar bairro sem depender da extensão unaccent
create or replace function cnpj_carga.normaliza(t text) returns text
language sql immutable parallel safe set search_path = '' as $fn$
  select upper(translate(btrim(t),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
$fn$;

-- data AAAAMMDD da Receita; vazia, zerada ou inválida vira null
-- shortcut: dia inexistente (ex.: 30/02) rola para o mês seguinte em vez de virar null; é raro na base
create or replace function cnpj_carga.data(t text) returns date
language sql immutable parallel safe set search_path = '' as $fn$
  select case when t ~ '^(18|19|20)[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$'
    then make_date(substr(t, 1, 4)::int, substr(t, 5, 2)::int, 1) + (substr(t, 7, 2)::int - 1) end
$fn$;

-- DDD + número só com dígitos; descarta o que não tem 8 ou 9 dígitos
create or replace function cnpj_carga.telefone(ddd text, numero text) returns text
language sql immutable parallel safe set search_path = '' as $fn$
  select case when x.n ~ '^[0-9]{8,9}$' and length(x.d) >= 2 then right(x.d, 2) || x.n end
  from (select regexp_replace(coalesce(ddd, ''), '\D', '', 'g') as d, regexp_replace(coalesce(numero, ''), '\D', '', 'g') as n) x
$fn$;

-- A Receita não diz se o número é celular. Celular tem 9 dígitos começando em 9 (ou 8 começando em 6-9,
-- cadastro anterior ao nono dígito); fixo tem 8 começando em 2-5.
create or replace function cnpj_carga.tipo_telefone(tel text) returns text
language sql immutable parallel safe set search_path = '' as $fn$
  select case when substr(tel, 3) ~ '^(9[0-9]{8}|[6-9][0-9]{7})$' then 'celular'
              when substr(tel, 3) ~ '^[2-5][0-9]{7}$' then 'fixo' end
$fn$;

create or replace function cnpj_carga.faixa_etaria(f smallint) returns text
language sql immutable parallel safe set search_path = '' as $fn$
  select (array['0 a 12 anos', '13 a 20 anos', '21 a 30 anos', '31 a 40 anos', '41 a 50 anos',
                '51 a 60 anos', '61 a 70 anos', '71 a 80 anos', 'Mais de 80 anos'])[f]
$fn$;

-- Tabelas de chegada, no mesmo formato (e ordem de colunas) dos CSVs da Receita
create or replace function cnpj_carga.criar_staging() returns void
language plpgsql set search_path = '' as $fn$
begin
  drop table if exists cnpj_carga.estabelecimentos_raw, cnpj_carga.empresas_raw, cnpj_carga.simples_raw,
    cnpj_carga.socios_raw, cnpj_carga.cnaes_raw, cnpj_carga.naturezas_raw, cnpj_carga.municipios_raw,
    cnpj_carga.qualificacoes_raw;
  create unlogged table cnpj_carga.estabelecimentos_raw (
    cnpj_basico text, cnpj_ordem text, cnpj_dv text, identificador text, nome_fantasia text, situacao text,
    data_situacao text, motivo text, cidade_exterior text, pais text, data_inicio text, cnae_principal text,
    cnae_secundaria text, tipo_logradouro text, logradouro text, numero text, complemento text, bairro text,
    cep text, uf text, municipio text, ddd1 text, telefone1 text, ddd2 text, telefone2 text, ddd_fax text,
    fax text, email text, situacao_especial text, data_situacao_especial text);
  create unlogged table cnpj_carga.empresas_raw (
    cnpj_basico text, razao_social text, natureza text, qualificacao_responsavel text, capital_social text,
    porte text, ente_federativo text);
  create unlogged table cnpj_carga.simples_raw (
    cnpj_basico text, opcao_simples text, data_opcao_simples text, data_exclusao_simples text, opcao_mei text,
    data_opcao_mei text, data_exclusao_mei text);
  create unlogged table cnpj_carga.socios_raw (
    cnpj_basico text, identificador text, nome text, documento text, qualificacao text, data_entrada text,
    pais text, representante_documento text, representante_nome text, representante_qualificacao text,
    faixa_etaria text);
  create unlogged table cnpj_carga.cnaes_raw (codigo text, descricao text);
  create unlogged table cnpj_carga.naturezas_raw (codigo text, descricao text);
  create unlogged table cnpj_carga.municipios_raw (codigo text, descricao text);
  create unlogged table cnpj_carga.qualificacoes_raw (codigo text, descricao text);
end
$fn$;

-- Monta a base final num esquema novo a partir das *_raw. ufs limita a carga a alguns estados (null = Brasil).
-- min_empresas_email: um e-mail repetido em tantas empresas diferentes é tratado como de escritório de contabilidade.
create or replace function cnpj_carga.montar(esquema text, ufs text[] default null, min_empresas_email integer default 5)
returns bigint language plpgsql set search_path = '' as $fn$
declare
  linhas bigint;
begin
  if esquema !~ '^cnpj_[a-z_]+$' or esquema in ('cnpj_carga', 'cnpj_anterior') then
    raise exception 'esquema de destino inválido: %', esquema;
  end if;
  execute format('drop schema if exists %I cascade', esquema);
  execute format('create schema %I', esquema);
  execute format('revoke all on schema %I from public', esquema);

  execute format($q$
    create table %1$I.cnaes (codigo integer primary key, descricao text not null);
    create table %1$I.naturezas (codigo smallint primary key, descricao text not null);
    create table %1$I.qualificacoes (codigo smallint primary key, descricao text not null);
    create table %1$I.municipios (codigo smallint primary key, nome text not null, uf char(2));
    create table %1$I.carga (
      mes_referencia text,
      estabelecimentos bigint not null,
      montada_em timestamptz not null default now(),
      publicada_em timestamptz);
    -- sem CHECK nas colunas codificadas: é cópia da Receita, e uma linha fora do padrão não pode derrubar a carga do mês
    create table %1$I.estabelecimentos (
      cnpj char(14) not null,
      cnpj_basico char(8) not null,
      matriz boolean not null,
      razao_social text,
      nome_fantasia text,
      situacao smallint,              -- 1 nula, 2 ativa, 3 suspensa, 4 inapta, 8 baixada
      data_situacao date,
      data_inicio date,
      cnae_principal integer,
      cnaes_secundarios integer[] not null,
      natureza smallint,
      porte smallint,                 -- 0 não informado, 1 micro, 3 pequeno porte, 5 demais
      capital_social numeric(20, 2),
      simples boolean not null,
      mei boolean not null,
      tipo_logradouro text,
      logradouro text,
      numero text,
      complemento text,
      bairro text,
      bairro_busca text,              -- bairro normalizado para o filtro
      cep char(8),
      uf char(2),
      municipio smallint,             -- código de município da Receita (não é o do IBGE)
      telefones text[] not null,      -- DDD + número, só dígitos
      tem_fixo boolean not null,
      tem_celular boolean not null,
      email text,
      email_contabilidade boolean not null,
      tem_socio_fundador boolean not null,
      faixa_socio_principal smallint, -- 1 a 9, ver cnpj_carga.faixa_etaria
      situacao_especial text);
    create table %1$I.socios (
      cnpj_basico char(8) not null,
      tipo smallint,                  -- 1 pessoa jurídica, 2 pessoa física, 3 estrangeiro
      nome text,
      qualificacao smallint,
      data_entrada date,
      faixa_etaria smallint);
  $q$, esquema);

  execute format($q$
    insert into %1$I.cnaes select distinct on (codigo::int) codigo::int, descricao from cnpj_carga.cnaes_raw where codigo ~ '^[0-9]{1,7}$';
    insert into %1$I.naturezas select distinct on (codigo::smallint) codigo::smallint, descricao from cnpj_carga.naturezas_raw where codigo ~ '^[0-9]{1,4}$';
    insert into %1$I.qualificacoes select distinct on (codigo::smallint) codigo::smallint, descricao from cnpj_carga.qualificacoes_raw where codigo ~ '^[0-9]{1,4}$';
  $q$, esquema);

  -- data de abertura da matriz, para saber quem entrou na sociedade desde o início
  drop table if exists pg_temp._inicio, pg_temp._socio, pg_temp._email_compartilhado;
  create temp table _inicio on commit drop as
    select cnpj_basico, cnpj_carga.data(data_inicio) as inicio from cnpj_carga.estabelecimentos_raw where identificador = '1';

  -- sócio principal: pessoa física com cargo de gestão (sócio-administrador, administrador, presidente, diretor,
  -- titular, empresário), a que tem faixa etária informada e entrou primeiro
  create temp table _socio on commit drop as
    select s.cnpj_basico,
      coalesce(bool_or(cnpj_carga.data(s.data_entrada) <= i.inicio), false) as fundador,
      (array_agg(case when s.faixa_etaria ~ '^[1-9]$' then s.faixa_etaria::smallint end
         order by (s.qualificacao in ('49', '05', '16', '10', '65', '50')) desc,
                  (s.faixa_etaria ~ '^[1-9]$') desc,
                  cnpj_carga.data(s.data_entrada) nulls last)
       filter (where s.identificador = '2'))[1] as faixa_principal
    from cnpj_carga.socios_raw s
    left join pg_temp._inicio i on i.cnpj_basico = s.cnpj_basico
    group by s.cnpj_basico;

  create temp table _email_compartilhado on commit drop as
    select lower(btrim(email)) as email
    from cnpj_carga.estabelecimentos_raw
    where email like '%@%'
    group by 1
    having count(distinct cnpj_basico) >= min_empresas_email;

  execute format($q$
    insert into %1$I.estabelecimentos (
      cnpj, cnpj_basico, matriz, razao_social, nome_fantasia, situacao, data_situacao, data_inicio,
      cnae_principal, cnaes_secundarios, natureza, porte, capital_social, simples, mei,
      tipo_logradouro, logradouro, numero, complemento, bairro, bairro_busca, cep, uf, municipio,
      telefones, tem_fixo, tem_celular, email, email_contabilidade, tem_socio_fundador, faixa_socio_principal,
      situacao_especial)
    select
      e.cnpj_basico || e.cnpj_ordem || e.cnpj_dv,
      e.cnpj_basico,
      e.identificador = '1',
      nullif(btrim(emp.razao_social), ''),
      nullif(btrim(e.nome_fantasia), ''),
      case when e.situacao ~ '^[0-9]{1,2}$' then e.situacao::smallint end,
      cnpj_carga.data(e.data_situacao),
      cnpj_carga.data(e.data_inicio),
      case when e.cnae_principal ~ '^[0-9]{7}$' then e.cnae_principal::int end,
      coalesce((select array_agg(c::int order by c::int) from unnest(string_to_array(e.cnae_secundaria, ',')) c
                where c ~ '^[0-9]{7}$'), '{}'),
      case when emp.natureza ~ '^[0-9]{1,4}$' then emp.natureza::smallint end,
      case when emp.porte ~ '^[0-9]{1,2}$' then emp.porte::smallint end,
      case when emp.capital_social ~ '^[0-9]{1,18}(,[0-9]{1,2})?$' then replace(emp.capital_social, ',', '.')::numeric(20, 2) end,
      coalesce(sim.opcao_simples = 'S', false),
      coalesce(sim.opcao_mei = 'S', false),
      nullif(btrim(e.tipo_logradouro), ''),
      nullif(btrim(e.logradouro), ''),
      nullif(btrim(e.numero), ''),
      nullif(btrim(e.complemento), ''),
      nullif(btrim(e.bairro), ''),
      nullif(cnpj_carga.normaliza(e.bairro), ''),
      nullif(left(regexp_replace(coalesce(e.cep, ''), '\D', '', 'g'), 8), ''),
      nullif(btrim(e.uf), ''),
      case when e.municipio ~ '^[0-9]{1,4}$' then e.municipio::smallint end,
      array_remove(array[t.t1, case when t.t2 is distinct from t.t1 then t.t2 end], null),
      coalesce(cnpj_carga.tipo_telefone(t.t1) = 'fixo', false) or coalesce(cnpj_carga.tipo_telefone(t.t2) = 'fixo', false),
      coalesce(cnpj_carga.tipo_telefone(t.t1) = 'celular', false) or coalesce(cnpj_carga.tipo_telefone(t.t2) = 'celular', false),
      case when e.email like '%%@%%' then lower(btrim(e.email)) end,
      e.email like '%%@%%' and (ec.email is not null or lower(e.email) ~ '(contab|contador|escritorio|assessoria)'),
      coalesce(so.fundador, false),
      so.faixa_principal,
      nullif(btrim(e.situacao_especial), '')
    from cnpj_carga.estabelecimentos_raw e
    left join cnpj_carga.empresas_raw emp on emp.cnpj_basico = e.cnpj_basico
    left join cnpj_carga.simples_raw sim on sim.cnpj_basico = e.cnpj_basico
    left join pg_temp._socio so on so.cnpj_basico = e.cnpj_basico
    left join pg_temp._email_compartilhado ec on ec.email = lower(btrim(e.email))
    cross join lateral (select cnpj_carga.telefone(e.ddd1, e.telefone1) as t1, cnpj_carga.telefone(e.ddd2, e.telefone2) as t2) t
    where $1::text[] is null or e.uf = any($1)
  $q$, esquema) using ufs;
  get diagnostics linhas = row_count;

  -- índices depois da carga, que é bem mais rápido; cada um atende um filtro frequente
  execute format($q$
    alter table %1$I.estabelecimentos add primary key (cnpj);
    create index on %1$I.estabelecimentos (cnpj_basico);                  -- filiais e sócios da mesma empresa
    create index on %1$I.estabelecimentos (municipio, cnae_principal);    -- cidade + ramo, a busca mais comum
    create index on %1$I.estabelecimentos (cnae_principal, uf);           -- ramo no estado ou no país
    create index on %1$I.estabelecimentos using gin (cnaes_secundarios);  -- ramo como atividade secundária
  $q$, esquema);

  execute format($q$
    insert into %1$I.socios (cnpj_basico, tipo, nome, qualificacao, data_entrada, faixa_etaria)
    select s.cnpj_basico,
      case when s.identificador ~ '^[1-3]$' then s.identificador::smallint end,
      nullif(btrim(s.nome), ''),
      case when s.qualificacao ~ '^[0-9]{1,4}$' then s.qualificacao::smallint end,
      cnpj_carga.data(s.data_entrada),
      case when s.faixa_etaria ~ '^[1-9]$' then s.faixa_etaria::smallint end
    from cnpj_carga.socios_raw s
    where $1::text[] is null or exists (select 1 from %1$I.estabelecimentos x where x.cnpj_basico = s.cnpj_basico);
    create index on %1$I.socios (cnpj_basico);                            -- sócios no detalhe da empresa

    insert into %1$I.municipios (codigo, nome, uf)
    select m.codigo::smallint, m.descricao,
      (select e.uf from %1$I.estabelecimentos e where e.municipio = m.codigo::smallint limit 1)
    from (select distinct on (codigo) codigo, descricao from cnpj_carga.municipios_raw where codigo ~ '^[0-9]{1,4}$') m;

    insert into %1$I.carga (estabelecimentos) values ($2);
  $q$, esquema) using ufs, linhas;

  execute format($q$
    alter table %1$I.estabelecimentos enable row level security;
    alter table %1$I.socios enable row level security;
    alter table %1$I.cnaes enable row level security;
    alter table %1$I.naturezas enable row level security;
    alter table %1$I.qualificacoes enable row level security;
    alter table %1$I.municipios enable row level security;
    alter table %1$I.carga enable row level security;
    analyze %1$I.estabelecimentos;
    analyze %1$I.socios;
  $q$, esquema);

  return linhas;
end
$fn$;

create or replace function cnpj_carga.publicar(esquema text, mes text) returns void
language plpgsql set search_path = '' as $fn$
begin
  if esquema !~ '^cnpj_[a-z_]+$' or not exists (select 1 from pg_namespace where nspname = esquema) then
    raise exception 'esquema % não existe', esquema;
  end if;
  execute format('update %I.carga set mes_referencia = $1, publicada_em = now()', esquema) using mes;
  drop schema if exists cnpj_anterior cascade;
  if exists (select 1 from pg_namespace where nspname = 'cnpj') then
    alter schema cnpj rename to cnpj_anterior;
  end if;
  execute format('alter schema %I rename to cnpj', esquema);
end
$fn$;

create or replace function cnpj_carga.reverter() returns void
language plpgsql set search_path = '' as $fn$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cnpj_anterior') then
    raise exception 'não há carga anterior para voltar';
  end if;
  alter schema cnpj rename to cnpj_troca;
  alter schema cnpj_anterior rename to cnpj;
  alter schema cnpj_troca rename to cnpj_anterior;
end
$fn$;

revoke all on all functions in schema cnpj_carga from public;

-- ---------------------------------------------------------------------------------------------
-- API (chamada pelo front via supabase.rpc). Todos os valores entram por parâmetro (USING), nunca
-- concatenados no SQL; o texto dinâmico só junta condições fixas escritas aqui.
-- ---------------------------------------------------------------------------------------------
create or replace function public.buscar_empresas(filtros jsonb default '{}', pagina integer default 1, por_pagina integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  w text[] := '{}';
  v_ufs text[];
  v_municipios smallint[];
  v_bairros text[];
  v_cnaes integer[];
  v_situacoes smallint[];
  v_portes smallint[];
  v_naturezas smallint[];
  v_faixas smallint[];
  v_de date;
  v_ate date;
  v_cap_min numeric;
  v_cap_max numeric;
  onde text;
  v_total bigint;
  v_itens jsonb;
begin
  if jsonb_typeof(filtros) is distinct from 'object' then
    raise exception 'filtros deve ser um objeto JSON' using errcode = '22023';
  end if;
  if por_pagina is null or por_pagina not between 1 and 200 then
    raise exception 'por_pagina deve estar entre 1 e 200' using errcode = '22023';
  end if;
  if pagina is null or pagina not between 1 and 1000 then
    raise exception 'pagina deve estar entre 1 e 1000' using errcode = '22023';
  end if;

  v_ufs := (select array_agg(upper(x)) from jsonb_array_elements_text(filtros -> 'ufs') x);
  v_municipios := (select array_agg(x::smallint) from jsonb_array_elements_text(filtros -> 'municipios') x);
  v_bairros := (select array_agg(cnpj_carga.normaliza(x)) from jsonb_array_elements_text(filtros -> 'bairros') x);
  v_cnaes := (select array_agg(x::integer) from jsonb_array_elements_text(filtros -> 'cnaes') x);
  v_situacoes := (select array_agg(x::smallint) from jsonb_array_elements_text(filtros -> 'situacoes') x);
  v_portes := (select array_agg(x::smallint) from jsonb_array_elements_text(filtros -> 'portes') x);
  v_naturezas := (select array_agg(x::smallint) from jsonb_array_elements_text(filtros -> 'naturezas') x);
  v_faixas := (select array_agg(x::smallint) from jsonb_array_elements_text(filtros -> 'faixas_socio') x);
  v_de := (filtros ->> 'abertura_de')::date;
  v_ate := (filtros ->> 'abertura_ate')::date;
  v_cap_min := (filtros ->> 'capital_min')::numeric;
  v_cap_max := (filtros ->> 'capital_max')::numeric;

  if v_ufs is not null then w := w || 'e.uf = any($1)'::text; end if;
  if v_municipios is not null then w := w || 'e.municipio = any($2)'::text; end if;
  if v_bairros is not null then w := w || 'e.bairro_busca = any($3)'::text; end if;
  if v_cnaes is not null then
    w := w || case when coalesce((filtros ->> 'incluir_secundarios')::boolean, false)
                then '(e.cnae_principal = any($4) or e.cnaes_secundarios && $4)'
                else 'e.cnae_principal = any($4)' end;
  end if;
  if v_situacoes is not null then w := w || 'e.situacao = any($5)'::text; end if;
  if v_portes is not null then w := w || 'e.porte = any($6)'::text; end if;
  if v_naturezas is not null then w := w || 'e.natureza = any($7)'::text; end if;
  if v_faixas is not null then w := w || 'e.faixa_socio_principal = any($8)'::text; end if;
  if v_de is not null then w := w || 'e.data_inicio >= $9'::text; end if;
  if v_ate is not null then w := w || 'e.data_inicio <= $10'::text; end if;
  if v_cap_min is not null then w := w || 'e.capital_social >= $11'::text; end if;
  if v_cap_max is not null then w := w || 'e.capital_social <= $12'::text; end if;

  case filtros ->> 'matriz'
    when 'matriz' then w := w || 'e.matriz'::text;
    when 'filial' then w := w || 'not e.matriz'::text;
    else if filtros ? 'matriz' and filtros ->> 'matriz' is not null then
      raise exception 'matriz deve ser "matriz" ou "filial"' using errcode = '22023'; end if;
  end case;
  case filtros ->> 'simples'
    when 'sim' then w := w || 'e.simples'::text;
    when 'nao' then w := w || 'not e.simples'::text;
    else null;
  end case;
  case filtros ->> 'mei'
    when 'sim' then w := w || 'e.mei'::text;
    when 'nao' then w := w || 'not e.mei'::text;
    else null;
  end case;
  if coalesce((filtros ->> 'com_telefone')::boolean, false) then w := w || 'cardinality(e.telefones) > 0'::text; end if;
  if coalesce((filtros ->> 'com_celular')::boolean, false) then w := w || 'e.tem_celular'::text; end if;
  if coalesce((filtros ->> 'com_email')::boolean, false) then w := w || 'e.email is not null'::text; end if;
  if coalesce((filtros ->> 'ocultar_email_contabilidade')::boolean, false) then w := w || 'not e.email_contabilidade'::text; end if;
  if coalesce((filtros ->> 'com_socio_fundador')::boolean, false) then w := w || 'e.tem_socio_fundador'::text; end if;

  onde := coalesce(nullif(array_to_string(w, ' and '), ''), 'true');

  -- contagem limitada: numa base de 70 milhões, contar tudo a cada busca não compensa
  execute format('select count(*) from (select 1 from cnpj.estabelecimentos e where %s limit 100001) t', onde)
    into v_total
    using v_ufs, v_municipios, v_bairros, v_cnaes, v_situacoes, v_portes, v_naturezas, v_faixas, v_de, v_ate, v_cap_min, v_cap_max;

  execute format($q$
    select coalesce(jsonb_agg(jsonb_build_object(
      'cnpj', e.cnpj, 'razao_social', e.razao_social, 'nome_fantasia', e.nome_fantasia, 'matriz', e.matriz,
      'situacao', e.situacao, 'data_situacao', e.data_situacao, 'data_inicio', e.data_inicio,
      'cnae_principal', e.cnae_principal, 'cnae_descricao', c.descricao,
      'natureza', e.natureza, 'natureza_descricao', n.descricao, 'porte', e.porte,
      'capital_social', e.capital_social, 'simples', e.simples, 'mei', e.mei,
      'logradouro', concat_ws(' ', e.tipo_logradouro, e.logradouro), 'numero', e.numero, 'complemento', e.complemento,
      'bairro', e.bairro, 'cep', e.cep, 'uf', e.uf, 'municipio', e.municipio, 'municipio_nome', m.nome,
      'telefones', (select coalesce(jsonb_agg(jsonb_build_object('numero', tel, 'tipo', cnpj_carga.tipo_telefone(tel))), '[]'::jsonb)
                    from unnest(e.telefones) tel),
      'email', e.email, 'email_contabilidade', e.email_contabilidade,
      'tem_socio_fundador', e.tem_socio_fundador, 'faixa_socio_principal', e.faixa_socio_principal
    ) order by e.cnpj), '[]'::jsonb)
    from (select * from cnpj.estabelecimentos e where %s order by e.cnpj limit $13 offset $14) e
    left join cnpj.cnaes c on c.codigo = e.cnae_principal
    left join cnpj.naturezas n on n.codigo = e.natureza
    left join cnpj.municipios m on m.codigo = e.municipio
  $q$, onde)
    into v_itens
    using v_ufs, v_municipios, v_bairros, v_cnaes, v_situacoes, v_portes, v_naturezas, v_faixas, v_de, v_ate,
          v_cap_min, v_cap_max, por_pagina, (pagina - 1) * por_pagina;

  return jsonb_build_object('total', least(v_total, 100000), 'total_limitado', v_total > 100000,
                            'pagina', pagina, 'por_pagina', por_pagina, 'itens', v_itens);
end
$fn$;

-- Sócios e atividades secundárias, carregados só quando a pessoa abre a empresa.
-- O CPF do sócio vem mascarado pela Receita e não é devolvido (minimização, LGPD).
create or replace function public.cnpj_detalhe(p_cnpj text)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  r jsonb;
begin
  select jsonb_build_object(
    'cnpj', e.cnpj,
    'situacao_especial', e.situacao_especial,
    'cnaes_secundarios', (select coalesce(jsonb_agg(jsonb_build_object('codigo', s, 'descricao', c.descricao) order by s), '[]'::jsonb)
                          from unnest(e.cnaes_secundarios) s left join cnpj.cnaes c on c.codigo = s),
    'socios', (select coalesce(jsonb_agg(jsonb_build_object(
                  'nome', so.nome,
                  'tipo', case so.tipo when 1 then 'Pessoa jurídica' when 2 then 'Pessoa física' when 3 then 'Estrangeiro' end,
                  'qualificacao', q.descricao,
                  'data_entrada', so.data_entrada,
                  'faixa_etaria', cnpj_carga.faixa_etaria(so.faixa_etaria)) order by so.data_entrada nulls last, so.nome), '[]'::jsonb)
               from cnpj.socios so left join cnpj.qualificacoes q on q.codigo = so.qualificacao
               where so.cnpj_basico = e.cnpj_basico))
  into r
  from cnpj.estabelecimentos e
  where e.cnpj = regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  return r;
end
$fn$;

create or replace function public.cnpj_referencias()
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  return jsonb_build_object(
    'cnaes', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'descricao', descricao) order by codigo), '[]'::jsonb) from cnpj.cnaes),
    'naturezas', (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'descricao', descricao) order by codigo), '[]'::jsonb) from cnpj.naturezas),
    'carga', (select jsonb_build_object('mes_referencia', mes_referencia, 'publicada_em', publicada_em, 'estabelecimentos', estabelecimentos)
              from cnpj.carga limit 1));
end
$fn$;

-- sem p_uf devolve todas as cidades que têm empresa na base (cerca de 5.600), para a tela filtrar enquanto a pessoa digita
create or replace function public.cnpj_municipios(p_uf text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  if p_uf is not null and upper(p_uf) !~ '^[A-Z]{2}$' then
    raise exception 'uf inválida' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome, 'uf', uf) order by nome, uf), '[]'::jsonb)
          from cnpj.municipios
          where uf is not null and (p_uf is null or uf = upper(p_uf)));
end
$fn$;

-- Só usuário logado chama a API. No Supabase, funções novas em public já nascem liberadas para anon.
do $do$
declare
  f text;
begin
  foreach f in array array['public.buscar_empresas(jsonb, integer, integer)', 'public.cnpj_detalhe(text)',
                           'public.cnpj_referencias()', 'public.cnpj_municipios(text)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
  end loop;
end
$do$;

-- estado inicial: base vazia publicada, para a API responder antes da primeira carga
select cnpj_carga.criar_staging();
select cnpj_carga.montar('cnpj_novo');
select cnpj_carga.publicar('cnpj_novo', null);
