-- =============================================================================
-- 0081 · Chat P1 — transferência de conversa e busca no conteúdo
--
-- Fecha os dois últimos itens do P1 (CLAUDE.md §18).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Transferência de conversa entre vendedores, COM REGISTRO
--
-- ⚠️ Transferir uma conversa NÃO é mudar a carteira do cliente. São coisas
-- diferentes e confundi-las quebraria o resto do sistema:
--   · carteira do cliente -> quem é o dono comercial. Fonte da verdade é o RCA
--     do WinThor via wth_vinculo (§10.3); `clientes.carteira` é espelho escrito
--     pelo ETL e seria sobrescrito no próximo upsert (§10.11).
--   · transferência de conversa (esta tabela) -> quem ATENDE este diálogo agora.
--     É decisão de operação, vale só dentro do chat, e não toca em nada do ERP.
-- É o mesmo recorte que o RD Conversas faz entre "carteira" e "transferir
-- atendimento", e a razão de a tabela ser nossa em vez de um update em `clientes`.
--
-- Tabela APPEND-ONLY: cada transferência é uma linha nova, nunca um update. O
-- "registro" pedido no P1 é justamente o histórico — quem passou para quem,
-- quando e por quê. Devolver a conversa é só mais uma linha no sentido inverso.
-- ---------------------------------------------------------------------------
create table if not exists chat_transferencia (
  id            bigint generated always as identity primary key,
  cliente_id    text not null,
  de_carteira   text,              -- dono efetivo no momento (null = não tinha)
  para_carteira text not null,     -- slug de carteira_config (validado na rota)
  por           text not null,     -- quem executou (e-mail da sessão)
  observacao    text,
  criada_em     timestamptz not null default now()
);

create index if not exists idx_chat_transf_cliente
  on chat_transferencia (cliente_id, criada_em desc);

alter table chat_transferencia enable row level security;

-- Atribuição vigente = a última linha de cada conversa. View em vez de coluna
-- de estado para não haver duas verdades: o estado É o fim do histórico.
create or replace view vw_chat_atribuicao as
select distinct on (cliente_id)
  cliente_id,
  para_carteira,
  de_carteira,
  por,
  observacao,
  criada_em
from chat_transferencia
order by cliente_id, criada_em desc, id desc;

-- ---------------------------------------------------------------------------
-- 2) Busca no conteúdo das mensagens
--
-- Trigrama (pg_trgm + GIN) em vez de full-text (tsvector) de propósito: quem
-- procura numa conversa digita pedaço de palavra, nome de produto abreviado e
-- erro de digitação — casos em que o ILIKE '%termo%' acerta e o stemming do
-- to_tsvector('portuguese') erra. O custo é exigir 3+ caracteres para o índice
-- valer (a rota impõe esse mínimo).
--
-- Custo de escrita: o ETL faz UPSERT em lotes de 500 em `mensagens`. GIN tem
-- `fastupdate` ligado por padrão, então a inserção vai para uma lista pendente e
-- só depois é mesclada — o impacto no lote é pequeno. Se algum dia o ETL ficar
-- mais lento logo após esta migration, este índice é o primeiro suspeito.
-- Hoje: 72.087 mensagens, 34 MB de tabela.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists idx_mensagens_conteudo_trgm
  on mensagens using gin (conteudo gin_trgm_ops)
  where conteudo is not null;
