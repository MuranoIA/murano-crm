-- =============================================================================
-- Vincula a venda ao contato por TELEFONE quando o vínculo por CPF falha.
-- Causa: o vínculo do WinThor é por CPF; contato do RD sem CPF (ou CPF diferente)
-- não vincula -> a venda virava card sintético "venda:" separado, duplicando quem
-- já tem conversa (ex: ALESSANDRA e ALEXANDRE apareciam em Tentativa/Ociosos E em
-- Pedido Emitido). Telefone bate nesses casos (últimos 8 dígitos).
--
-- cliente_id_vinculo = coalesce(vínculo CPF, contato com mesmo telefone últimos 8).
-- Com isso: a venda gruda no contato (conversa vira Pedido Emitido) e o branch
-- sintético (cliente_id_vinculo is null) deixa de criar card duplicado.
-- =============================================================================
create or replace view vw_vendas_mes_cliente as
with linhas as (
  select
    f.codcli,
    coalesce(v.cliente_id, tel.id)                                                            as cliente_id_vinculo,
    wc.nome, wc.telefone, wc.rca_num, f.data_fat,
    (f.data_fat at time zone 'UTC')::date as d,
    case when f.tipo = 'VENDA' and f.posicao like 'F%' then f.valor
         when f.tipo = 'DEV' then -f.valor else 0 end as vliq,
    (f.tipo = 'VENDA' and f.posicao like 'F%') as eh_venda
  from wth_faturamento f
  join wth_carteira wc on wc.codcli = f.codcli and wc.rca_num in (45, 46, 51)
  left join wth_vinculo v on v.codcli = f.codcli
  left join lateral (
    -- fallback por telefone (últimos 8 dígitos) quando não há vínculo por CPF
    select cl.id
    from clientes cl
    where v.cliente_id is null
      and length(regexp_replace(wc.telefone, '[^0-9]', '', 'g')) >= 8
      and right(regexp_replace(cl.telefone, '[^0-9]', '', 'g'), 8)
          = right(regexp_replace(wc.telefone, '[^0-9]', '', 'g'), 8)
    limit 1
  ) tel on true
  where ((f.tipo = 'VENDA' and f.posicao like 'F%') or f.tipo = 'DEV')
    and f.data_fat >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date - interval '31 days'
)
select
  codcli,
  max(cliente_id_vinculo)                                                                    as cliente_id_vinculo,
  max(nome)                                                                                  as nome,
  max(telefone)                                                                              as telefone,
  case max(rca_num) when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end    as carteira,
  max(data_fat) filter (where eh_venda)                                                      as data_fat,
  coalesce(sum(vliq) filter (where d = (now() at time zone 'America/Sao_Paulo')::date), 0)     as v_hoje,
  coalesce(sum(vliq) filter (where d = (now() at time zone 'America/Sao_Paulo')::date - 1), 0) as v_ontem,
  coalesce(sum(vliq) filter (where d > (now() at time zone 'America/Sao_Paulo')::date - 7), 0)   as v_semana,
  coalesce(sum(vliq) filter (where d > (now() at time zone 'America/Sao_Paulo')::date - 15), 0)  as v_quinzena,
  coalesce(sum(vliq) filter (where d >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date), 0) as v_mes,
  coalesce(sum(vliq) filter (where d >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date), 0) as valor_mes
from linhas
group by codcli, rca_num
having max(data_fat) filter (where eh_venda and d >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date) is not null;

grant select on vw_vendas_mes_cliente to anon, authenticated;
