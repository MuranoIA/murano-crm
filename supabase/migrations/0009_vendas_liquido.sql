-- =============================================================================
-- Vendas passam a ser LÍQUIDAS: subtrai devoluções (tipo='DEV') do faturamento.
-- Antes somava só VENDA-Faturado (bruto) -> inflava o total (Romulo: bruto 15.057
-- vs líquido 14.466, com 5 devoluções de R$590,96). A regra do WinThor é líquido.
--
-- valor  = soma(VENDA-Faturado) - soma(DEV)  (por período, por data_fat da linha)
-- qtd    = nº de NOTAS de venda (devolução não conta como "venda")
-- =============================================================================
create or replace view vw_vendas_totais as
with f as (
  select
    case wc.rca_num when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end as carteira,
    (f.data_fat at time zone 'UTC')::date as d,
    case when f.tipo = 'VENDA' and f.posicao like 'F%' then f.valor
         when f.tipo = 'DEV' then -f.valor else 0 end as valor_liq,
    case when f.tipo = 'VENDA' and f.posicao like 'F%' then 1 else 0 end as eh_venda
  from wth_faturamento f
  join wth_carteira wc on wc.codcli = f.codcli and wc.rca_num in (45, 46, 51)
  where ((f.tipo = 'VENDA' and f.posicao like 'F%') or f.tipo = 'DEV')
    and f.data_fat >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date - interval '31 days'
)
select
  carteira,
  coalesce(sum(valor_liq) filter (where d = (now() at time zone 'America/Sao_Paulo')::date), 0)     as total_hoje,
  coalesce(sum(valor_liq) filter (where d = (now() at time zone 'America/Sao_Paulo')::date - 1), 0) as total_ontem,
  coalesce(sum(valor_liq) filter (where d >  (now() at time zone 'America/Sao_Paulo')::date - 7), 0)  as total_semana,
  coalesce(sum(valor_liq) filter (where d >  (now() at time zone 'America/Sao_Paulo')::date - 15), 0) as total_quinzena,
  coalesce(sum(valor_liq) filter (where d >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date), 0) as total_mes,
  coalesce(sum(eh_venda) filter (where d = (now() at time zone 'America/Sao_Paulo')::date), 0)      as qtd_hoje,
  coalesce(sum(eh_venda) filter (where d = (now() at time zone 'America/Sao_Paulo')::date - 1), 0)  as qtd_ontem,
  coalesce(sum(eh_venda) filter (where d >  (now() at time zone 'America/Sao_Paulo')::date - 7), 0)   as qtd_semana,
  coalesce(sum(eh_venda) filter (where d >  (now() at time zone 'America/Sao_Paulo')::date - 15), 0)  as qtd_quinzena,
  coalesce(sum(eh_venda) filter (where d >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date), 0) as qtd_mes
from f
group by carteira;

grant select on vw_vendas_totais to anon, authenticated;

-- Por cliente (cards sintéticos): venda_mes líquida. Cliente que só devolveu (líquido<=0)
-- não vira card de pedido emitido.
create or replace view vw_vendas_mes_cliente as
select
  f.codcli,
  max(wc.nome)                                                                               as nome,
  max(wc.telefone)                                                                           as telefone,
  case max(wc.rca_num) when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end as carteira,
  max(v.cliente_id)                                                                          as cliente_id_vinculo,
  sum(case when f.tipo = 'VENDA' and f.posicao like 'F%' then f.valor
           when f.tipo = 'DEV' then -f.valor else 0 end)                                     as valor_mes,
  max(f.data_fat) filter (where f.tipo = 'VENDA' and f.posicao like 'F%')                    as data_fat
from wth_faturamento f
join wth_carteira wc on wc.codcli = f.codcli and wc.rca_num in (45, 46, 51)
left join wth_vinculo v on v.codcli = f.codcli
where ((f.tipo = 'VENDA' and f.posicao like 'F%') or f.tipo = 'DEV')
  and f.data_fat >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
group by f.codcli, wc.rca_num
having sum(case when f.tipo = 'VENDA' and f.posicao like 'F%' then f.valor
                when f.tipo = 'DEV' then -f.valor else 0 end) > 0;

grant select on vw_vendas_mes_cliente to anon, authenticated;
