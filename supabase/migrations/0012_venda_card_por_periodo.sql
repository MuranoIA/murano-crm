-- =============================================================================
-- Valor do card de venda acompanha o PERÍODO selecionado: soma das compras
-- (líquidas) do cliente naquele período. Ex: período=ontem -> só a compra de
-- ontem; período=mês -> soma do mês. Supersede a 0011 (que mostrava a última nota).
--
-- vw_vendas_mes_cliente passa a ter os 5 buckets por cliente (v_hoje/ontem/
-- semana/quinzena/mes, líquidos). valor_mes = v_mes (default p/ período "todos").
-- O front usa o bucket do período ativo e esconde card sem compra no período.
-- =============================================================================
create or replace view vw_vendas_mes_cliente as
with linhas as (
  select
    f.codcli,
    v.cliente_id as cliente_id_vinculo,
    wc.nome, wc.telefone, wc.rca_num, f.data_fat,
    (f.data_fat at time zone 'UTC')::date as d,
    case when f.tipo = 'VENDA' and f.posicao like 'F%' then f.valor
         when f.tipo = 'DEV' then -f.valor else 0 end as vliq,
    (f.tipo = 'VENDA' and f.posicao like 'F%') as eh_venda
  from wth_faturamento f
  join wth_carteira wc on wc.codcli = f.codcli and wc.rca_num in (45, 46, 51)
  left join wth_vinculo v on v.codcli = f.codcli
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

-- vw_funil: mesma estrutura da 0011; venda_valor = v_mes (mês, default). Os buckets
-- por período vão pro front via API (vw_vendas_mes_cliente), não pela vw_funil.
create or replace view vw_funil as
select
  c.id as cliente_id, c.nome_completo as cliente, c.carteira as vendedor,
  ult.criada_em as ultima_atividade, ult.conteudo as ultima_mensagem, ult.enviada_por as ultima_enviada_por,
  case
    when nf.data_fat is not null
      and (ult.criada_em at time zone 'America/Sao_Paulo')::date <= nf.data_fat
      then 'pedido_emitido'
    when ult.enviada_por = 'operator'
      and (ult.conteudo ilike '%*pedido faturado%' or ult.conteudo ilike '%*pedido finalizado%')
      and (ult.criada_em at time zone 'America/Sao_Paulo')::date
          >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
      then 'pedido_emitido'
    when ult.enviada_por = 'operator' and ult.tipo = 'template' then 'tentativa_contato'
    when ult.criada_em < now() - interval '24 hours' then 'ociosos'
    else 'negociacao'
  end as etapa,
  c.telefone as telefone, msgs3.msgs as ultimas_mensagens, nf.valor_mes as venda_valor, nf.data_fat as venda_data
from clientes c
join lateral (
  select m.criada_em, m.conteudo, m.enviada_por, m.tipo
  from mensagens m
  where m.cliente_id = c.id and m.tipo <> 'evento_sistema'
  order by m.criada_em desc limit 1
) ult on true
left join (
  select cliente_id_vinculo as cliente_id, valor_mes, data_fat
  from vw_vendas_mes_cliente where cliente_id_vinculo is not null
) nf on nf.cliente_id = c.id
left join lateral (
  select jsonb_agg(jsonb_build_object('c', sub.conteudo, 'e', sub.enviada_por, 't', sub.criada_em) order by sub.criada_em desc) as msgs
  from (
    select m2.conteudo, m2.enviada_por, m2.criada_em
    from mensagens m2 where m2.cliente_id = c.id and m2.tipo <> 'evento_sistema'
    order by m2.criada_em desc limit 3
  ) sub
) msgs3 on true
where exists (select 1 from mensagens x where x.cliente_id = c.id and x.enviada_por = 'operator' and x.tipo <> 'evento_sistema')

union all

select
  'winthor:' || fp.codcli::text, fp.nome,
  case fp.rca_num when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end,
  null::timestamptz, null::text, null::text, 'ociosos', fp.telefone, null::jsonb, null::numeric, null::date
from vw_fila_prospeccao fp
where fp.rca_num in (45, 46, 51)
  and not exists (select 1 from clientes c2 where c2.telefone like '%' || right(fp.telefone, 8))

union all

select
  'venda:' || vm.codcli::text, vm.nome, vm.carteira,
  vm.data_fat::timestamptz, null::text, null::text, 'pedido_emitido', vm.telefone,
  null::jsonb, vm.valor_mes, vm.data_fat
from vw_vendas_mes_cliente vm
where vm.cliente_id_vinculo is null;
