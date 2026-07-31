-- /orcamento: mostrar TODAS as campanhas de um produto, mesmo com preco repetido.
-- Antes a PK (codprod, preco) colapsava campanhas de mesmo preco -> ficava so 1 nome.
-- Agora a chave e (codprod, preco, nome) e o sync deduplica por (codprod, nome, preco),
-- entao cada campanha aparece com seu valor e nome (ex.: Final NutriDivine 250ml R$40 em
-- "Saldao de Verao (kit)", "OFERTAS JULHO (kit)", etc.).
alter table public.wth_campanhas drop constraint if exists wth_campanhas_pkey;
alter table public.wth_campanhas drop constraint if exists wth_campanhas_uq;
alter table public.wth_campanhas add constraint wth_campanhas_uq unique (codprod, preco, nome);

CREATE OR REPLACE FUNCTION public.wth_sync_campanhas_http()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $function$
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

  create temp table if not exists tmp_of (id text, titulo text, campanha text, tipo text) on commit drop;
  create temp table if not exists tmp_oi (codprod integer, oferta_id text, valor numeric) on commit drop;
  truncate tmp_of; truncate tmp_oi;

  v_offset := 0;
  loop
    v_resp := extensions.http(('GET',
      v_url_of || '?select=id,titulo,campanha,tipo&ativo=eq.true&order=id.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization','Bearer '||v_key)], null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /ofertas HTTP %: %', v_resp.status, left(v_resp.content,300); end if;
    v_lote := v_resp.content::jsonb; v_qtd := jsonb_array_length(v_lote); exit when v_qtd = 0;
    insert into tmp_of select r->>'id', r->>'titulo', r->>'campanha', r->>'tipo' from jsonb_array_elements(v_lote) r;
    exit when v_qtd < v_pagina; v_offset := v_offset + v_pagina;
  end loop;

  v_offset := 0;
  loop
    v_resp := extensions.http(('GET',
      v_url_oi || '?select=codprod,oferta_id,vlr_regiao_unitario&order=oferta_id.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization','Bearer '||v_key)], null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /oferta_itens HTTP %: %', v_resp.status, left(v_resp.content,300); end if;
    v_lote := v_resp.content::jsonb; v_qtd := jsonb_array_length(v_lote); exit when v_qtd = 0;
    insert into tmp_oi select nullif(r->>'codprod','')::integer, r->>'oferta_id', nullif(r->>'vlr_regiao_unitario','')::numeric
    from jsonb_array_elements(v_lote) r;
    exit when v_qtd < v_pagina; v_offset := v_offset + v_pagina;
  end loop;

  delete from wth_campanhas;
  insert into wth_campanhas (codprod, preco, nome, sincronizado_em)
  select distinct on (codprod, nome, valor) codprod, valor, nome, now()
  from (
    select oi.codprod, oi.valor,
      coalesce(nullif(btrim(o.campanha),''), nullif(btrim(o.titulo),''), 'Campanha')
        || case when coalesce(o.tipo,'')='combo' then ' (kit)' else '' end as nome
    from tmp_of o join tmp_oi oi on oi.oferta_id = o.id
    where oi.valor is not null and oi.valor > 0 and oi.codprod is not null
  ) x
  order by codprod, nome, valor
  on conflict (codprod, preco, nome) do nothing;

  get diagnostics v_total = row_count;
  return jsonb_build_object('ok', true, 'linhas', v_total, 'duracao_ms', (extract(epoch from (clock_timestamp()-v_t0))*1000)::integer);
end; $function$;
