-- =============================================================================
-- Espelha o motor de ciclo de compra / oportunidades da v2 (vw_oportunidades_diarias)
-- para wth_ciclo no murano-conversas, no mesmo padrão HTTP do wth_itens. ~1116
-- clientes-oportunidade. Substitui a tabela inteira a cada sync (clientes entram/saem
-- da lista todo dia). Usado p/ o selo de ciclo no card e o filtro por categoria.
-- Só SELECT na v2; escrita só aqui. Aplicar só no murano-conversas.
-- =============================================================================
create table if not exists wth_ciclo (
  codcli integer primary key, cliente text, telefone text, rca_vendedor text, ramo text,
  ultima_compra date, dias_ausente integer, total_pedidos integer, rec_total numeric, ticket_medio numeric,
  ciclo_medio numeric, ciclo_desvio numeric, n_intervalos integer, pct_ciclo numeric,
  tendencia text, tipo_oportunidade text, score_urgencia numeric, acao_recomendada text,
  sincronizado_em timestamptz default now()
);
create index if not exists idx_wth_ciclo_tipo on wth_ciclo (tipo_oportunidade);
create index if not exists idx_wth_ciclo_score on wth_ciclo (score_urgencia);
alter table wth_ciclo enable row level security;
grant select on wth_ciclo to service_role;

create or replace function public.wth_sync_ciclo_http()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare
  v_key text; v_base text;
  v_cols text := 'codcli,cliente,telefone,rca_vendedor,ramo,ultima_compra,dias_ausente,total_pedidos,rec_total,ticket_medio,ciclo_medio,ciclo_desvio,n_intervalos,pct_ciclo,tendencia,tipo_oportunidade,score_urgencia,acao_recomendada';
  v_pagina integer := 1000; v_offset integer := 0; v_resp extensions.http_response;
  v_lote jsonb; v_qtd integer; v_total integer := 0; v_t0 timestamptz := clock_timestamp();
begin
  select valor into v_key from wth_config where chave = 'v2_service_key';
  if v_key is null then raise exception 'Falta v2_service_key em wth_config.'; end if;
  select replace(valor, '/clientes', '/vw_oportunidades_diarias') into v_base from wth_config where chave = 'v2_rest_url';
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '180');
  delete from wth_ciclo; -- substitui a tabela inteira (atômico: função = 1 transação)
  loop
    v_resp := extensions.http(('GET',
      v_base || '?select=' || v_cols || '&order=score_urgencia.desc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization', 'Bearer ' || v_key)],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /vw_oportunidades_diarias HTTP %: %', v_resp.status, left(v_resp.content, 300); end if;
    v_lote := v_resp.content::jsonb; v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into wth_ciclo (codcli, cliente, telefone, rca_vendedor, ramo, ultima_compra, dias_ausente, total_pedidos, rec_total, ticket_medio, ciclo_medio, ciclo_desvio, n_intervalos, pct_ciclo, tendencia, tipo_oportunidade, score_urgencia, acao_recomendada, sincronizado_em)
    select (r->>'codcli')::integer, r->>'cliente', r->>'telefone', r->>'rca_vendedor', r->>'ramo',
      nullif(r->>'ultima_compra','')::date, nullif(r->>'dias_ausente','')::integer, nullif(r->>'total_pedidos','')::integer,
      nullif(r->>'rec_total','')::numeric, nullif(r->>'ticket_medio','')::numeric, nullif(r->>'ciclo_medio','')::numeric,
      nullif(r->>'ciclo_desvio','')::numeric, nullif(r->>'n_intervalos','')::integer, nullif(r->>'pct_ciclo','')::numeric,
      r->>'tendencia', r->>'tipo_oportunidade', nullif(r->>'score_urgencia','')::numeric, r->>'acao_recomendada', now()
    from jsonb_array_elements(v_lote) r
    on conflict (codcli) do update set cliente=excluded.cliente, telefone=excluded.telefone, rca_vendedor=excluded.rca_vendedor, ramo=excluded.ramo,
      ultima_compra=excluded.ultima_compra, dias_ausente=excluded.dias_ausente, total_pedidos=excluded.total_pedidos, rec_total=excluded.rec_total,
      ticket_medio=excluded.ticket_medio, ciclo_medio=excluded.ciclo_medio, ciclo_desvio=excluded.ciclo_desvio, n_intervalos=excluded.n_intervalos,
      pct_ciclo=excluded.pct_ciclo, tendencia=excluded.tendencia, tipo_oportunidade=excluded.tipo_oportunidade, score_urgencia=excluded.score_urgencia,
      acao_recomendada=excluded.acao_recomendada, sincronizado_em=now();
    v_total := v_total + v_qtd; exit when v_qtd < v_pagina; v_offset := v_offset + v_pagina;
  end loop;
  return jsonb_build_object('ok', true, 'linhas', v_total, 'duracao_ms', (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::integer);
end; $function$;

-- adiciona o ciclo ao ciclo do cron (isolado)
create or replace function public.wth_sync_tudo()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare v_cart jsonb; v_fat jsonb; v_itens jsonb := null; v_ciclo jsonb := null;
begin
  v_cart := wth_sync_carteira_http();
  v_fat  := wth_sync_faturamento_http(45);
  update wth_sync_log set linhas_faturamento = (v_fat->>'linhas')::integer where id = (select max(id) from wth_sync_log);
  begin v_itens := wth_sync_itens_http(7); exception when others then v_itens := jsonb_build_object('ok', false, 'erro', SQLERRM); end;
  begin v_ciclo := wth_sync_ciclo_http();  exception when others then v_ciclo := jsonb_build_object('ok', false, 'erro', SQLERRM); end;
  return jsonb_build_object('carteira', v_cart, 'faturamento', v_fat, 'itens', v_itens, 'ciclo', v_ciclo);
end; $function$;

-- vw_ciclo_card: wth_ciclo + cliente_id (via vínculo), p/ a rota casar por cliente_id/codcli/telefone
create or replace view vw_ciclo_card as
select wc.codcli, v.cliente_id, wc.telefone,
       wc.tipo_oportunidade, wc.pct_ciclo, wc.score_urgencia, wc.ciclo_medio,
       wc.ciclo_desvio, wc.n_intervalos, wc.dias_ausente, wc.tendencia, wc.acao_recomendada
from wth_ciclo wc
left join wth_vinculo v on v.codcli = wc.codcli;
grant select on vw_ciclo_card to service_role;
