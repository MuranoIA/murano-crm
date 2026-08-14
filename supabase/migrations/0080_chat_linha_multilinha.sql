-- =============================================================================
-- 0080 · Multi-linha: de qual NÚMERO cada mensagem entrou/saiu
-- (JÁ APLICADA no murano-conversas em 13/08/2026)
--
-- Contexto: passamos a operar um SEGUNDO número. O oficial continua no RD (entra
-- pelo ETL); o novo entra pela Cloud API (webhook). O plano adiante é ter linhas
-- por vendedor além da central.
--
-- Por que agora: o `phone_number_id` só existe no evento do webhook, no instante
-- em que a mensagem chega. Se não gravarmos junto, NÃO HÁ COMO recuperar depois
-- por qual linha a conversa passou — o histórico nasce cego. A UI pode esperar;
-- a captura do dado, não.
--
-- `chat_linha` segue a filosofia de `carteira_config` (CLAUDE.md §14.1):
-- linha nova = 1 linha no banco, sem deploy.
-- =============================================================================

-- de qual linha a mensagem entrou (webhook) ou saiu (envio).
-- NULL = mensagem do RD Conversas (o ETL não tem esse conceito) ou anterior a esta migration.
alter table mensagens add column if not exists linha_id text;
create index if not exists idx_msg_linha on mensagens (linha_id) where linha_id is not null;

comment on column mensagens.linha_id is
  'phone_number_id da Meta: por qual número a mensagem entrou (webhook) ou saiu (envio). '
  'NULL em mensagens do RD Conversas e nas anteriores a 13/08/2026.';

-- catálogo das linhas: rótulo legível e dono opcional
create table if not exists chat_linha (
  phone_number_id text primary key,          -- id da Meta (não é o telefone)
  numero          text,                      -- E.164 legível, p/ conferência humana
  rotulo          text not null,             -- "Central", "Romulo", "Prospecção"...
  carteira        text,                      -- slug do vendedor dono, quando a linha for dele
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now()
);
alter table chat_linha enable row level security;

comment on table chat_linha is
  'Catálogo dos números (linhas) do WhatsApp Cloud. Adicionar linha = 1 INSERT, sem deploy. '
  'A linha diz por onde a conversa sai; o DONO do card continua sendo o RCA do WinThor.';
