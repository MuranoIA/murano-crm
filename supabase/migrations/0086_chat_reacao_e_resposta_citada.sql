-- =============================================================================
-- 0086 · Chat P2 — reações e resposta citada
-- (JÁ APLICADA no murano-conversas em 16/08/2026)
--
-- REAÇÃO NÃO É MENSAGEM. Até aqui um 👍 da cliente entrava como linha nova em
-- `mensagens` ("[reação] 👍"), com dois efeitos colaterais silenciosos:
--   · virava "a última mensagem" da conversa — mexendo na etapa do card no
--     funil (§11.1) e no preview da lista. Um polegar levantado movia o
--     cliente para "negociação";
--   · contava como fala do cliente no indicador de tempo de resposta (0084),
--     abrindo uma "espera" que ninguém precisava responder e piorando o número
--     do vendedor sem motivo.
-- Passa a ser ATRIBUTO da mensagem reagida, como no WhatsApp. O webhook grava
-- NULL quando a cliente desfaz a reação (a Meta manda emoji vazio).
--
-- RESPOSTA CITADA: `is_reply` já dizia QUE era resposta, mas não A QUÊ. Sem o
-- alvo não dá para mostrar o trecho citado — que é justamente o que dá sentido
-- à mensagem quando a conversa tem vários assuntos ao mesmo tempo.
-- =============================================================================
alter table mensagens add column if not exists reacao     text;
alter table mensagens add column if not exists resposta_a text;

comment on column mensagens.reacao is
  'Emoji com que o cliente reagiu A ESTA mensagem (WhatsApp). NULL = sem reação. '
  'String vazia chega quando a reação é removida — o webhook grava NULL nesse caso.';
comment on column mensagens.resposta_a is
  'wamid da mensagem citada, quando esta é uma resposta a outra (context.id do webhook). '
  'NULL na maioria. `is_reply` continua indicando apenas QUE é resposta.';

-- índice só onde há citação: a coluna é esparsa
create index if not exists idx_msg_resposta_a on mensagens (resposta_a) where resposta_a is not null;
