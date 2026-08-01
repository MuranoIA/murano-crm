-- Dropdown de mês no Inside Sales: ver o dashboard como ele estava ao fim de um mês encerrado
-- (ex.: dia 01/08 o supervisor quer os resultados fechados de julho).
-- 1) is_stage_pull passa a espelhar 6 meses p/ trás (antes 3), para os meses encerrados terem
--    seus próprios 3 meses de comparação;
-- 2) is_dashboard_as_of(p_mes): mesmo cálculo do is_dashboard_compute, mas com "hoje" = último
--    dia do mês pedido. Só retorna o payload — NÃO grava; o snapshot noturno segue intocado.

-- (1) espelho com 6 meses de histórico
create or replace function public.is_stage_pull()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare
  v_key text; v_base text; v_desde text;
  v_pagina integer := 1000; v_offset integer;
  v_resp extensions.http_response; v_lote jsonb; v_qtd integer;
  v_nf integer := 0; v_ni integer := 0;
  v_t0 timestamptz := clock_timestamp();
begin
  select valor into v_key from wth_config where chave = 'v2_service_key';
  if v_key is null then raise exception 'Falta v2_service_key em wth_config.'; end if;
  v_desde := to_char(date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - interval '6 months', 'YYYY-MM-DD');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '180');

  select replace(valor, '/clientes', '/faturamento') into v_base from wth_config where chave = 'v2_rest_url';
  delete from is_stage_fat;
  v_offset := 0;
  loop
    v_resp := extensions.http(('GET',
      v_base || '?select=pedido,codfilial,codcli,tipo,nome_usuario,data_fat'
        || '&codfilial=eq.1&tipo=in.(VENDA,DEV)&data_fat=gte.' || v_desde
        || '&order=id.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization','Bearer '||v_key)],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /faturamento HTTP %: %', v_resp.status, left(v_resp.content,300); end if;
    v_lote := v_resp.content::jsonb;
    v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into is_stage_fat (pedido, codfilial, codcli, tipo, nome_usuario, data_fat)
    select nullif(r->>'pedido','')::integer, nullif(r->>'codfilial','')::integer,
           nullif(r->>'codcli','')::integer, r->>'tipo', r->>'nome_usuario',
           (r->>'data_fat')::timestamptz at time zone 'America/Sao_Paulo'
    from jsonb_array_elements(v_lote) r;
    v_nf := v_nf + v_qtd;
    exit when v_qtd < v_pagina;
    v_offset := v_offset + v_pagina;
  end loop;

  select replace(valor, '/clientes', '/itens') into v_base from wth_config where chave = 'v2_rest_url';
  delete from is_stage_itens;
  v_offset := 0;
  loop
    v_resp := extensions.http(('GET',
      v_base || '?select=cod_pedido,codfilial,codprod,vlr_item,quantidade,dt_venda'
        || '&codfilial=eq.1&dt_venda=gte.' || v_desde
        || '&order=id.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization','Bearer '||v_key)],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /itens HTTP %: %', v_resp.status, left(v_resp.content,300); end if;
    v_lote := v_resp.content::jsonb;
    v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into is_stage_itens (cod_pedido, codfilial, codprod, vlr_item, quantidade, dt_venda)
    select nullif(r->>'cod_pedido','')::integer, nullif(r->>'codfilial','')::integer,
           nullif(r->>'codprod','')::integer, nullif(r->>'vlr_item','')::numeric,
           nullif(r->>'quantidade','')::numeric, (r->>'dt_venda')::date
    from jsonb_array_elements(v_lote) r;
    v_ni := v_ni + v_qtd;
    exit when v_qtd < v_pagina;
    v_offset := v_offset + v_pagina;
  end loop;

  return jsonb_build_object('ok', true, 'faturamento', v_nf, 'itens', v_ni, 'desde', v_desde,
    'duracao_ms', (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::integer);
end; $function$;

-- (2) dashboard como estava ao fim do mês pedido (p_mes = qualquer dia do mês desejado)
create or replace function public.is_dashboard_as_of(p_mes date)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ref date := least((date_trunc('month', p_mes) + interval '1 month - 1 day')::date, v_hoje);
  v_n integer;
  v_dados jsonb; v_periodos jsonb; v_mixtotal integer;
  v_meses text[] := array['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
begin
  select count(distinct data_fat) into v_n
  from is_stage_fat
  where tipo='VENDA' and date_trunc('month', data_fat) = date_trunc('month', v_ref) and data_fat <= v_ref;
  if coalesce(v_n,0) = 0 then v_n := 1; end if;

  drop table if exists _win_ao;
  create temp table _win_ao on commit drop as
  with meses as (
    select g as idx, (date_trunc('month', v_ref) - make_interval(months => (3-g)))::date as mstart
    from generate_series(0,3) g
  ),
  vd as (
    select date_trunc('month', data_fat)::date as mstart, data_fat,
           row_number() over (partition by date_trunc('month', data_fat) order by data_fat) as rn
    from (select distinct data_fat from is_stage_fat where tipo='VENDA' and data_fat <= v_ref) d
  )
  select m.idx, m.mstart, vd.data_fat from meses m join vd on vd.mstart = m.mstart and vd.rn <= v_n;

  drop table if exists _agg_ao;
  create temp table _agg_ao on commit drop as
  select c.slug, w.idx,
    sum(i.vlr_item) filter (where f.tipo='VENDA') as bruto,
    sum(i.vlr_item) filter (where f.tipo='DEV') as dev,
    count(distinct f.codcli) filter (where f.tipo='VENDA') as clientes,
    sum(i.quantidade) filter (where f.tipo='VENDA') as itens,
    count(distinct i.codprod) filter (where f.tipo='VENDA') as mix
  from is_config c
  join is_stage_fat f on f.nome_usuario ilike '%'||c.slug||'%'
  join _win_ao w on w.data_fat = f.data_fat
  join is_stage_itens i on i.cod_pedido = f.pedido and i.codfilial = f.codfilial
  where c.ativo
  group by c.slug, w.idx;

  select jsonb_agg(jsonb_build_object(
    'slug', c.slug, 'nome', c.nome, 'novato', c.novato, 'cor', c.cor, 'meta', c.meta,
    'p', (
      select jsonb_agg(jsonb_build_object(
        'bruto', round(coalesce(a.bruto,0),2), 'dev', round(coalesce(a.dev,0),2),
        'liq', round(coalesce(a.bruto,0)-coalesce(a.dev,0),2),
        'clientes', coalesce(a.clientes,0), 'itens', coalesce(a.itens,0)::int, 'mix', coalesce(a.mix,0),
        'preco', case when coalesce(a.itens,0)>0 then round(a.bruto/a.itens,2) end,
        'ticket', case when coalesce(a.clientes,0)>0 then round(a.bruto/a.clientes,2) end
      ) order by s.idx)
      from generate_series(0,3) as s(idx) left join _agg_ao a on a.slug=c.slug and a.idx=s.idx
    )
  ) order by c.ordem) into v_dados
  from is_config c where c.ativo;

  select jsonb_agg(jsonb_build_object('label', lbl) order by idx) into v_periodos
  from (
    select w.idx, v_meses[extract(month from min(w.data_fat))::int] || ' '
      || to_char(min(w.data_fat),'DD') || '–' || to_char(max(w.data_fat),'DD') as lbl
    from _win_ao w group by w.idx
  ) t;

  select count(distinct i.codprod) into v_mixtotal
  from is_stage_fat f
  join _win_ao w on w.data_fat=f.data_fat and w.idx=3
  join is_stage_itens i on i.cod_pedido=f.pedido and i.codfilial=f.codfilial
  where f.tipo='VENDA';

  return jsonb_build_object('atualizado', v_ref, 'dias_movimento', v_n,
    'periodos', v_periodos, 'mix_total', v_mixtotal, 'linhas', v_dados);
end; $function$;
