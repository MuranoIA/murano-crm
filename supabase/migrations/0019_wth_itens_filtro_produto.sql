-- =============================================================================
-- FILTRO POR PRODUTO — espelha os itens de venda da v2 (murano-clientes-v2) para
-- wth_itens no murano-conversas, no MESMO padrão HTTP do wth_faturamento (a v2 é
-- SOMENTE LEITURA; a service key fica em wth_config). Fonte: v2 public.itens
-- (nível de item: codcli, dt_venda, codprod, produto, quantidade, vlr_item, ...).
-- "Comprou o produto X no período" = existe linha em wth_itens (codprod + dt_venda).
-- Verificado: 172.216 linhas = total exato da v2; query do filtro ~57ms (índice).
-- Aplicar SOMENTE no murano-conversas (wtunzezigncwjpcqsfzk).
--
-- BACKFILL inicial (uma vez, off-peak) foi feito em trimestres p/ não estourar
-- timeout, cada um em sua própria transação (resumível):
--   select wth_sync_itens_http(null, '2025-01-01','2025-03-31'); -- e demais trimestres
-- A partir daí o cron mantém atualizado (janela de 7 dias em wth_sync_tudo).
-- =============================================================================

create table if not exists wth_itens (
  id              bigint primary key,
  codcli          integer,
  dt_venda        date,
  cod_pedido      integer,
  codprod         integer,
  produto         text,
  quantidade      numeric,
  vlr_item        numeric,
  departamento    text,
  secao           text,
  marca           text,
  fornecedor      text,
  sincronizado_em timestamptz default now()
);
create index if not exists idx_wth_itens_prod_data on wth_itens (codprod, dt_venda);
create index if not exists idx_wth_itens_codcli on wth_itens (codcli);
create index if not exists idx_wth_itens_pedido on wth_itens (cod_pedido);

-- dado de compra por cliente não fica público: RLS ligada, leitura só service_role
-- (o app lê server-side pela service key). anon/authenticated não enxergam.
alter table wth_itens enable row level security;
grant select on wth_itens to service_role;

create or replace function public.wth_sync_itens_http(
  p_dias integer default 45,
  p_desde date default null,
  p_ate date default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_key    text;
  v_base   text;
  v_cols   text := 'id,codcli,dt_venda,cod_pedido,codprod,produto,quantidade,vlr_item,departamento,secao,marca,fornecedor';
  v_corte  text;
  v_pagina integer := 1000;
  v_offset integer := 0;
  v_resp   extensions.http_response;
  v_lote   jsonb;
  v_qtd    integer;
  v_total  integer := 0;
  v_t0     timestamptz := clock_timestamp();
begin
  select valor into v_key from wth_config where chave = 'v2_service_key';
  if v_key is null then raise exception 'Falta v2_service_key em wth_config.'; end if;

  select replace(valor, '/clientes', '/itens') into v_base
  from wth_config where chave = 'v2_rest_url';

  v_corte := case
    when p_desde is not null and p_ate is not null
      then '&dt_venda=gte.' || to_char(p_desde,'YYYY-MM-DD') || '&dt_venda=lte.' || to_char(p_ate,'YYYY-MM-DD')
    when p_dias is not null
      then '&dt_venda=gte.' || to_char(now() - (p_dias || ' days')::interval, 'YYYY-MM-DD')
    else '' end;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '180');

  loop
    v_resp := extensions.http((
      'GET',
      v_base || '?select=' || v_cols || v_corte ||
        '&order=id.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[
        extensions.http_header('apikey', v_key),
        extensions.http_header('Authorization', 'Bearer ' || v_key)
      ], null, null)::extensions.http_request);

    if v_resp.status <> 200 then
      raise exception 'v2 /itens HTTP %: %', v_resp.status, left(v_resp.content, 300);
    end if;

    v_lote := v_resp.content::jsonb;
    v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;

    insert into wth_itens (id, codcli, dt_venda, cod_pedido, codprod, produto, quantidade, vlr_item, departamento, secao, marca, fornecedor, sincronizado_em)
    select
      (r->>'id')::bigint,
      nullif(r->>'codcli','')::integer,
      (r->>'dt_venda')::date,
      nullif(r->>'cod_pedido','')::integer,
      nullif(r->>'codprod','')::integer,
      r->>'produto',
      nullif(r->>'quantidade','')::numeric,
      nullif(r->>'vlr_item','')::numeric,
      r->>'departamento',
      r->>'secao',
      r->>'marca',
      r->>'fornecedor',
      now()
    from jsonb_array_elements(v_lote) r
    on conflict (id) do update set
      codcli = excluded.codcli, dt_venda = excluded.dt_venda, cod_pedido = excluded.cod_pedido,
      codprod = excluded.codprod, produto = excluded.produto, quantidade = excluded.quantidade,
      vlr_item = excluded.vlr_item, departamento = excluded.departamento, secao = excluded.secao,
      marca = excluded.marca, fornecedor = excluded.fornecedor, sincronizado_em = now();

    v_total := v_total + v_qtd;
    exit when v_qtd < v_pagina;
    v_offset := v_offset + v_pagina;
  end loop;

  return jsonb_build_object('ok', true, 'linhas', v_total,
    'janela_dias', p_dias, 'desde', p_desde, 'ate', p_ate,
    'duracao_ms', (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::integer);
end;
$function$;

-- adiciona itens ao ciclo do cron (janela leve de 7 dias), isolado por sub-bloco:
-- se o /itens falhar, NÃO derruba a sync de carteira/faturamento.
create or replace function public.wth_sync_tudo()
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_cart jsonb; v_fat jsonb; v_itens jsonb := null;
begin
  v_cart := wth_sync_carteira_http();
  v_fat  := wth_sync_faturamento_http(45);

  update wth_sync_log
     set linhas_faturamento = (v_fat->>'linhas')::integer
   where id = (select max(id) from wth_sync_log);

  begin
    v_itens := wth_sync_itens_http(7);
  exception when others then
    v_itens := jsonb_build_object('ok', false, 'erro', SQLERRM);
  end;

  return jsonb_build_object('carteira', v_cart, 'faturamento', v_fat, 'itens', v_itens);
end;
$function$;
