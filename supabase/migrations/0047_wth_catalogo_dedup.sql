-- vw_tabela_precos pode ter mais de uma linha para o mesmo codprod (ex.: duas embalagens
-- com o mesmo preço). A versão de 0046 falhava com "ON CONFLICT DO UPDATE command cannot
-- affect row a second time" quando as duplicatas caíam no mesmo lote. Aqui deduplicamos por
-- codprod DENTRO do lote (distinct on), preferindo a linha COM preço; entre lotes o ON
-- CONFLICT resolve.
create or replace function public.wth_sync_catalogo_http()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare
  v_key text; v_base text;
  v_cols text := 'codprod,produto,marca,secao,preco_tabela';
  v_pagina integer := 1000; v_offset integer := 0;
  v_resp extensions.http_response; v_lote jsonb; v_qtd integer; v_total integer := 0;
  v_t0 timestamptz := clock_timestamp();
begin
  select valor into v_key from wth_config where chave = 'v2_service_key';
  if v_key is null then raise exception 'Falta v2_service_key em wth_config.'; end if;
  select replace(valor, '/clientes', '/vw_tabela_precos') into v_base from wth_config where chave = 'v2_rest_url';
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '180');
  delete from wth_catalogo;
  loop
    v_resp := extensions.http((
      'GET',
      v_base || '?select=' || v_cols || '&order=codprod.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization', 'Bearer ' || v_key)],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /vw_tabela_precos HTTP %: %', v_resp.status, left(v_resp.content, 300); end if;
    v_lote := v_resp.content::jsonb;
    v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into wth_catalogo (codprod, produto, marca, secao, preco_tabela, sincronizado_em)
    select codprod, produto, marca, secao, preco_tabela, now()
    from (
      select distinct on (nullif(r->>'codprod','')::integer)
        nullif(r->>'codprod','')::integer as codprod,
        r->>'produto' as produto, r->>'marca' as marca, r->>'secao' as secao,
        nullif(r->>'preco_tabela','')::numeric as preco_tabela
      from jsonb_array_elements(v_lote) r
      where nullif(r->>'codprod','') is not null
      order by nullif(r->>'codprod','')::integer, nullif(r->>'preco_tabela','')::numeric asc nulls last
    ) d
    on conflict (codprod) do update set
      produto = excluded.produto, marca = excluded.marca, secao = excluded.secao,
      preco_tabela = excluded.preco_tabela, sincronizado_em = now();
    v_total := v_total + v_qtd;
    exit when v_qtd < v_pagina;
    v_offset := v_offset + v_pagina;
  end loop;
  return jsonb_build_object('ok', true, 'linhas', v_total,
    'duracao_ms', (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::integer);
end; $function$;
