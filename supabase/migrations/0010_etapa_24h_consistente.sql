-- =============================================================================
-- Corrige a etapa pra bater com os subtítulos: negociação = SÓ ativo nas últimas
-- 24h; qualquer conversa parada >24h (sem venda/template) -> ociosos.
--
-- Bug anterior (0008): a regra "cliente re-engajou depois de comprar -> negociação"
-- não checava as 24h, então re-engajamento antigo (ex: Rayane, cliente falou
-- 08/07 depois de comprar) ficava preso em negociação por semanas. E operador-por-
-- último parado (não-template) também caía no "senão" -> negociação.
--
-- Nova lógica (main branch), em ordem:
--   1. venda do mês é o evento mais recente (nenhuma msg depois) -> pedido_emitido
--   2. palavra-chave de venda no mês (operador por último)        -> pedido_emitido
--   3. operador mandou TEMPLATE por último                        -> tentativa_contato
--   4. parado > 24h (qualquer lado)                               -> ociosos
--   5. ativo nas últimas 24h                                      -> negociacao
-- =============================================================================
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

select
  'venda:' || vm.codcli::text, vm.nome, vm.carteira,
  vm.data_fat::timestamptz, null::text, null::text, 'pedido_emitido', vm.telefone,
  null::jsonb, vm.valor_mes, vm.data_fat
from vw_vendas_mes_cliente vm
where vm.cliente_id_vinculo is null;
