-- =============================================================================
-- Corrige vw_funil: etapa "negociacao" ficava travada pra sempre depois da
-- PRIMEIRA resposta do cliente (bool_or em toda a historia), mesmo que a
-- conversa tivesse esfriado ha semanas e a ultima acao fosse um template de
-- reengajamento. Regra de negocio real (WhatsApp so permite mensagem livre
-- dentro de 24h; passado isso, so template):
--   ultima mensagem real = operador + template  -> tentativa_contato
--     (aguardando a PRIMEIRA resposta a ESSE disparo, nao importa o passado)
--   ultima mensagem real = cliente, OU operador fora de template
--     (troca dentro da janela ativa)           -> negociacao
--   pedido faturado/finalizado continua permanente (nao muda com este fix)
--
-- Tambem corrige a deteccao de venda: a equipe usa tanto "*pedido faturado*"
-- quanto "*pedido finalizado*" na pratica (confirmado nas mensagens reais);
-- so o primeiro era reconhecido, casos com "finalizado" ficavam presos em
-- tentativa_contato/negociacao mesmo com a venda ja fechada (ex: cliente
-- S.S.B., 23/07).
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
    when pf.pedido_faturado
      or exists (select 1 from atendimentos a where a.cliente_id = c.id and a.tabulacao = 'venda_realizada')
      then 'pedido_emitido'
    when ult.enviada_por = 'operator' and ult.tipo = 'template'
      then 'tentativa_contato'
    else 'negociacao'
  end                  as etapa
from clientes c
join lateral (
  select m.criada_em, m.conteudo, m.enviada_por, m.tipo
  from mensagens m
  where m.cliente_id = c.id and m.tipo <> 'evento_sistema'
  order by m.criada_em desc
  limit 1
) ult on true
join lateral (
  select bool_or(
    m.enviada_por = 'operator'
    and (m.conteudo ilike '%*pedido faturado%' or m.conteudo ilike '%*pedido finalizado%')
  ) as pedido_faturado
  from mensagens m
  where m.cliente_id = c.id
) pf on true
where exists (
  select 1 from mensagens x
  where x.cliente_id = c.id and x.enviada_por = 'operator' and x.tipo <> 'evento_sistema'
);
