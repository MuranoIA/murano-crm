-- =============================================================================
-- Fonte oficial de VENDAS = a mesma do ranking (edge fn bi-ranking-vendas).
-- Espelha a v2 faturamento (linhas relevantes) por data_emissao para wth_vendas_bi,
-- e vw_vendas_bi_total agrega por vendedor/período com a regra EXATA do ranking:
-- linha de MAIOR id por pedido (dedup), posições ativas {L,B,M,F,P}, codfilial<>3,
-- tipo=VENDA, por data_emissao (fuso Belém), menos os pedidos em bi_cancelados_dia.
-- Validado: bate 100% (Romulo hoje R$735,90). Só SELECT na v2; escrita só aqui.
-- Backfill: select wth_sync_vendas_bi_http(90); cron mantém janela de 45 dias.
-- =============================================================================
create table if not exists wth_vendas_bi (
  id bigint primary key, pedido integer, vlr_atendido numeric, nome_usuario text,
  codcli integer, posicao text, codfilial integer, data_emissao timestamptz,
  sincronizado_em timestamptz default now()
);
create index if not exists idx_wth_vendas_bi_pedido on wth_vendas_bi (pedido);
create index if not exists idx_wth_vendas_bi_data on wth_vendas_bi (data_emissao);
alter table wth_vendas_bi enable row level security;
grant select on wth_vendas_bi to service_role;

create or replace function public.wth_sync_vendas_bi_http(p_dias integer default 45)
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare
  v_key text; v_base text;
  v_cols text := 'id,pedido,vlr_atendido,nome_usuario,codcli,posicao,codfilial,data_emissao';
  v_corte text; v_pagina integer := 1000; v_offset integer := 0;
  v_resp extensions.http_response; v_lote jsonb; v_qtd integer; v_total integer := 0;
  v_t0 timestamptz := clock_timestamp();
begin
  select valor into v_key from wth_config where chave = 'v2_service_key';
  if v_key is null then raise exception 'Falta v2_service_key em wth_config.'; end if;
  select replace(valor, '/clientes', '/faturamento') into v_base from wth_config where chave = 'v2_rest_url';
  v_corte := to_char(now() - (p_dias || ' days')::interval, 'YYYY-MM-DD');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '180');
  delete from wth_vendas_bi where data_emissao >= v_corte::timestamptz;
  loop
    v_resp := extensions.http(('GET',
      v_base || '?select=' || v_cols || '&tipo=eq.VENDA&codfilial=neq.3&data_emissao=gte.' || v_corte
        || '&order=id.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey', v_key), extensions.http_header('Authorization', 'Bearer ' || v_key)],
      null, null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 /faturamento HTTP %: %', v_resp.status, left(v_resp.content, 300); end if;
    v_lote := v_resp.content::jsonb; v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into wth_vendas_bi (id, pedido, vlr_atendido, nome_usuario, codcli, posicao, codfilial, data_emissao, sincronizado_em)
    select (r->>'id')::bigint, nullif(r->>'pedido','')::integer, nullif(r->>'vlr_atendido','')::numeric,
      r->>'nome_usuario', nullif(r->>'codcli','')::integer, r->>'posicao', nullif(r->>'codfilial','')::integer,
      (r->>'data_emissao')::timestamptz, now()
    from jsonb_array_elements(v_lote) r
    on conflict (id) do update set pedido=excluded.pedido, vlr_atendido=excluded.vlr_atendido, nome_usuario=excluded.nome_usuario,
      codcli=excluded.codcli, posicao=excluded.posicao, codfilial=excluded.codfilial, data_emissao=excluded.data_emissao, sincronizado_em=now();
    v_total := v_total + v_qtd; exit when v_qtd < v_pagina; v_offset := v_offset + v_pagina;
  end loop;
  return jsonb_build_object('ok', true, 'linhas', v_total, 'janela_dias', p_dias, 'duracao_ms', (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::integer);
end; $function$;

create or replace view vw_vendas_bi_total as
 with hb as ( select (now() at time zone 'America/Sao_Paulo')::date as hoje ),
 dedup as (
   select distinct on (pedido) pedido, vlr_atendido, nome_usuario, codcli, posicao, data_emissao,
          lower(split_part(btrim(nome_usuario), ' ', 1)) as vendedor_slug
   from wth_vendas_bi order by pedido, id desc
 ), ativos as (
   select * from dedup
   where posicao in ('L - Liberado','B - Bloqueado','M - Montado','F - Faturado','P - Pendente')
     and pedido not in (select pedido from bi_cancelados_dia)
 ), per as (
   select 'hoje'::text as periodo, hoje as ini, hoje as fim from hb
   union all select 'ontem', hoje-1, hoje-1 from hb
   union all select 'semana', hoje-6, hoje from hb
   union all select 'quinzena', hoje-14, hoje from hb
   union all select 'mes', date_trunc('month', hoje)::date, hoje from hb
   union all select 'todos', '1900-01-01'::date, hoje from hb
 )
 select p.periodo, a.vendedor_slug,
   count(distinct a.codcli) as clientes, count(*) as vendas, round(sum(a.vlr_atendido), 2) as total
 from per p join ativos a on (a.data_emissao at time zone 'America/Sao_Paulo')::date between p.ini and p.fim
 group by p.periodo, a.vendedor_slug;
grant select on vw_vendas_bi_total to service_role;

-- adiciona ao cron (isolado)
create or replace function public.wth_sync_tudo()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare v_cart jsonb; v_fat jsonb; v_itens jsonb := null; v_ciclo jsonb := null; v_vbi jsonb := null;
begin
  v_cart := wth_sync_carteira_http();
  v_fat  := wth_sync_faturamento_http(45);
  update wth_sync_log set linhas_faturamento = (v_fat->>'linhas')::integer where id = (select max(id) from wth_sync_log);
  begin v_itens := wth_sync_itens_http(7); exception when others then v_itens := jsonb_build_object('ok', false, 'erro', SQLERRM); end;
  begin v_ciclo := wth_sync_ciclo_http();  exception when others then v_ciclo := jsonb_build_object('ok', false, 'erro', SQLERRM); end;
  begin v_vbi := wth_sync_vendas_bi_http(45); exception when others then v_vbi := jsonb_build_object('ok', false, 'erro', SQLERRM); end;
  return jsonb_build_object('carteira', v_cart, 'faturamento', v_fat, 'itens', v_itens, 'ciclo', v_ciclo, 'vendas_bi', v_vbi);
end; $function$;
