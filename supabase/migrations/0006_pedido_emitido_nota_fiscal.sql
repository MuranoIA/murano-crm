-- =============================================================================
-- Pedido Emitido passa a vir da NOTA FISCAL real (vw_pedido_emitido), não mais
-- só da palavra-chave/tabulação. Fonte de verdade = faturamento WinThor.
--
-- Regras da etapa "pedido_emitido":
--   - cliente com nota faturada no MÊS corrente (vw_pedido_emitido.mes) -> pedido_emitido;
--   - EXCEÇÃO: se o cliente mandou mensagem DEPOIS da compra, re-engajou -> negociacao
--     (regra "cliente respondeu volta pra negociação"); se o vendedor mandou template
--     depois -> tentativa_contato (o template é a última msg, cai no case de template);
--   - palavra-chave "*pedido faturado/finalizado*" continua como sinal SECUNDÁRIO
--     (pega venda fechada no chat que ainda não faturou no WinThor);
--   - some sozinho no dia 1º (vw_pedido_emitido.mes zera no mês novo).
-- Tabulação venda_realizada SAI (quase sempre vazia; a nota cobre melhor).
--
-- Novas colunas (no FINAL, exigência do CREATE OR REPLACE VIEW):
--   venda_valor numeric  -> total faturado do cliente NO MÊS (R$), null se não comprou
--   venda_data  date     -> data da nota mais recente do mês, null se não comprou
-- =============================================================================
create or replace view vw_funil as
select
  c.id                as cliente_id,
  c.nome_completo      as cliente,
  c.carteira           as vendedor,
  ult.criada_em        as ultima_atividade,
  ult.conteudo         as ultima_mensagem,
  ult.enviada_por      as ultima_enviada_por,
  case
    -- comprou este mês e voltou a falar DEPOIS da compra -> re-engajou
    when nf.data_fat is not null
      and ult.enviada_por = 'customer'
      and (ult.criada_em at time zone 'America/Sao_Paulo')::date > nf.data_fat
      then 'negociacao'
    -- vendedor mandou template depois da compra -> tentativa (é a última msg)
    when nf.data_fat is not null and ult.enviada_por = 'operator' and ult.tipo = 'template'
      and (ult.criada_em at time zone 'America/Sao_Paulo')::date > nf.data_fat
      then 'tentativa_contato'
    -- vendeu este mês (nota fiscal) -> PEDIDO EMITIDO
    when nf.data_fat is not null
      then 'pedido_emitido'
    -- sinal secundário: palavra-chave de venda no mês (fechou no chat, nota ainda não veio)
    when ult.enviada_por = 'operator'
      and (ult.conteudo ilike '%*pedido faturado%' or ult.conteudo ilike '%*pedido finalizado%')
      and (ult.criada_em at time zone 'America/Sao_Paulo')::date
          >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
      then 'pedido_emitido'
    -- vendedor reagiu com template -> aguardando 1a resposta
    when ult.enviada_por = 'operator' and ult.tipo = 'template'
      then 'tentativa_contato'
    -- cliente falou por último e passou de 24h -> ocioso
    when ult.enviada_por = 'customer' and ult.criada_em < now() - interval '24 hours'
      then 'ociosos'
    -- palavra-chave de venda EXPIRADA (mês anterior) -> ocioso
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
  -- 1 linha por cliente que faturou no mês: total R$ e data da nota mais recente
  select cliente_id,
         sum(valor) as valor_mes,
         max(data_fat) as data_fat
  from vw_pedido_emitido
  where mes = true
  group by cliente_id
) nf on nf.cliente_id = c.id
left join lateral (
  select jsonb_agg(jsonb_build_object('c', sub.conteudo, 'e', sub.enviada_por, 't', sub.criada_em) order by sub.criada_em desc) as msgs
  from (
    select m2.conteudo, m2.enviada_por, m2.criada_em
    from mensagens m2
    where m2.cliente_id = c.id and m2.tipo <> 'evento_sistema'
    order by m2.criada_em desc
    limit 3
  ) sub
) msgs3 on true
where exists (
  select 1 from mensagens x
  where x.cliente_id = c.id and x.enviada_por = 'operator' and x.tipo <> 'evento_sistema'
)

union all

select
  'winthor:' || fp.codcli::text as cliente_id,
  fp.nome                       as cliente,
  case fp.rca_num when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end as vendedor,
  null::timestamptz             as ultima_atividade,
  null::text                    as ultima_mensagem,
  null::text                    as ultima_enviada_por,
  'ociosos'                     as etapa,
  fp.telefone                   as telefone,
  null::jsonb                   as ultimas_mensagens,
  null::numeric                 as venda_valor,
  null::date                    as venda_data
from vw_fila_prospeccao fp
where fp.rca_num in (45, 46, 51)
  and not exists (
    select 1 from clientes c2 where c2.telefone like '%' || right(fp.telefone, 8)
  );
