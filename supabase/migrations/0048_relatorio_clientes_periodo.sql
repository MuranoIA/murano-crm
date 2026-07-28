-- Relatório: clientes que compraram no período. Mesma definição de venda do ranking/board
-- (vw_vendas_bi_total / vw_pedido_bi_card): dedup por pedido, posições ativas, data_emissao
-- no período em BRT. Agrega POR CLIENTE antes de juntar carteira/vínculo (evita inflar soma).
-- p_periodo: hoje|ontem|semana|quinzena|mes|todos. p_vendedor: slug (null = todas as carteiras).
create or replace function public.relatorio_clientes_periodo(
  p_periodo text default 'mes',
  p_vendedor text default null
)
returns table(
  codcli        integer,
  cliente       text,
  telefone      text,
  vendedor      text,
  vendedor_slug text,
  pedidos       bigint,
  total         numeric,
  ultima_compra date,
  cliente_id    text
)
language sql stable security definer set search_path to public
as $function$
  with hb as (
    select (now() at time zone 'America/Sao_Paulo')::date as hoje
  ),
  rng as (
    select
      case p_periodo
        when 'hoje'     then hoje
        when 'ontem'    then hoje - 1
        when 'semana'   then hoje - 6
        when 'quinzena' then hoje - 14
        when 'mes'      then (date_trunc('month', hoje::timestamp))::date
        when 'todos'    then '1900-01-01'::date
        else (date_trunc('month', hoje::timestamp))::date
      end as ini,
      case p_periodo when 'ontem' then hoje - 1 else hoje end as fim
    from hb
  ),
  dedup as (
    select distinct on (pedido)
      pedido, vlr_atendido, nome_usuario, codcli, posicao, data_emissao,
      lower(split_part(btrim(nome_usuario), ' ', 1)) as vendedor_slug
    from wth_vendas_bi
    order by pedido, id desc
  ),
  ativos as (
    select d.*
    from dedup d, rng r
    where d.posicao = any (array['L - Liberado','B - Bloqueado','M - Montado','F - Faturado','P - Pendente'])
      and (d.data_emissao at time zone 'America/Sao_Paulo')::date >= r.ini
      and (d.data_emissao at time zone 'America/Sao_Paulo')::date <= r.fim
      and (p_vendedor is null or d.vendedor_slug = p_vendedor)
  ),
  agg as (
    select codcli, vendedor_slug,
      max(nome_usuario)          as vendedor,
      count(distinct pedido)     as pedidos,
      round(sum(vlr_atendido),2) as total,
      (max(data_emissao))::date  as ultima_compra
    from ativos
    group by codcli, vendedor_slug
  )
  select
    g.codcli,
    coalesce(wc.nome, 'cliente ' || g.codcli) as cliente,
    wc.telefone,
    g.vendedor,
    g.vendedor_slug,
    g.pedidos,
    g.total,
    g.ultima_compra,
    vin.cliente_id
  from agg g
  left join lateral (
    select nome, telefone from wth_carteira where codcli = g.codcli limit 1
  ) wc on true
  left join lateral (
    select cliente_id from wth_vinculo where codcli = g.codcli limit 1
  ) vin on true
  order by g.total desc nulls last;
$function$;
