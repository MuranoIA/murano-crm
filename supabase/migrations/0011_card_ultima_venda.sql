-- =============================================================================
-- O card de venda passa a mostrar o valor da ÚLTIMA nota do mês (a que o vendedor
-- reconhece), não a SOMA do mês. Antes somava todas as compras do cliente:
--   Samara: 289,99 (23/07) + 25 (16/07) = 314,99 -> mostra 289,99
--   Emanuelle: última nota 304 (23/07) -> mostra 304
-- O TOTAL do mês (soma real, líquida) continua no cabeçalho (vw_vendas_totais).
--
-- Vale pros dois tipos de card: matched (via vínculo) e sintético (sem conversa).
-- =============================================================================
create or replace view vw_vendas_mes_cliente as
select
  f.codcli,
  max(wc.nome)                                                                               as nome,
  max(wc.telefone)                                                                           as telefone,
  case max(wc.rca_num) when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end as carteira,
  max(v.cliente_id)                                                                          as cliente_id_vinculo,
  -- valor da nota de VENDA mais recente do mês (não a soma)
  (array_agg(f.valor order by f.data_fat desc, f.num_nota desc))[1]                          as valor_mes,
  max(f.data_fat)                                                                            as data_fat
from wth_faturamento f
join wth_carteira wc on wc.codcli = f.codcli and wc.rca_num in (45, 46, 51)
left join wth_vinculo v on v.codcli = f.codcli
where f.tipo = 'VENDA' and f.posicao like 'F%'
  and f.data_fat >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
group by f.codcli, wc.rca_num;

grant select on vw_vendas_mes_cliente to anon, authenticated;

-- vw_funil: o valor/data de venda dos cards (matched E sintético) vem agora de
-- vw_vendas_mes_cliente (última nota), não mais de vw_pedido_emitido (que somava).
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
    when ult.enviada_por = 'operator' and ult.tipo = 'template'
      then 'tentativa_contato'
    when ult.criada_em < now() - interval '24 hours'
      then 'ociosos'
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

select
  'venda:' || vm.codcli::text, vm.nome, vm.carteira,
  vm.data_fat::timestamptz, null::text, null::text, 'pedido_emitido', vm.telefone,
  null::jsonb, vm.valor_mes, vm.data_fat
from vw_vendas_mes_cliente vm
where vm.cliente_id_vinculo is null;
