-- =============================================================================
-- Totais R$ de venda por carteira e por período (dia/semana/quinzena/mês),
-- pra mostrar no cabeçalho da coluna PEDIDO EMITIDO conforme o período escolhido.
-- Por DATA DA NOTA (data_fat) — os buckets hoje/semana/quinzena/mes já vêm da
-- vw_pedido_emitido. View pequena (1 linha por carteira) pra não pesar na vw_funil.
-- =============================================================================
create or replace view vw_pedido_emitido_totais as
select
  carteira,
  coalesce(sum(valor) filter (where hoje), 0)     as total_hoje,
  coalesce(sum(valor) filter (where semana), 0)   as total_semana,
  coalesce(sum(valor) filter (where quinzena), 0) as total_quinzena,
  coalesce(sum(valor) filter (where mes), 0)      as total_mes,
  count(*) filter (where hoje)     as qtd_hoje,
  count(*) filter (where semana)   as qtd_semana,
  count(*) filter (where quinzena) as qtd_quinzena,
  count(*) filter (where mes)      as qtd_mes
from vw_pedido_emitido
group by carteira;

grant select on vw_pedido_emitido_totais to anon, authenticated;
