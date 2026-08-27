-- =============================================================================
-- 0112 · Devolver a conversa para a fila de não atribuídos.
--
-- O buraco: qualquer pessoa pega uma conversa da fila com um clique (✋ Pegar,
-- §21), e **não existe saída** se pegar a errada. É o erro mais provável do
-- desenho — a fila é de todos, o botão é grande, e desfazer só via admin.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA COLUNA ANULÁVEL, E NÃO UMA LINHA APAGADA
--
-- `chat_transferencia` é append-only de propósito (§18): o histórico de quem
-- pegou e quem passou adiante é o que responde "por que esta conversa está
-- comigo?" três semanas depois. Apagar a linha do "pegar" devolveria a conversa
-- à fila e **apagaria junto o registro de que alguém a pegou por engano** —
-- exatamente o que se quer poder auditar.
--
-- Então devolver é mais uma LINHA, com destino nulo. `para_carteira` deixa de
-- ser obrigatório, e nulo passa a significar "de volta para a fila".
--
-- ---------------------------------------------------------------------------
-- ⚠️ A MUDANÇA DE VERDADE ESTÁ NO `donoEfetivo`, NÃO AQUI
--
-- A régua era:
--
--     atrib.get(id)?.para  ??  vendedorDoFunil  ??  null
--
-- Com uma linha de destino nulo, `?.para` é null e o `??` **cai para o
-- vendedorDoFunil** — ou seja, devolver traria de volta o dono da carteira, não
-- a fila. O nulo precisa VENCER quando existe uma transferência:
--
--     se há transferência -> vale o `para` dela, mesmo nulo
--     senão               -> a carteira do cliente
--
-- É a mesma armadilha do `??` da §22.6.1: um valor "vazio" que deveria decidir,
-- e que o operador de coalescência descarta em silêncio.
--
-- ---------------------------------------------------------------------------
-- QUEM PODE DEVOLVER
--
-- Só conversa **sem dono comercial** (sem carteira/RCA). Se o cliente tem
-- carteira, ele tem dono natural: "devolver" ali criaria um cliente órfão que
-- ninguém procura, e o certo é transferir para alguém. A rota recusa com 422 e
-- diz isso.
-- =============================================================================

alter table chat_transferencia
  alter column para_carteira drop not null;

comment on column chat_transferencia.para_carteira is
  'Slug de carteira_config que passa a atender a conversa. NULO = devolvida para a '
  'fila de não atribuídos (0112). Nulo VENCE a carteira do cliente em donoEfetivo() -- '
  'senão devolver traria de volta o dono comercial em vez da fila.';
