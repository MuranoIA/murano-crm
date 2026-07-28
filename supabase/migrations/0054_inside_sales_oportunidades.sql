-- Aba Oportunidades: top 10 clientes do MÊS ANTERIOR por consultor (valor líquido) e se
-- recompraram no mês corrente. Nomes vêm do wth_carteira. Grava em dados.oportunidades.
-- (is_refresh() final — com opp + novatos — fica em 0055.)
create or replace function public.is_compute_opp()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_opp jsonb;
begin
  with prev as (
    select c.slug, c.nome as consultor, c.cor, c.ordem, f.codcli,
      round(sum(i.vlr_item) filter (where f.tipo='VENDA')
            - coalesce(sum(i.vlr_item) filter (where f.tipo='DEV'),0), 2) as valor_ant
    from is_config c
    join is_stage_fat f on f.nome_usuario ilike '%'||c.slug||'%'
      and date_trunc('month', f.data_fat) = (date_trunc('month', v_hoje) - interval '1 month')::date
    join is_stage_itens i on i.cod_pedido = f.pedido and i.codfilial = f.codfilial
    where c.ativo
    group by c.slug, c.nome, c.cor, c.ordem, f.codcli
  ),
  t as (select *, row_number() over (partition by slug order by valor_ant desc) rn from prev where valor_ant > 0),
  top10 as (select * from t where rn <= 10),
  cur as (
    select c.slug, f.codcli, round(sum(i.vlr_item), 2) as valor_atual
    from is_config c
    join is_stage_fat f on f.nome_usuario ilike '%'||c.slug||'%'
      and date_trunc('month', f.data_fat) = date_trunc('month', v_hoje) and f.tipo = 'VENDA'
    join is_stage_itens i on i.cod_pedido = f.pedido and i.codfilial = f.codfilial
    where c.ativo group by c.slug, f.codcli
  ),
  joined as (
    select top10.slug, top10.consultor, top10.cor, top10.ordem, top10.codcli, top10.valor_ant, top10.rn,
      cur.valor_atual, (cur.codcli is not null) as convertido,
      coalesce(wc.nome, 'cliente ' || top10.codcli) as cliente
    from top10 left join cur on cur.slug = top10.slug and cur.codcli = top10.codcli
    left join wth_carteira wc on wc.codcli = top10.codcli
  ),
  pend as (select *, row_number() over (partition by slug order by valor_ant desc) as prn from joined where not convertido)
  select jsonb_build_object(
    'total_lista', (select count(*) from joined),
    'convertidos', (select count(*) from joined where convertido),
    'pendentes',   (select count(*) from joined where not convertido),
    'taxa', round(100.0 * (select count(*) from joined where convertido) / nullif((select count(*) from joined), 0), 1),
    'convertidos_lista', coalesce((
      select jsonb_agg(jsonb_build_object('consultor', consultor, 'cliente', cliente,
        'valor_atual', valor_atual, 'valor_ant', valor_ant) order by valor_atual desc nulls last)
      from joined where convertido), '[]'::jsonb),
    'pendentes_por_consultor', coalesce((
      select jsonb_agg(x order by ordem) from (
        select jsonb_build_object('consultor', consultor, 'cor', cor,
          'itens', jsonb_agg(jsonb_build_object('cliente', cliente, 'valor_ant', valor_ant,
            'rank', rn, 'status', case when prn <= 2 then 'urgente' else 'atencao' end) order by valor_ant desc)
        ) as x, ordem
        from pend group by consultor, cor, ordem
      ) z), '[]'::jsonb)
  ) into v_opp;
  update is_dashboard set dados = jsonb_set(coalesce(dados, '{}'::jsonb), '{oportunidades}', coalesce(v_opp,'{}'::jsonb)) where id = 1;
  return jsonb_build_object('ok', true, 'total_lista', v_opp->'total_lista', 'convertidos', v_opp->'convertidos');
end; $function$;
