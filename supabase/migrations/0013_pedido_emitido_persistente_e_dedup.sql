-- =============================================================================
-- Dois ajustes na vw_funil:
--
-- (1) DEDUP: cliente que comprou (branch "venda:") não pode também aparecer no
--     branch de prospecção "winthor:" (ex: ANA KAROLINA aparecia em Ociosos E
--     Pedido Emitido). Prospecção passa a excluir quem está em vw_vendas_mes_cliente.
--
-- (2) PEDIDO EMITIDO PERSISTENTE: cliente que fez pedido no mês FICA em pedido_emitido
--     o mês inteiro — mesmo que comece nova conversa, receba template, fique inativo
--     ou esteja negociando de novo. Se fizer outro pedido, o valor só soma (já é o
--     v_mes). Sai só no dia 1º (quando vw_vendas_mes_cliente zera). Antes a regra
--     tirava da coluna se o cliente mandasse mensagem depois da compra.
--     -> primeira condição vira só "nf.data_fat is not null" (sem comparar com a msg).
-- =============================================================================
create or replace view vw_funil as
select
  c.id as cliente_id, c.nome_completo as cliente, c.carteira as vendedor,
  ult.criada_em as ultima_atividade, ult.conteudo as ultima_mensagem, ult.enviada_por as ultima_enviada_por,
  case
    -- comprou este mês -> pedido_emitido, ponto (fica o mês todo)
    when nf.data_fat is not null then 'pedido_emitido'
    -- venda por palavra-chave no mês (chat fechou, nota ainda não veio)
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
  and not exists (select 1 from vw_vendas_mes_cliente vm where vm.codcli = fp.codcli)

union all

select
  'venda:' || vm.codcli::text, vm.nome, vm.carteira,
  vm.data_fat::timestamptz, null::text, null::text, 'pedido_emitido', vm.telefone,
  null::jsonb, vm.valor_mes, vm.data_fat
from vw_vendas_mes_cliente vm
where vm.cliente_id_vinculo is null;
