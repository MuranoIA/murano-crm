-- Conciliação do Inside Sales com a referência (MaxiGestão "RCA Venda").
-- Três correções técnicas na apuração de faturamento:
--
-- 1) BASE DO VALOR: faturamento/devolução passam a usar vlr_atendido do PEDIDO
--    (1 linha por pedido, a de maior id, posicao 'F - Faturado'), e não a soma de
--    itens.vlr_item. A soma de itens inflava a devolução em até 62% (Rômulo: 1.906
--    por item vs 1.178 por pedido). Quantidade, mix e preço médio continuam item a
--    item, porque são inerentemente item a item.
-- 2) COLUNA DE DATA: a v2 tem datafat (date) e data_fat (timestamp) e elas divergem
--    em muitas linhas. A referência usa datafat; passamos a usar datafat.
-- 3) JANELA DA DEVOLUÇÃO: antes a devolução só entrava se caísse exatamente num dia
--    que teve venda, então devolução em dia sem venda sumia. Agora a janela é o
--    intervalo [1º dia, N-ésimo dia com faturamento] e a devolução entra pelo intervalo.
--
-- Mantido de propósito: atribuição por quem emitiu (nome_usuario) — testei atribuir
-- pelo RCA atual do cliente e fica muito pior (Monara zera, Francisco erra R$ 17 mil);
-- e cancelados NÃO são descontados (descontando, todos erram; sem descontar, 6 batem
-- exatamente). A coluna data_fat continua populada porque is_compute_opp e
-- is_compute_novatos dependem dela.

alter table public.is_stage_fat
  add column if not exists id bigint,
  add column if not exists posicao text,
  add column if not exists vlr_atendido numeric,
  add column if not exists datafat date;

create index if not exists is_stage_fat_datafat_idx on public.is_stage_fat(datafat);

-- Espelho: agora traz id/posicao/vlr_atendido/datafat e janela por datafat.
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
      v_base || '?select=id,pedido,codfilial,codcli,tipo,posicao,nome_usuario,vlr_atendido,datafat,data_fat'
        || '&codfilial=eq.1&tipo=in.(VENDA,DEV)&datafat=gte.' || v_desde
        || '&order=id.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization','Bearer '||v_key)],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /faturamento HTTP %: %', v_resp.status, left(v_resp.content,300); end if;
    v_lote := v_resp.content::jsonb;
    v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into is_stage_fat (id, pedido, codfilial, codcli, tipo, posicao, nome_usuario, vlr_atendido, datafat, data_fat)
    select nullif(r->>'id','')::bigint, nullif(r->>'pedido','')::integer, nullif(r->>'codfilial','')::integer,
           nullif(r->>'codcli','')::integer, r->>'tipo', r->>'posicao', r->>'nome_usuario',
           nullif(r->>'vlr_atendido','')::numeric, nullif(r->>'datafat','')::date,
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

