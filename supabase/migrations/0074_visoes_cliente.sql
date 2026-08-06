-- =============================================================================
-- VISÕES (menu Visões do CRM) — métricas de compra por cliente WinThor.
--
-- Uma view só (vw_visoes_cliente) com os agregados brutos; as regras de cada
-- visão (30 melhores F/M, frequência 3 meses, fidelização, mês atual) moram na
-- rota /api/visoes — mais fácil de ajustar regra sem migration.
--
-- Regras de leitura do faturamento (mesmas do murano-clientes-v2):
--   venda      = tipo 'VENDA' e posicao 'F - Faturado'
--   devolução  = tipo 'DEV'   e posicao 'DEV - Devolucao'
--   líquido    = vendas − devoluções, período por data_fat
--
-- Também: coluna observacao em wth_descartados (visão Desativados permite
-- explicar o motivo da desativação além do dropdown).
--
-- Aplicar só no murano-conversas.
-- =============================================================================

alter table wth_descartados add column if not exists observacao text;
grant update on wth_descartados to service_role;

create or replace view vw_visoes_cliente as
with fat as (
  select
    codcli,
    max(data_fat)  filter (where tipo = 'VENDA')                          as ultima_compra,
    min(data_fat)  filter (where tipo = 'VENDA')                          as primeira_compra,
    -- meses distintos com compra (frequência)
    count(distinct date_trunc('month', data_fat))
      filter (where tipo = 'VENDA')                                       as meses_total,
    count(distinct date_trunc('month', data_fat))
      filter (where tipo = 'VENDA'
        and data_fat >= (date_trunc('month', (now() at time zone 'America/Belem'))::date
                         - interval '12 months'))                         as meses_12m,
    -- monetização: líquido dos últimos 12 meses e do mês corrente (BRT)
    sum(case when tipo = 'VENDA' then valor else -valor end)
      filter (where data_fat >= (date_trunc('month', (now() at time zone 'America/Belem'))::date
                                 - interval '12 months'))                 as total_12m,
    sum(case when tipo = 'VENDA' then valor else -valor end)
      filter (where data_fat >= date_trunc('month', (now() at time zone 'America/Belem'))::date)
                                                                          as valor_mes,
    bool_or(tipo = 'VENDA'
      and data_fat >= date_trunc('month', (now() at time zone 'America/Belem'))::date)
                                                                          as comprou_mes,
    -- últimos 15 meses distintos com compra, do mais recente pro mais antigo —
    -- a API calcula a sequência ("comprou todo mês?") em cima disto
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
-- view roda como dono (security_invoker off, padrão) e atravessa o RLS das
-- tabelas-base; o app só a lê server-side com service_role — sem grant pra anon.
