-- =============================================================================
-- 0079 · Chat P0 — fundação: mídia, não lidas e status da conversa
-- (JÁ APLICADA no murano-conversas em 12/08/2026, com o nome
--  `chat_p0_midia_leitura_status`)
--
-- ⚠️ CONVIVE com a 0077 (`midia jsonb`), do MESMO dia, que trata do outro canal:
--   · 0077 → mídia vinda do RD Conversas: metadados crus da API (file_path na
--            storage do RD). O arquivo ainda NÃO é baixado.
--   · 0079 (esta) → mídia do canal WhatsApp Cloud: o arquivo é baixado pelo
--            webhook e guardado no bucket `wa-midia`; as colunas midia_* apontam
--            para ele.
-- As duas são aditivas e independentes. Unificar a renderização das duas fontes
-- no chat é trabalho pendente (ver CLAUDE.md §18).
--
-- Três blocos independentes que sustentam os 5 itens do P0 (CLAUDE.md §18):
--   1) colunas de mídia em `mensagens` (o arquivo em si vai pro Storage)
--   2) `chat_leitura`  — marca de leitura POR USUÁRIO (não lidas / fila)
--   3) `chat_conversa` — status aberta/resolvida + motivo (a nossa tabulação)
--
-- RLS ligado sem policy nas tabelas novas: anon/authenticated não leem nada;
-- o app usa service_role server-side (mesmo padrão da migration de segurança).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Mídia em `mensagens`
-- O binário NÃO fica no banco: vai para o bucket `wa-midia` (privado) e aqui
-- guardamos só o caminho + metadados. `midia_id` é o id da Meta (expira em ~30
-- dias do lado deles, por isso baixamos na hora que o webhook chega).
-- ---------------------------------------------------------------------------
alter table mensagens add column if not exists midia_tipo text;   -- image|audio|video|document|sticker
alter table mensagens add column if not exists midia_path text;   -- caminho no bucket wa-midia
alter table mensagens add column if not exists midia_mime text;
alter table mensagens add column if not exists midia_nome text;   -- filename original (documento)
alter table mensagens add column if not exists midia_id   text;   -- media_id da Meta (auditoria)

create index if not exists idx_msg_midia on mensagens (midia_tipo) where midia_tipo is not null;

-- ---------------------------------------------------------------------------
-- 2) Marca de leitura por usuário
-- `usuario` = e-mail do login Google; para o login admin por senha (sem e-mail)
-- vale o valor do cookie de sessão. Uma linha por (usuário, conversa).
-- ---------------------------------------------------------------------------
create table if not exists chat_leitura (
  usuario    text        not null,
  cliente_id text        not null,
  lida_ate   timestamptz not null default now(),
  primary key (usuario, cliente_id)
);
alter table chat_leitura enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Status da conversa (aberta/resolvida) — substituto do "fechar atendimento"
-- do RD e fonte da nossa tabulação. Reabre sozinha quando o cliente responde
-- (o webhook faz o update).
-- ---------------------------------------------------------------------------
create table if not exists chat_conversa (
  cliente_id    text primary key,
  status        text not null default 'aberta' check (status in ('aberta','resolvida')),
  motivo        text,                      -- venda_realizada | tentativa_contato | follow_up | sem_interesse | outro
  observacao    text,
  resolvida_em  timestamptz,
  resolvida_por text,
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_chat_conversa_status on chat_conversa (status);
alter table chat_conversa enable row level security;

-- ---------------------------------------------------------------------------
-- Bucket privado da mídia (idempotente)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('wa-midia', 'wa-midia', false, 26214400)   -- 25 MB: teto de mídia do WhatsApp
on conflict (id) do nothing;
