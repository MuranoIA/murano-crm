-- =============================================================================
-- Pedido Emitido passa a mostrar TODAS as vendas do vendedor (nota fiscal WinThor),
-- inclusive de clientes que NUNCA conversaram no RD Conversas. Antes só contava
-- venda de quem tinha conversa (Romulo: 43 de 75 reais).
--
-- Fonte de vendedor = RCA do WinThor (wth_carteira.rca_num), NÃO o contato. A
-- wth_faturamento não tem vendedor; a atribuição é pelo cliente (codcli -> rca).
--
-- Duas peças:
--   vw_vendas_totais  -> total R$ e qtd de notas por carteira e período (cabeçalho).
--   3º branch da vw_funil -> card sintético "venda:<codcli>" para venda de cliente
--     SEM vínculo a contato (sem conversa) — sem risco de duplicar quem já está no
--     funil. Cliente que conversou já aparece pelo branch principal.
-- =============================================================================

-- helper: BRT today
-- (inline via (now() at time zone 'America/Sao_Paulo')::date)

-- ---------------------------------------------------------------------------
-- Totais por carteira e período (por DATA DA NOTA) — base RCA, venda real.
-- ---------------------------------------------------------------------------
create or replace view vw_vendas_totais as
with f as (
  select
    case wc.rca_num when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end as carteira,
    f.valor,
    f.data_fat,
    (f.data_fat at time zone 'UTC')::date as d
  from wth_faturamento f
  join wth_carteira wc on wc.codcli = f.codcli and wc.rca_num in (45, 46, 51)
  where f.tipo = 'VENDA' and f.posicao like 'F%'
    and f.data_fat >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date - interval '31 days'
)
select
  carteira,
  coalesce(sum(valor) filter (where d = (now() at time zone 'America/Sao_Paulo')::date), 0)                  as total_hoje,
  coalesce(sum(valor) filter (where d = (now() at time zone 'America/Sao_Paulo')::date - 1), 0)              as total_ontem,
  coalesce(sum(valor) filter (where d >  (now() at time zone 'America/Sao_Paulo')::date - 7), 0)             as total_semana,
  coalesce(sum(valor) filter (where d >  (now() at time zone 'America/Sao_Paulo')::date - 15), 0)            as total_quinzena,
  coalesce(sum(valor) filter (where d >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date), 0) as total_mes,
  count(*) filter (where d = (now() at time zone 'America/Sao_Paulo')::date)                    as qtd_hoje,
  count(*) filter (where d = (now() at time zone 'America/Sao_Paulo')::date - 1)                as qtd_ontem,
  count(*) filter (where d >  (now() at time zone 'America/Sao_Paulo')::date - 7)               as qtd_semana,
  count(*) filter (where d >  (now() at time zone 'America/Sao_Paulo')::date - 15)              as qtd_quinzena,
  count(*) filter (where d >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date) as qtd_mes
from f
group by carteira;

grant select on vw_vendas_totais to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Vendas do mês por cliente WinThor (para os cards sintéticos). 1 linha por codcli.
-- ---------------------------------------------------------------------------
create or replace view vw_vendas_mes_cliente as
select
  f.codcli,
  max(wc.nome)                                                                                 as nome,
  max(wc.telefone)                                                                             as telefone,
  case max(wc.rca_num) when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end   as carteira,
  max(v.cliente_id)                                                                            as cliente_id_vinculo,
  sum(f.valor)                                                                                 as valor_mes,
  max(f.data_fat)                                                                              as data_fat
from wth_faturamento f
join wth_carteira wc on wc.codcli = f.codcli and wc.rca_num in (45, 46, 51)
left join wth_vinculo v on v.codcli = f.codcli
where f.tipo = 'VENDA' and f.posicao like 'F%'
  and f.data_fat >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
group by f.codcli, wc.rca_num;

grant select on vw_vendas_mes_cliente to anon, authenticated;

