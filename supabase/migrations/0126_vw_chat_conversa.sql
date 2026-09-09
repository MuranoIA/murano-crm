-- 0126 — vw_chat_conversa: a lista do chat deixa de ser derivada do board
--
-- PROBLEMA (medido em 09/09/2026, produção)
-- ---------------------------------------------------------------------------
-- `/api/chat` é a rota mais chamada do sistema: roda a cada 60 s em TODA aba
-- aberta, mais uma recarga coalescida a cada mensagem que chega. Ela lia a
-- `vw_funil_visivel` — a view do BOARD — e pagava por três coisas que o chat
-- não usa:
--
--   1. o ramo de PROSPECÇÃO (~3.800 linhas vindas de `wth_carteira`, com vários
--      NOT EXISTS sobre `mensagens` e `clientes`). O chat descarta todas: elas
--      têm `ultima_atividade` nula.
--   2. o ramo 1b (ociosos sem cadastro), pelo mesmo motivo.
--   3. dentro do ramo de conversas: `ultimas_mensagens` (um jsonb_agg das 3
--      últimas mensagens por cliente), `venda_valor`/`venda_data` (join com
--      `vw_vendas_mes_cliente`) e `sem_cadastro` (subconsultas correlacionadas
--      que varrem `wth_carteira` inteira por `nome_norm`). Nada disso é lido
--      pela lista do chat.
--
-- Além disso a `vw_funil_visivel` tem um `WHERE EXISTS (select 1 from mensagens
-- ...)` que é REDUNDANTE com o `JOIN LATERAL ... LIMIT 1` logo acima — o join
-- interno já exclui quem não tem mensagem visível. No plano, esse EXISTS
-- sozinho varria 144.683 linhas de `mensagens`.
--
-- Medição da consulta que o /api/chat faz (EXPLAIN ANALYZE, mesma máquina,
-- mesmo dado, 307 linhas de resultado nos dois casos):
--
--     vw_funil_visivel   647 ms   206.498 buffers
--     vw_chat_conversa   234 ms     7.214 buffers     <- esta view
--
-- 29x menos tráfego de buffers. Com 7 consultores e várias abas, essa conta era
-- refeita dezenas de vezes por minuto.
--
-- ---------------------------------------------------------------------------
-- POR QUE VIEW NOVA E NÃO ALTERAR A `vw_funil_visivel`
--
-- O BOARD precisa dos três ramos e das colunas extras — é ele que desenha os
-- cards de prospecção e o valor faturado. As duas telas fazem perguntas
-- diferentes:
--
--     board  -> "todo cliente da carteira, tenha conversa ou não"
--     chat   -> "quem tem conversa"
--
-- Forçar uma view só a servir as duas é o que criou o desperdício. A
-- `vw_funil_visivel` fica intacta; `/api/funil` não é tocado por esta migration.
--
-- ⚠️ EQUIVALÊNCIA VERIFICADA antes de aplicar, com EXCEPT nos dois sentidos
-- contra a consulta que o /api/chat fazia:
--     linhas_nova 307 · linhas_velha 307 · so_na_nova 0 · so_na_velha 0
-- Se a régua de etapa mudar na `vw_funil_visivel`, ela precisa mudar aqui
-- junto — é a mesma duplicação consciente que a 0098 assumiu, e pelo mesmo
-- motivo.
--
-- ---------------------------------------------------------------------------
-- O QUE MUDOU DE FORMA, E POR QUÊ
--
-- A `vw_funil_visivel` parte de `clientes` e, PARA CADA UM dos 5.048, procura a
-- última mensagem visível — descartando ~4.740. Aqui o motor é invertido:
-- parte-se das MENSAGENS visíveis (poucas) e sobe-se para o cliente, com
-- DISTINCT ON. É a mesma resposta pelo caminho barato.
-- ---------------------------------------------------------------------------

create or replace view vw_chat_conversa as
with sel as (
  select coalesce(
    (select c.linhas_visiveis from crm_config c where c.id = 1),
    (select array_agg(l.phone_number_id) from chat_linha l where l.ativo)
  ) as linhas
),
ult as (
  -- última mensagem visível de cada conversa, num passe só
  select distinct on (m.cliente_id)
         m.cliente_id, m.criada_em, m.conteudo, m.enviada_por, m.tipo
  from mensagens m
  cross join sel
  where m.tipo <> 'evento_sistema'
    -- `coalesce(linha_id,'rd')` é a mesma expressão da vw_funil_visivel: a
    -- conversa do RD não tem linha_id (o conceito nasceu no webhook da Meta),
    -- então ela responde pelo id sintético 'rd' (§23.4).
    and coalesce(m.linha_id, 'rd') = any(sel.linhas)
  order by m.cliente_id, m.criada_em desc
)
select
  c.id                                   as cliente_id,
  -- o WinThor manda no nome quando o cliente existe lá (§46 / 0108)
  coalesce(wcar.nome, c.nome_completo)   as cliente,
  case
    when (select cfg.carteira_rd_ativa from crm_config cfg where cfg.id = 1) is false
      then ccr.slug
    else coalesce(ccr.slug, c.carteira)
  end                                    as vendedor,
  ult.criada_em                          as ultima_atividade,
  ult.conteudo                           as ultima_mensagem,
  ult.enviada_por                        as ultima_enviada_por,
  case
    when ult.enviada_por = 'operator'
     and (ult.conteudo ilike '%*pedido faturado%' or ult.conteudo ilike '%*pedido finalizado%')
     and (ult.criada_em at time zone 'America/Sao_Paulo')::date
         >= (date_trunc('month', now() at time zone 'America/Sao_Paulo'))::date
      then 'pedido_emitido'
    when ult.enviada_por = 'operator' and ult.tipo = 'template'
      then 'tentativa_contato'
    when ult.criada_em < now() - interval '24 hours'
      then 'ociosos'
    else 'negociacao'
  end                                    as etapa,
  c.telefone,
  vln.codcli
from ult
join clientes c              on c.id = ult.cliente_id
left join wth_vinculo vln    on vln.cliente_id = c.id
left join wth_carteira wcar  on wcar.codcli = vln.codcli
left join carteira_config ccr on ccr.rca_num = wcar.rca_num and ccr.ativo;

comment on view vw_chat_conversa is
  'Lista de conversas do /chat. Só clientes COM mensagem visível — sem os ramos de prospecção/ociosos e sem as colunas que só o board usa. Ver 0126.';
