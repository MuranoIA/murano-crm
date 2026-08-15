-- =============================================================================
-- 0080 · Chat P1 — respostas rápidas e notas internas
--
-- Duas ferramentas de atendimento que o painel do RD Conversas tem e o nosso
-- chat não tinha (CLAUDE.md §18, bloco P1).
--
-- ⚠️ NÃO confundir `chat_resposta_rapida` com `crm_templates` (migration 0076):
--   · crm_templates      -> TEMPLATE do WhatsApp: `nome` + `rd_template_id`, um
--                           cadastro aprovado na Meta/RD que REABRE a janela de
--                           24h. Não tem corpo de texto: o texto mora lá fora.
--   · chat_resposta_rapida (esta) -> TEXTO nosso, colado na caixa de envio pelo
--                           atalho `/`. Não reabre janela nenhuma, não passa por
--                           aprovação, e o vendedor edita antes de mandar.
-- São coisas diferentes com nomes parecidos — o §18 sugeria reaproveitar a
-- crm_templates como base e isso não se sustenta (ela não tem onde guardar o
-- corpo). Daí a tabela nova.
--
-- RLS ligado sem policy nas duas: anon/authenticated não leem nada; o app só
-- acessa via service_role no servidor (mesmo padrão da 0076 e da 0079).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Respostas rápidas — os textos que o vendedor repete o dia inteiro
--
-- `carteira` define o alcance:
--   null      -> resposta da CASA, visível para todo mundo (só admin/home criam)
--   '<slug>'  -> resposta pessoal daquele vendedor, invisível para os outros
-- O índice único usa coalesce(carteira,'*') para que o mesmo atalho possa
-- existir uma vez como global e uma vez por vendedor, sem colidir.
-- ---------------------------------------------------------------------------
create table if not exists chat_resposta_rapida (
  id            bigint generated always as identity primary key,
  atalho        text not null,        -- SEM a barra: "entrega", "pix", "catalogo"
  titulo        text not null,        -- rótulo curto mostrado na lista
  corpo         text not null,        -- o texto que vai pra caixa de envio
  carteira      text,                 -- null = da casa; slug = pessoal
  ativo         boolean not null default true,
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists idx_resposta_rapida_atalho
  on chat_resposta_rapida (lower(atalho), coalesce(carteira, '*'));

create index if not exists idx_resposta_rapida_carteira
  on chat_resposta_rapida (carteira) where ativo;

alter table chat_resposta_rapida enable row level security;

-- ---------------------------------------------------------------------------
-- 2) Notas internas — recado da equipe DENTRO da conversa, que o cliente nunca vê
--
-- Tabela separada de propósito, em vez de uma linha em `mensagens` com
-- tipo='nota': `mensagens` é espelho do que trafegou no WhatsApp, escrito por
-- UPSERT do ETL e do webhook. Nota interna ali correria risco de ser apagada
-- num re-fetch e poluiria contadores, views e a régua de "quem falou por último"
-- que decide a etapa do funil (§11.1). Mesmo raciocínio da §10.11.
--
-- Sem FK para `clientes`: acompanha a decisão já tomada em chat_leitura e
-- chat_conversa (0079), e evita quebrar em id sintético.
-- ---------------------------------------------------------------------------
create table if not exists chat_nota (
  id         bigint generated always as identity primary key,
  cliente_id text not null,
  autor      text not null,
  texto      text not null,
  criada_em  timestamptz not null default now()
);

create index if not exists idx_chat_nota_cliente
  on chat_nota (cliente_id, criada_em);

alter table chat_nota enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Sementes — três respostas da casa só para a tela não abrir vazia.
-- São EXEMPLOS genéricos: a equipe edita ou apaga pela própria tela. O `on
-- conflict do nothing` deixa a migration idempotente e nunca sobrescreve um
-- texto que a equipe já tenha ajustado.
-- ---------------------------------------------------------------------------
insert into chat_resposta_rapida (atalho, titulo, corpo, carteira, criado_por)
values
  ('bomdia', 'Saudação',
   'Bom dia! Aqui é da Murano Professional. Tudo bem com você?',
   null, 'migration 0080'),
  ('retorno', 'Retorno de contato',
   'Oi! Passando para retomar nosso contato. Posso te ajudar com alguma coisa hoje?',
   null, 'migration 0080'),
  ('obrigado', 'Agradecimento',
   'Obrigado pela preferência! Qualquer coisa é só chamar por aqui.',
   null, 'migration 0080')
on conflict do nothing;
