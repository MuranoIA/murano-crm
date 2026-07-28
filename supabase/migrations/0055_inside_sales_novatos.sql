-- Aba Perfil Novatos: histórico completo (VENDA desde 2025) só dos clientes atendidos pelos
-- novatos no mês corrente, para classificar "nunca comprou antes" e faixas de inatividade.
-- Inclui a versão FINAL de is_refresh() (pull 4m + compute + opp + hist + novatos).
create table if not exists public.is_stage_hist (codcli integer, data_fat date);
create index if not exists is_stage_hist_cli_idx on public.is_stage_hist(codcli);
alter table public.is_stage_hist enable row level security;

create or replace function public.is_stage_hist_pull()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare
  v_key text; v_base text; v_list text;
  v_pagina integer := 1000; v_offset integer := 0;
  v_resp extensions.http_response; v_lote jsonb; v_qtd integer; v_n integer := 0;
begin
  select valor into v_key from wth_config where chave='v2_service_key';
  select replace(valor,'/clientes','/faturamento') into v_base from wth_config where chave='v2_rest_url';
  select string_agg(distinct codcli::text, ',') into v_list
  from is_stage_fat f join is_config c on f.nome_usuario ilike '%'||c.slug||'%'
  where c.ativo and c.novato and f.tipo='VENDA'
    and date_trunc('month',f.data_fat)=date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date);
  delete from is_stage_hist;
  if v_list is null then return jsonb_build_object('ok',true,'linhas',0); end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT','180');
  loop
    v_resp := extensions.http(('GET',
      v_base || '?select=codcli,data_fat&codfilial=eq.1&tipo=eq.VENDA&data_fat=gte.2025-01-01'
        || '&codcli=in.(' || v_list || ')&order=id.asc&limit=' || v_pagina || '&offset=' || v_offset,
      array[extensions.http_header('apikey',v_key), extensions.http_header('Authorization','Bearer '||v_key)],
      null,null)::extensions.http_request);
    if v_resp.status <> 200 then raise exception 'v2 hist HTTP %: %', v_resp.status, left(v_resp.content,300); end if;
    v_lote := v_resp.content::jsonb; v_qtd := jsonb_array_length(v_lote);
    exit when v_qtd = 0;
    insert into is_stage_hist (codcli, data_fat)
    select nullif(r->>'codcli','')::integer, (r->>'data_fat')::timestamptz at time zone 'America/Sao_Paulo'
    from jsonb_array_elements(v_lote) r;
    v_n := v_n + v_qtd;
    exit when v_qtd < v_pagina;
    v_offset := v_offset + v_pagina;
  end loop;
  return jsonb_build_object('ok',true,'linhas',v_n);
end; $function$;

create or replace function public.is_compute_novatos()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ms date := date_trunc('month', v_hoje)::date;
  v_ref date := date_trunc('month', v_hoje)::date - 1;
  v_nov jsonb; v_novatos jsonb; v_faixas jsonb; v_kpi jsonb; v_sem jsonb;
begin
  select jsonb_agg(jsonb_build_object('slug',slug,'nome',nome,'cor',cor) order by ordem)
    into v_novatos from is_config where ativo and novato;

  drop table if exists _base;
  create temp table _base on commit drop as
  select distinct c.slug, f.codcli from is_config c
  join is_stage_fat f on f.nome_usuario ilike '%'||c.slug||'%'
  where c.ativo and c.novato and f.tipo='VENDA' and date_trunc('month',f.data_fat)=v_ms;

  drop table if exists _band;
  create temp table _band on commit drop as
  select b.slug, b.codcli,
    case when ua.ua is null then 'novo'
         when (v_ref - ua.ua) <= 120 then 'd120'
         when (v_ref - ua.ua) <= 180 then 'd121_180'
         when (v_ref - ua.ua) <= 365 then 'd181_365'
         else 'd365' end as faixa
  from _base b
  left join lateral (select max(h.data_fat) ua from is_stage_hist h where h.codcli=b.codcli and h.data_fat < v_ms) ua on true;

  v_kpi := jsonb_build_object(
    'total_clientes', (select count(*) from _base),
    'clientes_novos', (select count(*) from _band where faixa='novo'),
    'inativos_121_180', (select count(*) from _band where faixa='d121_180'),
    'inativos_181_365', (select count(*) from _band where faixa='d181_365'));

  select jsonb_agg(row order by ord) into v_faixas from (
    select ord, jsonb_build_object('key',fk,'label',lbl,'cor',cor,
      'counts',(select coalesce(jsonb_object_agg(slug,q),'{}'::jsonb) from (select slug,count(*) q from _band where faixa=fk group by slug) s),
      'total',(select count(*) from _band where faixa=fk),
      'pct', round(100.0*(select count(*) from _band where faixa=fk)/nullif((select count(*) from _band),0),1)
    ) as row
    from (values ('novo','🆕 Nunca compraram','#34D399',1),('d120','≤ 120 dias','#8888A8',2),
                 ('d121_180','121 a 180 dias','#7C5CFC',3),('d181_365','181 a 365 dias','#FBBF24',4),
                 ('d365','Mais de 1 ano','#F87171',5)) v(fk,lbl,cor,ord)
    where (select count(*) from _band where faixa=fk) > 0
  ) z;

  drop table if exists _sem;
  create temp table _sem on commit drop as
  select date_trunc('week',f.data_fat) as wk, min(f.data_fat) d0, max(f.data_fat) d1,
    c.slug, c.nome, c.cor, c.ordem,
    round(coalesce(sum(i.vlr_item),0),0) as fat, count(distinct f.codcli) as clientes
  from is_config c
  join is_stage_fat f on f.nome_usuario ilike '%'||c.slug||'%' and f.tipo='VENDA' and date_trunc('month',f.data_fat)=v_ms
  join is_stage_itens i on i.cod_pedido=f.pedido and i.codfilial=f.codfilial
  where c.ativo and c.novato
  group by date_trunc('week',f.data_fat), c.slug,c.nome,c.cor,c.ordem;

  select jsonb_agg(row order by wk) into v_sem from (
    select wk, jsonb_build_object(
      'label', to_char(min(d0),'DD')||'–'||to_char(max(d1),'DD'),
      'linhas', jsonb_agg(jsonb_build_object('slug',slug,'nome',nome,'cor',cor,'fat',fat,'clientes',clientes) order by ordem)
    ) as row from _sem group by wk
  ) t;

  v_nov := jsonb_build_object('kpis',v_kpi,'novatos',v_novatos,'faixas',coalesce(v_faixas,'[]'::jsonb),
    'semanal',coalesce(v_sem,'[]'::jsonb),'ref',v_ref);
  update is_dashboard set dados = jsonb_set(coalesce(dados,'{}'::jsonb), '{novatos}', v_nov) where id=1;
  return jsonb_build_object('ok',true,'kpis',v_kpi);
end; $function$;

-- is_refresh() FINAL: espelho 4m + cálculo + oportunidades + histórico novatos + perfil novatos.
create or replace function public.is_refresh()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare v_pull jsonb; v_comp jsonb; v_opp jsonb; v_hist jsonb; v_nov jsonb;
begin
  v_pull := is_stage_pull();
  v_comp := is_dashboard_compute();
  v_opp  := is_compute_opp();
  v_hist := is_stage_hist_pull();
  v_nov  := is_compute_novatos();
  return jsonb_build_object('pull',v_pull,'compute',v_comp,'opp',v_opp,'hist',v_hist,'novatos',v_nov);
end; $function$;
