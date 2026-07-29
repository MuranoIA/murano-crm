-- Relatório: clientes SEM comprar no período (irmão do relatorio_clientes_periodo).
-- Universo = carteira ATIVA dos vendedores do CRM (wth_carteira ligada por rca_num ao
-- carteira_config). Exclui quem comprou no período (mesma definição de venda do ranking:
-- dedup por pedido, posições ativas, data_emissao em BRT).
-- "dias_sem_comprar" usa o histórico completo do motor de ciclo (vw_ciclo_card.dias_ausente,
-- vindo da v2) quando existir; senão cai para (hoje - última compra registrada no espelho ~90d).
-- p_periodo: hoje|ontem|semana|quinzena|mes|todos. p_vendedor: slug (null = todas as carteiras).
create or replace function public.relatorio_clientes_sem_comprar(
  p_periodo text default 'mes',
  p_vendedor text default null
)
returns table(
  codcli           integer,
  cliente          text,
  telefone         text,
  cidade           text,
  estado           text,
  vendedor         text,
  vendedor_slug    text,
  ultima_compra    date,
  dias_sem_comprar integer,
  cliente_id       text
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
      case p_periodo when 'ontem' then hoje - 1 else hoje end as fim,
      hoje
    from hb
  ),
  dedup as (
    select distinct on (pedido)
      pedido, codcli, posicao, data_emissao
    from wth_vendas_bi
    order by pedido, id desc
  ),
  ativos as (
    select codcli, data_emissao
    from dedup
    where posicao = any (array['L - Liberado','B - Bloqueado','M - Montado','F - Faturado','P - Pendente'])
  ),
  compradores as (
    select distinct a.codcli
    from ativos a, rng r
    where (a.data_emissao at time zone 'America/Sao_Paulo')::date between r.ini and r.fim
  ),
  ultima as (
    select codcli, max((data_emissao at time zone 'America/Sao_Paulo')::date) as ultima_compra
    from ativos
    group by codcli
  ),
  universo as (
    select distinct on (c.codcli)
      c.codcli, c.nome, c.telefone, c.cidade, c.estado, cc.slug as vendedor_slug
    from wth_carteira c
    join carteira_config cc on cc.rca_num = c.rca_num and cc.ativo
    where c.ativo
      and (p_vendedor is null or cc.slug = p_vendedor)
    order by c.codcli, cc.slug
  )
  select
    u.codcli,
    coalesce(u.nome, 'cliente ' || u.codcli) as cliente,
    u.telefone,
    u.cidade,
    u.estado,
    u.vendedor_slug as vendedor,
    u.vendedor_slug,
    coalesce(ul.ultima_compra, ((select hoje from rng) - cl.dias_ausente)) as ultima_compra,
    coalesce(cl.dias_ausente, ((select hoje from rng) - ul.ultima_compra))::integer as dias_sem_comprar,
    vin.cliente_id
  from universo u
  left join ultima ul on ul.codcli = u.codcli
  left join lateral (
    select dias_ausente from vw_ciclo_card where codcli = u.codcli limit 1
  ) cl on true
  left join lateral (
    select cliente_id from wth_vinculo where codcli = u.codcli limit 1
  ) vin on true
  where u.codcli not in (select codcli from compradores)
  order by dias_sem_comprar desc nulls last, u.nome;
$function$;