-- Núcleo do cálculo: dashboard como estava no fim do mês pedido.
create or replace function public.is_dashboard_as_of(p_mes date)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ref  date := least((date_trunc('month', p_mes) + interval '1 month - 1 day')::date, v_hoje);
  v_n integer;
  v_dados jsonb; v_periodos jsonb; v_mixtotal integer;
  v_meses text[] := array['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
begin
  select count(distinct datafat) into v_n
  from is_stage_fat
  where tipo='VENDA' and posicao='F - Faturado'
    and date_trunc('month', datafat) = date_trunc('month', v_ref) and datafat <= v_ref;
  if coalesce(v_n,0) = 0 then v_n := 1; end if;

  -- janela de cada mês = intervalo dos N primeiros dias com faturamento
  drop table if exists _win;
  create temp table _win on commit drop as
  select m.idx, min(vd.datafat) as d_ini, max(vd.datafat) as d_fim
  from (select g as idx, (date_trunc('month', v_ref) - make_interval(months => (3-g)))::date as mstart
        from generate_series(0,3) g) m
  join (select date_trunc('month', datafat)::date as mstart, datafat,
               row_number() over (partition by date_trunc('month', datafat) order by datafat) as rn
        from (select distinct datafat from is_stage_fat
              where tipo='VENDA' and posicao='F - Faturado' and datafat <= v_ref) d) vd
    on vd.mstart = m.mstart and vd.rn <= v_n
  group by m.idx;

  -- 1 linha por pedido (a de maior id) dentro da janela do mês.
  -- Dedup inclui o tipo: o MESMO número de pedido tem linha de VENDA e linha de DEV
  -- (a devolução herda o número do pedido original), então deduplicar só por pedido
  -- apagaria a venda.
  drop table if exists _ped;
  create temp table _ped on commit drop as
  select distinct on (w.idx, f.tipo, f.pedido)
         w.idx, f.pedido, f.codfilial, f.codcli, f.tipo, f.nome_usuario, f.vlr_atendido
  from _win w
  join is_stage_fat f
    on f.datafat between w.d_ini and w.d_fim
   and (f.tipo='DEV' or (f.tipo='VENDA' and f.posicao='F - Faturado'))
  order by w.idx, f.tipo, f.pedido, f.id desc;

  -- faturamento, devolução e clientes: base PEDIDO
  drop table if exists _agp;
  create temp table _agp on commit drop as
  select c.slug, p.idx,
    sum(p.vlr_atendido) filter (where p.tipo='VENDA') as bruto,
    sum(p.vlr_atendido) filter (where p.tipo='DEV')   as dev,
    count(distinct p.codcli) filter (where p.tipo='VENDA') as clientes
  from is_config c
  join _ped p on p.nome_usuario ilike '%'||c.slug||'%'
  where c.ativo
  group by c.slug, p.idx;

  -- quantidade, mix e preço médio: base ITEM (dos pedidos de venda da janela)
  drop table if exists _agi;
  create temp table _agi on commit drop as
  select c.slug, p.idx,
    sum(i.vlr_item)   as vlr_itens,
    sum(i.quantidade) as itens,
    count(distinct i.codprod) as mix
  from is_config c
  join _ped p on p.nome_usuario ilike '%'||c.slug||'%' and p.tipo='VENDA'
  join is_stage_itens i on i.cod_pedido = p.pedido and i.codfilial = p.codfilial
  where c.ativo
  group by c.slug, p.idx;

  select jsonb_agg(jsonb_build_object(
    'slug', c.slug, 'nome', c.nome, 'novato', c.novato, 'cor', c.cor, 'meta', c.meta,
    'p', (
      select jsonb_agg(jsonb_build_object(
        'bruto', round(coalesce(a.bruto,0),2), 'dev', round(coalesce(a.dev,0),2),
        'liq',   round(coalesce(a.bruto,0)-coalesce(a.dev,0),2),
        'clientes', coalesce(a.clientes,0),
        'itens', coalesce(b.itens,0)::int, 'mix', coalesce(b.mix,0),
        'preco',  case when coalesce(b.itens,0)>0    then round(b.vlr_itens/b.itens,2) end,
        'ticket', case when coalesce(a.clientes,0)>0 then round(a.bruto/a.clientes,2) end
      ) order by s.idx)
      from generate_series(0,3) as s(idx)
      left join _agp a on a.slug=c.slug and a.idx=s.idx
      left join _agi b on b.slug=c.slug and b.idx=s.idx
    )
  ) order by c.ordem) into v_dados
  from is_config c where c.ativo;

  select jsonb_agg(jsonb_build_object('label', lbl) order by idx) into v_periodos
  from (select idx, v_meses[extract(month from d_ini)::int] || ' '
               || to_char(d_ini,'DD') || '–' || to_char(d_fim,'DD') as lbl
        from _win) t;

  select count(distinct i.codprod) into v_mixtotal
  from _ped p join is_stage_itens i on i.cod_pedido=p.pedido and i.codfilial=p.codfilial
  where p.idx = 3 and p.tipo = 'VENDA';

  return jsonb_build_object('atualizado', v_ref, 'dias_movimento', v_n,
    'periodos', v_periodos, 'mix_total', v_mixtotal, 'linhas', v_dados);
end; $function$;

-- Snapshot noturno = mesmo cálculo, com referência em hoje.
create or replace function public.is_dashboard_compute()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_payload jsonb;
begin
  v_payload := is_dashboard_as_of(v_hoje);
  update is_dashboard set dados = v_payload, atualizado_em = now() where id = 1;
  return jsonb_build_object('ok', true,
    'dias_movimento', (v_payload->>'dias_movimento')::int,
    'mix_total', (v_payload->>'mix_total')::int,
    'consultores', jsonb_array_length(v_payload->'linhas'));
end; $function$;
