-- Funções de espelho do Orçamento (lêem o v2 via extensão http + wth_config, mesmo
-- mecanismo das outras wth_*_http). NOTA: wth_sync_catalogo_http é substituída em 0047
-- por uma versão com dedup por codprod.

-- ============ CATÁLOGO + PREÇO DE TABELA ============
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
    select nullif(r->>'codprod','')::integer, r->>'produto', r->>'marca', r->>'secao',
           nullif(r->>'preco_tabela','')::numeric, now()
    from jsonb_array_elements(v_lote) r
    where nullif(r->>'codprod','') is not null
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

-- ============ ESTOQUE (filial 1) — atualizado a cada 30 min ============
create or replace function public.wth_sync_estoque_http()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare
  v_key text; v_base text;
  v_pagina integer := 1000; v_offset integer := 0;
  v_resp extensions.http_response; v_lote jsonb; v_qtd integer; v_total integer := 0;
  v_t0 timestamptz := clock_timestamp();
begin
  select valor into v_key from wth_config where chave = 'v2_service_key';
  if v_key is null then raise exception 'Falta v2_service_key em wth_config.'; end if;
  select replace(valor, '/clientes', '/estoque_winthor') into v_base from wth_config where chave = 'v2_rest_url';
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '180');
  delete from wth_estoque;
  loop
    v_resp := extensions.http((
      'GET',
      v_base || '?select=codigo_produto,qt_estoque_disponivel&codfilial=eq.1&order=codigo_produto.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization', 'Bearer ' || v_key)],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /estoque_winthor HTTP %: %', v_resp.status, left(v_resp.content, 300); end if;
    v_lote := v_resp.content::jsonb;
    v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into wth_estoque (codprod, qt_disponivel, sincronizado_em)
    select nullif(r->>'codigo_produto','')::integer, nullif(r->>'qt_estoque_disponivel','')::numeric, now()
    from jsonb_array_elements(v_lote) r
    where nullif(r->>'codigo_produto','') is not null
    on conflict (codprod) do update set qt_disponivel = excluded.qt_disponivel, sincronizado_em = now();
    v_total := v_total + v_qtd;
    exit when v_qtd < v_pagina;
    v_offset := v_offset + v_pagina;
  end loop;
  return jsonb_build_object('ok', true, 'linhas', v_total,
    'duracao_ms', (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::integer);
end; $function$;

-- ============ CAMPANHAS (ofertas 1-item, não-combo) ============
create or replace function public.wth_sync_campanhas_http()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare
  v_key text; v_url_of text; v_url_oi text;
  v_pagina integer := 1000; v_offset integer := 0;
  v_resp extensions.http_response; v_lote jsonb; v_qtd integer; v_total integer := 0;
  v_t0 timestamptz := clock_timestamp();
begin
  select valor into v_key from wth_config where chave = 'v2_service_key';
  if v_key is null then raise exception 'Falta v2_service_key em wth_config.'; end if;
  select replace(valor, '/clientes', '/ofertas') into v_url_of from wth_config where chave = 'v2_rest_url';
  select replace(valor, '/clientes', '/oferta_itens') into v_url_oi from wth_config where chave = 'v2_rest_url';
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '180');

  create temp table if not exists tmp_of (id text, titulo text, campanha text, tipo text, preco_alvo numeric) on commit drop;
  create temp table if not exists tmp_oi (codprod integer, oferta_id text) on commit drop;
  truncate tmp_of; truncate tmp_oi;

  -- ofertas ativas
  v_offset := 0;
  loop
    v_resp := extensions.http((
      'GET',
      v_url_of || '?select=id,titulo,campanha,tipo,preco_alvo&ativo=eq.true&order=id.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization', 'Bearer ' || v_key)],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /ofertas HTTP %: %', v_resp.status, left(v_resp.content, 300); end if;
    v_lote := v_resp.content::jsonb;
    v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into tmp_of select r->>'id', r->>'titulo', r->>'campanha', r->>'tipo', nullif(r->>'preco_alvo','')::numeric
    from jsonb_array_elements(v_lote) r;
    exit when v_qtd < v_pagina;
    v_offset := v_offset + v_pagina;
  end loop;

  -- itens das ofertas
  v_offset := 0;
  loop
    v_resp := extensions.http((
      'GET',
      v_url_oi || '?select=codprod,oferta_id&order=oferta_id.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization', 'Bearer ' || v_key)],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /oferta_itens HTTP %: %', v_resp.status, left(v_resp.content, 300); end if;
    v_lote := v_resp.content::jsonb;
    v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into tmp_oi select nullif(r->>'codprod','')::integer, r->>'oferta_id'
    from jsonb_array_elements(v_lote) r;
    exit when v_qtd < v_pagina;
    v_offset := v_offset + v_pagina;
  end loop;

  -- só ofertas INDIVIDUAIS de 1 item viram preço de campanha (combos são pacotes).
  -- dedup por (codprod, preco) mantendo 1 nome, menor preço primeiro.
  delete from wth_campanhas;
  insert into wth_campanhas (codprod, preco, nome, sincronizado_em)
  select distinct on (oi.codprod, o.preco_alvo)
    oi.codprod, o.preco_alvo,
    coalesce(nullif(btrim(o.campanha), ''), nullif(btrim(o.titulo), ''), 'Campanha'),
    now()
  from tmp_of o
  join tmp_oi oi on oi.oferta_id = o.id
  where coalesce(o.tipo, '') <> 'combo'
    and o.preco_alvo is not null and o.preco_alvo > 0
    and oi.codprod is not null
    and o.id in (select oferta_id from tmp_oi where codprod is not null group by oferta_id having count(*) = 1)
  order by oi.codprod, o.preco_alvo
  on conflict (codprod, preco) do nothing;

  get diagnostics v_total = row_count;
  return jsonb_build_object('ok', true, 'linhas', v_total,
    'duracao_ms', (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::integer);
end; $function$;

-- ============ WRAPPER: tudo do orçamento de uma vez ============
create or replace function public.wth_sync_orcamento_http()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare v_cat jsonb; v_camp jsonb; v_est jsonb;
begin
  v_cat  := wth_sync_catalogo_http();
  v_camp := wth_sync_campanhas_http();
  v_est  := wth_sync_estoque_http();
  return jsonb_build_object('catalogo', v_cat, 'campanhas', v_camp, 'estoque', v_est);
end; $function$;
