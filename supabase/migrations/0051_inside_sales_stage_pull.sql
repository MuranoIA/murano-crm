-- Espelha do v2 (Filial 1) os últimos 4 meses de faturamento (VENDA/DEV) e itens,
-- via HTTP/PostgREST (mesmo mecanismo dos wth_sync_*_http). Só leitura da v2.
-- Em faturamento, VENDA↔F-Faturado e DEV↔DEV-Devolucao (sem exceções), então filtra só por tipo.
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
  v_desde := to_char(date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - interval '3 months', 'YYYY-MM-DD');
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
