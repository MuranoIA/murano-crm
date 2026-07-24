-- =============================================================================
-- Nova etapa "ociosos" no funil, à esquerda de tentativa_contato. Regras:
--
-- 1) Cliente respondeu, vendedor não respondeu dentro de 24h (janela do
--    WhatsApp fechou, só template reabre) -> ociosos.
-- 2) Clientes da carteira do vendedor (RCA oficial WinThor) que NUNCA tiveram
--    atendimento no RD Conversas -> ociosos (vêm de vw_fila_prospeccao, sem
--    cliente_id do RD; identidade sintética "winthor:<codcli>", só telefone
--    pra abrir WhatsApp direto, sem histórico de mensagem).
-- 3) "pedido_emitido" agora EXPIRA no início de cada mês (fuso America/Sao_Paulo):
--    só conta se o evento (texto "*pedido faturado/finalizado*" OU tabulação
--    venda_realizada) for o mais recente E tiver acontecido no mês corrente.
--    Se expirou e ninguém fez nada desde então -> ociosos (não "negociação" —
--    esse era o furo: sem esse case explícito a venda vencida caía no catch-all
--    de "operador falou por último" e virava negociação por engano).
--    Se depois da venda o cliente mandou mensagem nova -> negociação (regra
--    de recência já existente). Se o vendedor mandou template -> tentativa_contato.
--
-- Não duplica card: cada cliente do RD Conversas continua tendo exatamente
-- 1 linha (group/lateral por cliente_id, como antes) — a etapa só se move.
-- =============================================================================
-- IMPORTANTE: CREATE OR REPLACE VIEW só aceita ADICIONAR coluna no FINAL da
-- lista (ele casa colunas por posição, não por nome) — por isso "telefone"
-- vem depois de "etapa", não no meio, senão dá erro 42P16.
create or replace view vw_funil as
select
  c.id                as cliente_id,
  c.nome_completo      as cliente,
  c.carteira           as vendedor,
  ult.criada_em        as ultima_atividade,
  ult.conteudo         as ultima_mensagem,
  ult.enviada_por      as ultima_enviada_por,
  case
    -- venda por texto, dentro do mês corrente
    when ult.enviada_por = 'operator'
      and (ult.conteudo ilike '%*pedido faturado%' or ult.conteudo ilike '%*pedido finalizado%')
      and (ult.criada_em at time zone 'America/Sao_Paulo')::date
          >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
      then 'pedido_emitido'
    -- venda por tabulação, dentro do mês corrente, e mais recente que qualquer mensagem
    when venda.fechado_em is not null
      and venda.fechado_em >= ult.criada_em
      and (venda.fechado_em at time zone 'America/Sao_Paulo')::date
          >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
      then 'pedido_emitido'
    -- vendedor reagiu com template -> aguardando 1a resposta a ESSE disparo
    when ult.enviada_por = 'operator' and ult.tipo = 'template'
      then 'tentativa_contato'
    -- cliente falou por último e passou de 24h sem template novo -> ocioso
    when ult.enviada_por = 'customer' and ult.criada_em < now() - interval '24 hours'
      then 'ociosos'
    -- venda por texto EXPIRADA (mês anterior) e nada aconteceu depois -> ocioso
    when ult.enviada_por = 'operator'
      and (ult.conteudo ilike '%*pedido faturado%' or ult.conteudo ilike '%*pedido finalizado%')
      then 'ociosos'
    -- venda por tabulação EXPIRADA (mês anterior) e nada aconteceu depois -> ocioso
    when venda.fechado_em is not null and venda.fechado_em >= ult.criada_em
      then 'ociosos'
    else 'negociacao'
  end                  as etapa,
  c.telefone           as telefone
from clientes c
join lateral (
  select m.criada_em, m.conteudo, m.enviada_por, m.tipo
  from mensagens m
  where m.cliente_id = c.id and m.tipo <> 'evento_sistema'
  order by m.criada_em desc
  limit 1
) ult on true
left join lateral (
  select max(a.fechado_em) as fechado_em
  from atendimentos a
  where a.cliente_id = c.id and a.tabulacao = 'venda_realizada'
) venda on true
where exists (
  select 1 from mensagens x
  where x.cliente_id = c.id and x.enviada_por = 'operator' and x.tipo <> 'evento_sistema'
)

union all

-- clientes da carteira (RCA oficial) que nunca tiveram atendimento no RD Conversas
select
  'winthor:' || fp.codcli::text as cliente_id,
  fp.nome                       as cliente,
  case fp.rca_num when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end as vendedor,
  null::timestamptz             as ultima_atividade,
  null::text                    as ultima_mensagem,
  null::text                    as ultima_enviada_por,
  'ociosos'                     as etapa,
  fp.telefone                   as telefone
from vw_fila_prospeccao fp
where fp.rca_num in (45, 46, 51)
  and not exists (
    select 1 from clientes c2 where c2.telefone like '%' || right(fp.telefone, 8)
  );
