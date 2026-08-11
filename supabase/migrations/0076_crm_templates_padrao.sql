-- =============================================================================
-- crm_templates não tinha migration própria (criada fora do histórico em algum
-- momento) — este arquivo primeiro a documenta (create table if not exists,
-- idempotente, não deve alterar nada se ela já existir com este shape) e depois
-- resolve o problema real: o "template padrão" do disparo em massa e do botão
-- do card dependia da env var TEMPLATE_RECONTATO_ID na Vercel. Isso é insustentável
-- com vários templates (uma env var por template, exige redeploy pra trocar) e
-- foi a causa direta do "template message not found" no disparo em massa: o ID
-- guardado na Vercel ficou desatualizado (o template foi editado/recriado no
-- painel do RD e trocou de id) e não havia como corrigir sem redeploy nem como
-- editar um template já cadastrado pela UI (só existia POST, sem PATCH/DELETE).
--
-- A partir daqui o "padrão" é uma coluna na própria tabela (fonte única, editável
-- pela UI, sem redeploy). Índice único parcial garante no máximo 1 padrão por vez.
-- =============================================================================

create table if not exists crm_templates (
  id             bigint generated always as identity primary key,
  nome           text not null,
  rd_template_id text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);

alter table crm_templates add column if not exists padrao boolean not null default false;

create unique index if not exists idx_crm_templates_um_padrao
  on crm_templates (padrao) where padrao;

-- mesmo padrão de RLS fechado (sem policy) já aplicado às outras tabelas do app
-- (seção 12.5 do CLAUDE.md) — o app só lê/escreve via service_role no server,
-- nenhum client-side usa a chave anon aqui.
alter table crm_templates enable row level security;
