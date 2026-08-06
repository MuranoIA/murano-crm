-- =============================================================================
-- Filtro "Melhores clientes" do board: top N por TICKET MÉDIO dos últimos 3
-- meses (90 dias móveis), entre quem comprou no período.
--
-- Acrescenta à vw_visoes_cliente os agregados da janela de 90 dias:
--   compras_3m = nº de notas de VENDA   ·   total_3m = líquido (vendas − dev)
-- O ticket médio (total_3m / compras_3m) e o ranking ficam na rota
-- /api/melhores-clientes (TS) — trocar o critério não pede migration.
-- Aplicar só no murano-conversas.
-- =============================================================================

-- drop+create (não "or replace"): as colunas novas entram antes de meses_recentes
-- e o Postgres não permite reordenar colunas de view com replace.
drop view if exists vw_visoes_cliente;
create view vw_visoes_cliente as
with fat as (
  select
    codcli,
    max(data_fat)  filter (where tipo = 'VENDA')                          as ultima_compra,
    min(data_fat)  filter (where tipo = 'VENDA')                          as primeira_compra,
    count(distinct date_trunc('month', data_fat))
      filter (where tipo = 'VENDA')                                       as meses_total,
    count(distinct date_trunc('month', data_fat))
      filter (where tipo = 'VENDA'
        and data_fat >= (date_trunc('month', (now() at time zone 'America/Belem'))::date
                         - interval '12 months'))                         as meses_12m,
    sum(case when tipo = 'VENDA' then valor else -valor end)
      filter (where data_fat >= (date_trunc('month', (now() at time zone 'America/Belem'))::date
                                 - interval '12 months'))                 as total_12m,
    sum(case when tipo = 'VENDA' then valor else -valor end)
      filter (where data_fat >= date_trunc('month', (now() at time zone 'America/Belem'))::date)
                                                                          as valor_mes,
    bool_or(tipo = 'VENDA'
      and data_fat >= date_trunc('month', (now() at time zone 'America/Belem'))::date)
                                                                          as comprou_mes,
    -- janela móvel de 90 dias (filtro Melhores clientes: ticket médio 3m)
    count(*) filter (where tipo = 'VENDA'
      and data_fat >= (now() at time zone 'America/Belem')::date - 90)    as compras_3m,
    sum(case when tipo = 'VENDA' then valor else -valor end)
      filter (where data_fat >= (now() at time zone 'America/Belem')::date - 90)
                                                                          as total_3m,
    (array(
      select m from (
        select distinct date_trunc('month', f2.data_fat)::date as m
        from wth_faturamento f2
        where f2.codcli = f.codcli and f2.tipo = 'VENDA'
        order by m desc limit 15
      ) t
    ))                                                                    as meses_recentes
  from wth_faturamento f
  where (tipo = 'VENDA' and posicao = 'F - Faturado')
     or (tipo = 'DEV'   and posicao = 'DEV - Devolucao')
  group by codcli
)
select
  c.codcli,
  c.nome,
  c.telefone,
  c.tel8,
  c.cidade,
  c.rca_num,
  c.rca_nome,
  cc.slug                                            as vendedor,
  v.cliente_id,
  f.ultima_compra,
  f.primeira_compra,
  ((now() at time zone 'America/Belem')::date - f.ultima_compra) as dias_sem_comprar,
  f.meses_total,
  f.meses_12m,
  coalesce(f.total_12m, 0)                           as total_12m,
  coalesce(f.valor_mes, 0)                           as valor_mes,
  coalesce(f.comprou_mes, false)                     as comprou_mes,
  coalesce(f.compras_3m, 0)                          as compras_3m,
  coalesce(f.total_3m, 0)                            as total_3m,
  f.meses_recentes
from wth_carteira c
join fat f using (codcli)
left join carteira_config cc on cc.rca_num = c.rca_num and cc.ativo
-- 62 codclis têm mais de um cliente_id no vínculo — lateral pega UM só (o mais
-- recente), senão o cliente duplica na view
left join lateral (
  select v2.cliente_id from wth_vinculo v2
  where v2.codcli = c.codcli
  order by v2.conferido_em desc nulls last limit 1
) v on true;
