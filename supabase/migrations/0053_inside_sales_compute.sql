-- Cálculo das 6 abas quantitativas do dashboard Inside Sales + wrapper noturno.
-- Janela = primeiros N dias-com-venda de cada mês, N = dias-com-venda do mês corrente até hoje.
-- Definições validadas contra o arquivo de referência (Milene: bruto/clientes/itens/mix exatos;
-- ticket=bruto/clientes, preco=bruto/itens). % mix usa produtos ativos = distintos vendidos na
-- Filial 1 inteira na janela atual. is_refresh() espelha (is_stage_pull) e recalcula.
-- Agendado via pg_cron: cron.schedule('is-refresh-diario','30 6 * * *','select public.is_refresh();')
create or replace function public.is_dashboard_compute()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_n integer;
  v_dados jsonb; v_periodos jsonb; v_mixtotal integer;
  v_meses text[] := array['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
begin
  select count(distinct data_fat) into v_n
  from is_stage_fat
  where tipo='VENDA' and date_trunc('month', data_fat) = date_trunc('month', v_hoje) and data_fat <= v_hoje;
  if coalesce(v_n,0) = 0 then v_n := 1; end if;

  drop table if exists _win;
  create temp table _win on commit drop as
  with meses as (
    select g as idx, (date_trunc('month', v_hoje) - make_interval(months => (3-g)))::date as mstart
    from generate_series(0,3) g
  ),
  vd as (
    select date_trunc('month', data_fat)::date as mstart, data_fat,
           row_number() over (partition by date_trunc('month', data_fat) order by data_fat) as rn
    from (select distinct data_fat from is_stage_fat where tipo='VENDA') d
  )
  select m.idx, m.mstart, vd.data_fat from meses m join vd on vd.mstart = m.mstart and vd.rn <= v_n;

  drop table if exists _agg;
  create temp table _agg on commit drop as
  select c.slug, w.idx,
    sum(i.vlr_item) filter (where f.tipo='VENDA') as bruto,
    sum(i.vlr_item) filter (where f.tipo='DEV') as dev,
    count(distinct f.codcli) filter (where f.tipo='VENDA') as clientes,
    sum(i.quantidade) filter (where f.tipo='VENDA') as itens,
    count(distinct i.codprod) filter (where f.tipo='VENDA') as mix
  from is_config c
  join is_stage_fat f on f.nome_usuario ilike '%'||c.slug||'%'
  join _win w on w.data_fat = f.data_fat
  join is_stage_itens i on i.cod_pedido = f.pedido and i.codfilial = f.codfilial
  where c.ativo
  group by c.slug, w.idx;

  select jsonb_agg(jsonb_build_object(
    'slug', c.slug, 'nome', c.nome, 'novato', c.novato, 'cor', c.cor, 'meta', c.meta,
    'p', (
      select jsonb_agg(jsonb_build_object(
        'bruto', round(coalesce(a.bruto,0),2), 'dev', round(coalesce(a.dev,0),2),
        'liq', round(coalesce(a.bruto,0)-coalesce(a.dev,0),2),
        'clientes', coalesce(a.clientes,0), 'itens', coalesce(a.itens,0)::int, 'mix', coalesce(a.mix,0),
        'preco', case when coalesce(a.itens,0)>0 then round(a.bruto/a.itens,2) end,
        'ticket', case when coalesce(a.clientes,0)>0 then round(a.bruto/a.clientes,2) end
      ) order by s.idx)
      from generate_series(0,3) as s(idx) left join _agg a on a.slug=c.slug and a.idx=s.idx
    )
  ) order by c.ordem) into v_dados
  from is_config c where c.ativo;

  select jsonb_agg(jsonb_build_object('label', lbl) order by idx) into v_periodos
  from (
    select w.idx, v_meses[extract(month from min(w.data_fat))::int] || ' '
      || to_char(min(w.data_fat),'DD') || '–' || to_char(max(w.data_fat),'DD') as lbl
    from _win w group by w.idx
  ) t;

  select count(distinct i.codprod) into v_mixtotal
  from is_stage_fat f
  join _win w on w.data_fat=f.data_fat and w.idx=3
  join is_stage_itens i on i.cod_pedido=f.pedido and i.codfilial=f.codfilial
  where f.tipo='VENDA';

  update is_dashboard set
    dados = jsonb_build_object('atualizado', v_hoje, 'dias_movimento', v_n,
      'periodos', v_periodos, 'mix_total', v_mixtotal, 'linhas', v_dados),
    atualizado_em = now()
  where id = 1;

  return jsonb_build_object('ok', true, 'dias_movimento', v_n, 'mix_total', v_mixtotal,
    'consultores', jsonb_array_length(v_dados));
end; $function$;

create or replace function public.is_refresh()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare v_pull jsonb; v_comp jsonb;
begin
  v_pull := is_stage_pull();
  v_comp := is_dashboard_compute();
  return jsonb_build_object('pull', v_pull, 'compute', v_comp);
end; $function$;
