-- Espelho do ENDEREÇO dos clientes (cidade/bairro/endereço) da v2 no murano-conversas.
-- Permite relatórios por localização (ex.: clientes de Mosqueiro, que na v2 é BAIRRO
-- "... (MOSQUEIRO)" com cidade BELEM — o wth_carteira só tem cidade e não captura isso).
-- Padrão wth_*: v2 é read-only, lemos via HTTP/PostgREST e gravamos só no murano-conversas.
create table if not exists public.wth_endereco (
  codcli          integer primary key,
  cidade          text,
  bairro          text,
  endereco        text,
  sincronizado_em timestamptz default now()
);
alter table public.wth_endereco enable row level security; -- sem policy: só service_role (server) lê

-- Sincroniza o endereço de todos os clientes da v2 (paginado). Mesmo padrão de
-- wth_sync_estoque_http: chave/URL em wth_config, http via extensions.http.
create or replace function public.wth_sync_endereco_http()
returns jsonb
language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare
  v_key text; v_base text;
  v_pagina integer := 1000; v_offset integer := 0;
  v_resp extensions.http_response; v_lote jsonb; v_qtd integer; v_total integer := 0;
  v_t0 timestamptz := clock_timestamp();
begin
  select valor into v_key from wth_config where chave = 'v2_service_key';
  if v_key is null then raise exception 'Falta v2_service_key em wth_config.'; end if;
  select valor into v_base from wth_config where chave = 'v2_rest_url'; -- aponta p/ .../clientes
  if v_base is null then raise exception 'Falta v2_rest_url em wth_config.'; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '180');
  loop
    v_resp := extensions.http((
      'GET',
      v_base || '?select=codcli,cidade,bairro,endereco&order=codcli.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization', 'Bearer ' || v_key)],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /clientes HTTP %: %', v_resp.status, left(v_resp.content, 300); end if;
    v_lote := v_resp.content::jsonb;
    v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into wth_endereco (codcli, cidade, bairro, endereco, sincronizado_em)
    select nullif(r->>'codcli','')::integer, r->>'cidade', r->>'bairro', r->>'endereco', now()
    from jsonb_array_elements(v_lote) r
    where nullif(r->>'codcli','') is not null
    on conflict (codcli) do update
      set cidade = excluded.cidade, bairro = excluded.bairro,
          endereco = excluded.endereco, sincronizado_em = now();
    v_total := v_total + v_qtd;
    exit when v_qtd < v_pagina;
    v_offset := v_offset + v_pagina;
  end loop;
  return jsonb_build_object('ok', true, 'linhas', v_total,
    'duracao_ms', (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::integer);
end; $function$;
