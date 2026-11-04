-- Montagem da base sem linhas repetidas e mais leve (03/11/2026).
-- A carga de outubro parou no fim, ao criar a chave primária: um CNPJ veio duas vezes. A Receita às vezes repete
-- uma empresa ou um estabelecimento, e um arquivo gravado duas vezes repetiria tudo. Agora:
--   - Empresas e Simples entram uma linha por empresa (e um estabelecimento não se multiplica no cruzamento);
--   - se ainda sobrar CNPJ repetido, fica uma linha por CNPJ, a de situação mais recente, e a chave é criada de novo;
--   - Empresas, Simples e Sócios são filtrados para as empresas com estabelecimento carregado antes de cruzar
--     (com --ufs SP, uma fração dos 150 milhões de linhas do Brasil inteiro);
--   - mais memória para os cruzamentos, só durante a montagem.
-- Aplicar num banco que já existe: ver INSTALAR.md, "Se a carga parar na montagem".
-- Rollback: rodar de novo o create or replace function cnpj_carga.montar de 20261027120000_base_cnpj.sql.

create or replace function cnpj_carga.montar(esquema text, ufs text[] default null, min_empresas_email integer default 5)
returns bigint language plpgsql set search_path = '' as $fn$
declare
  linhas bigint;
begin
  if esquema !~ '^cnpj_[a-z_]+$' or esquema in ('cnpj_carga', 'cnpj_anterior') then
    raise exception 'esquema de destino inválido: %', esquema;
  end if;
  -- cruzamentos de milhões de linhas: com mais memória o banco usa menos o disco (vale só nesta transação)
  perform set_config('work_mem', '128MB', true);

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

  drop table if exists pg_temp._basicos, pg_temp._empresa, pg_temp._simples, pg_temp._inicio, pg_temp._socio,
    pg_temp._email_compartilhado, pg_temp._repetidos, pg_temp._unicos;

  -- empresas com estabelecimento nos estados pedidos; Empresas, Simples e Sócios chegam do Brasil inteiro
  create temp table _basicos on commit drop as
    select distinct cnpj_basico from cnpj_carga.estabelecimentos_raw where ufs is null or uf = any (ufs);
  analyze pg_temp._basicos;

  -- uma linha por empresa: a Receita às vezes repete a mesma empresa, e cada repetição duplicaria os estabelecimentos dela
  create temp table _empresa on commit drop as
    select distinct on (r.cnpj_basico) r.* from cnpj_carga.empresas_raw r
    where exists (select 1 from pg_temp._basicos b where b.cnpj_basico = r.cnpj_basico)
    order by r.cnpj_basico;
  create temp table _simples on commit drop as
    select distinct on (r.cnpj_basico) r.* from cnpj_carga.simples_raw r
    where exists (select 1 from pg_temp._basicos b where b.cnpj_basico = r.cnpj_basico)
    order by r.cnpj_basico;
  analyze pg_temp._empresa;
  analyze pg_temp._simples;

  -- data de abertura da matriz, para saber quem entrou na sociedade desde o início
  create temp table _inicio on commit drop as
    select cnpj_basico, cnpj_carga.data(data_inicio) as inicio from cnpj_carga.estabelecimentos_raw where identificador = '1';
  analyze pg_temp._inicio;

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
    where exists (select 1 from pg_temp._basicos b where b.cnpj_basico = s.cnpj_basico)
    group by s.cnpj_basico;
  analyze pg_temp._socio;

  create temp table _email_compartilhado on commit drop as
    select lower(btrim(email)) as email
    from cnpj_carga.estabelecimentos_raw
    where email like '%@%'
    group by 1
    having count(distinct cnpj_basico) >= min_empresas_email;
  analyze pg_temp._email_compartilhado;

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
    left join pg_temp._empresa emp on emp.cnpj_basico = e.cnpj_basico
    left join pg_temp._simples sim on sim.cnpj_basico = e.cnpj_basico
    left join pg_temp._socio so on so.cnpj_basico = e.cnpj_basico
    left join pg_temp._email_compartilhado ec on ec.email = lower(btrim(e.email))
    cross join lateral (select cnpj_carga.telefone(e.ddd1, e.telefone1) as t1, cnpj_carga.telefone(e.ddd2, e.telefone2) as t2) t
    where $1::text[] is null or e.uf = any($1)
  $q$, esquema) using ufs;
  get diagnostics linhas = row_count;

  -- chave primária: se ainda vier CNPJ repetido, fica uma linha por CNPJ (a de situação mais recente) e tenta de novo.
  -- Na carga sem repetição não custa nada a mais.
  begin
    execute format('alter table %I.estabelecimentos add primary key (cnpj)', esquema);
  exception when unique_violation then
    execute format('create temp table _repetidos on commit drop as select cnpj from %I.estabelecimentos group by cnpj having count(*) > 1', esquema);
    execute format($q$
      create temp table _unicos on commit drop as
        select distinct on (e.cnpj) e.* from %1$I.estabelecimentos e join pg_temp._repetidos r using (cnpj)
        order by e.cnpj, e.data_situacao desc nulls last;
      delete from %1$I.estabelecimentos e using pg_temp._repetidos r where e.cnpj = r.cnpj;
      insert into %1$I.estabelecimentos select * from pg_temp._unicos;
      alter table %1$I.estabelecimentos add primary key (cnpj);
    $q$, esquema);
    execute format('select count(*) from %I.estabelecimentos', esquema) into linhas;
    raise notice 'CNPJs repetidos na Receita: % (ficou uma linha de cada)', (select count(*) from pg_temp._repetidos);
  end;

  -- índices depois da carga, que é bem mais rápido; cada um atende um filtro frequente
  execute format($q$
    create index on %1$I.estabelecimentos (cnpj_basico);                  -- filiais e sócios da mesma empresa
    create index on %1$I.estabelecimentos (municipio, cnae_principal);    -- cidade + ramo, a busca mais comum
    create index on %1$I.estabelecimentos (cnae_principal, uf);           -- ramo no estado ou no país
    create index on %1$I.estabelecimentos using gin (cnaes_secundarios);  -- ramo como atividade secundária
  $q$, esquema);

  -- distinct: um arquivo de Sócios gravado duas vezes repetiria cada sócio no detalhe da empresa
  execute format($q$
    insert into %1$I.socios (cnpj_basico, tipo, nome, qualificacao, data_entrada, faixa_etaria)
    select distinct s.cnpj_basico,
      case when s.identificador ~ '^[1-3]$' then s.identificador::smallint end,
      nullif(btrim(s.nome), ''),
      case when s.qualificacao ~ '^[0-9]{1,4}$' then s.qualificacao::smallint end,
      cnpj_carga.data(s.data_entrada),
      case when s.faixa_etaria ~ '^[1-9]$' then s.faixa_etaria::smallint end
    from cnpj_carga.socios_raw s
    where exists (select 1 from pg_temp._basicos b where b.cnpj_basico = s.cnpj_basico)
      and ($1::text[] is null or exists (select 1 from %1$I.estabelecimentos x where x.cnpj_basico = s.cnpj_basico));
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