-- ---------------------------------------------------------------------------
-- vw_funil: adiciona o 3º branch (vendas sem conversa). Branches 1 e 2 = migration 0006.
-- ---------------------------------------------------------------------------
create or replace view vw_funil as
select
  c.id                as cliente_id,
  c.nome_completo      as cliente,
  c.carteira           as vendedor,
  ult.criada_em        as ultima_atividade,
  ult.conteudo         as ultima_mensagem,
  ult.enviada_por      as ultima_enviada_por,
  case
    when nf.data_fat is not null
      and ult.enviada_por = 'customer'
      and (ult.criada_em at time zone 'America/Sao_Paulo')::date > nf.data_fat
      then 'negociacao'
    when nf.data_fat is not null and ult.enviada_por = 'operator' and ult.tipo = 'template'
      and (ult.criada_em at time zone 'America/Sao_Paulo')::date > nf.data_fat
      then 'tentativa_contato'
    when nf.data_fat is not null
      then 'pedido_emitido'
    when ult.enviada_por = 'operator'
      and (ult.conteudo ilike '%*pedido faturado%' or ult.conteudo ilike '%*pedido finalizado%')
      and (ult.criada_em at time zone 'America/Sao_Paulo')::date
          >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
      then 'pedido_emitido'
    when ult.enviada_por = 'operator' and ult.tipo = 'template'
      then 'tentativa_contato'
    when ult.enviada_por = 'customer' and ult.criada_em < now() - interval '24 hours'
      then 'ociosos'
    when ult.enviada_por = 'operator'
      and (ult.conteudo ilike '%*pedido faturado%' or ult.conteudo ilike '%*pedido finalizado%')
      then 'ociosos'
    else 'negociacao'
  end                  as etapa,
  c.telefone           as telefone,
  msgs3.msgs           as ultimas_mensagens,
  nf.valor_mes         as venda_valor,
  nf.data_fat          as venda_data
from clientes c
join lateral (
  select m.criada_em, m.conteudo, m.enviada_por, m.tipo
  from mensagens m
  where m.cliente_id = c.id and m.tipo <> 'evento_sistema'
  order by m.criada_em desc
  limit 1
) ult on true
left join (
  select cliente_id, sum(valor) as valor_mes, max(data_fat) as data_fat
  from vw_pedido_emitido where mes = true group by cliente_id
) nf on nf.cliente_id = c.id
left join lateral (
  select jsonb_agg(jsonb_build_object('c', sub.conteudo, 'e', sub.enviada_por, 't', sub.criada_em) order by sub.criada_em desc) as msgs
  from (
    select m2.conteudo, m2.enviada_por, m2.criada_em
    from mensagens m2
    where m2.cliente_id = c.id and m2.tipo <> 'evento_sistema'
    order by m2.criada_em desc limit 3
  ) sub
) msgs3 on true
where exists (
  select 1 from mensagens x
  where x.cliente_id = c.id and x.enviada_por = 'operator' and x.tipo <> 'evento_sistema'
)

union all

select
  'winthor:' || fp.codcli::text, fp.nome,
  case fp.rca_num when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end,
  null::timestamptz, null::text, null::text, 'ociosos', fp.telefone, null::jsonb, null::numeric, null::date
from vw_fila_prospeccao fp
where fp.rca_num in (45, 46, 51)
  and not exists (select 1 from clientes c2 where c2.telefone like '%' || right(fp.telefone, 8))

union all

-- 3º branch: venda WinThor de cliente SEM vínculo a contato (sem conversa no RD).
-- ultima_atividade = data da nota (pra o filtro de período por venda funcionar).
select
  'venda:' || vm.codcli::text, vm.nome, vm.carteira,
  vm.data_fat::timestamptz, null::text, null::text, 'pedido_emitido', vm.telefone,
  null::jsonb, vm.valor_mes, vm.data_fat
from vw_vendas_mes_cliente vm
where vm.cliente_id_vinculo is null;
