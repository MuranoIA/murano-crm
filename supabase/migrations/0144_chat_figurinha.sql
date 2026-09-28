-- ---------------------------------------------------------------------------
-- O PACOTE DE FIGURINHAS DO CHAT (pedido do dono, 28/09/2026)
--
-- Receber figurinha já funcionava (o webhook baixa e guarda no bucket
-- `wa-midia`, com `midia_tipo = 'sticker'`). Faltavam as duas pontas do uso
-- real: SALVAR a que chegou e MANDAR de novo, sem sair do CRM.
--
-- Esta tabela é o pacote. O ARQUIVO continua no bucket `wa-midia` — aqui só
-- mora o caminho dele, como em `mensagens.midia_path`. Copiar o arquivo para
-- um caminho próprio (em vez de apontar para o da mensagem) é de propósito:
-- mensagem pode ser apagada, e um pacote que perde figurinha quando alguém
-- limpa uma conversa seria pior que não ter pacote.
--
-- ALCANCE, igual ao das respostas rápidas (0082):
--   · `carteira IS NULL`  → DA CASA: todo mundo vê e envia;
--   · `carteira = <slug>` → pessoal daquele consultor.
-- Quem decide qual é o servidor, pela sessão — vendedor salva a sua, admin e
-- home salvam a da casa.
--
-- RLS ligado SEM policy: o mesmo padrão das outras tabelas deste banco (§12.5).
-- Só `service_role` (as rotas) enxerga; `anon` e `authenticated` não leem nada.
-- ---------------------------------------------------------------------------

create table if not exists chat_figurinha (
  id          bigserial primary key,
  -- caminho no bucket `wa-midia` (privado). Único: salvar a mesma figurinha
  -- duas vezes é engano de clique, não intenção.
  caminho     text not null unique,
  mime        text not null default 'image/webp',
  -- um apelido para procurar depois ("joinha", "obrigada"). Opcional: a
  -- figurinha se explica sozinha na grade.
  nome        text,
  carteira    text,
  criada_por  text not null,
  criada_em   timestamptz not null default now()
);

comment on table chat_figurinha is
  'Pacote de figurinhas do chat: caminho no bucket wa-midia. carteira NULL = da casa (0144).';

-- a grade abre pela mais recente, dentro do alcance de quem está olhando
create index if not exists idx_figurinha_alcance
  on chat_figurinha (carteira, criada_em desc);

alter table chat_figurinha enable row level security;

-- ---------------------------------------------------------------------------
-- A GUARDA: falha a transação se o que o comentário promete não se cumpriu.
-- Tabela de conteúdo aberta ao `anon` é o defeito que aparece semanas depois,
-- quando já não dá para saber desde quando estava assim (§12.5).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'chat_figurinha' and c.relrowsecurity
  ) then
    raise exception 'chat_figurinha sem RLS';
  end if;

  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_figurinha'
  ) then
    raise exception 'chat_figurinha ganhou policy: o padrao aqui e RLS sem policy (so service_role)';
  end if;
end $$;
