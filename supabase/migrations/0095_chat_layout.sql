-- =============================================================================
-- 0095 · Chat — qual desenho da tela está em vigor
--
-- Contexto: em 24/08/2026 o chat foi auditado e ganhou três direções de
-- redesenho em protótipo (`prototipos/`, laudo em `prototipos/laudo-ux-chat.md`).
-- Esta migration é o interruptor que decide qual delas a equipe usa — e o
-- registro de quem decidiu.
--
-- Filosofia de sempre (§14.1): configuração em TABELA, não em código. Trocar o
-- desenho vigente é um UPDATE, sem deploy — e, principalmente, VOLTAR ATRÁS é
-- um UPDATE. Um redesenho de tela de trabalho sem caminho de volta é um risco
-- que não precisa existir: 'original' é sempre um valor válido.
--
-- NASCE EM 'original' de propósito. Nenhum deploy troca a tela de sete pessoas
-- por efeito colateral; ligar é decisão de um admin, na tela do /admin.
--
-- ---------------------------------------------------------------------------
-- O que este banco NÃO sabe, e por que está certo assim
--
-- A tabela aceita os quatro nomes, mas **quais deles têm implementação de
-- verdade é fato do código, não do banco** — quem sabe se a Direção 2 existe é
-- o deploy que está no ar, não uma coluna. Por isso a lista de "implementado"
-- mora em `web/lib/chatLayout.ts`, e é a rota do /admin que recusa ativar um
-- desenho que ainda não foi construído. Duplicar isso aqui criaria duas
-- verdades que divergem no primeiro deploy.
--
-- Hoje, 24/08/2026: só 'original' está implementado. Os outros três existem
-- como protótipo e aparecem no /admin em avaliação, não selecionáveis.
-- =============================================================================

-- Os quatro nomes possíveis. CHECK e não texto livre porque este valor é lido
-- pelo /chat para escolher o que renderizar: um typo aplicado por SQL manual
-- deixaria a tela sem desenho nenhum para todo mundo ao mesmo tempo.
--   original     — a tela de hoje
--   continuidade — Direção 1: nada muda de lugar, o que faltava passa a aparecer
--   fila         — Direção 2: a lista vira ordem de serviço
--   balcao       — Direção 3: a unidade de trabalho é a cliente, não a conversa
create table if not exists chat_layout (
  id             int primary key default 1 check (id = 1),   -- linha única
  layout         text not null default 'original'
                   check (layout in ('original', 'continuidade', 'fila', 'balcao')),
  atualizado_por text,
  atualizado_em  timestamptz not null default now()
);
alter table chat_layout enable row level security;
insert into chat_layout (id) values (1) on conflict (id) do nothing;

comment on table chat_layout is
  'Desenho do /chat em vigor para TODOS os usuários (linha única, id=1). Nasce em '
  '"original". Quais valores têm implementação real é fato do código '
  '(web/lib/chatLayout.ts), não desta tabela — ver comentário da migration 0095.';

-- ---------------------------------------------------------------------------
-- Piloto por usuário: rodar o desenho novo na própria conta antes de impor a
-- todos.
--
-- Por que isto existe: trocar a tela de sete pessoas de uma vez, sem ninguém
-- ter usado, é o cenário em que um desenho bom morre por estranhamento. O
-- §21.4 do CLAUDE.md já defende o mesmo para o corte do RD — "o que os
-- vendedores reclamarem vale mais que qualquer item adivinhado numa lista".
--
-- Coluna em `acesso` e não tabela nova porque `acesso` É a tabela de
-- configuração por usuário deste sistema (papel, papéis, carteira) e não é
-- escrita por nenhum ETL — o risco da §10.11 (upsert apagando coluna nossa)
-- não se aplica aqui. Uma tabela à parte custaria um join em todo load do chat
-- para guardar um campo.
--
-- NULL = segue o global. É o estado da esmagadora maioria das linhas, e o
-- default certo: quem não foi escolhido para o piloto não deve ser afetado por
-- ele. Mesmo CHECK do global, mais o valor NULL.
alter table acesso add column if not exists chat_layout text
  check (chat_layout is null or chat_layout in ('original', 'continuidade', 'fila', 'balcao'));

comment on column acesso.chat_layout is
  'Piloto de desenho do /chat só para este e-mail. NULL = segue chat_layout global. '
  'Serve para testar um redesenho na própria conta antes de estabelecê-lo para todos.';

-- ---------------------------------------------------------------------------
-- Histórico: APPEND-ONLY, como `chat_transferencia` (0081) e
-- `carteira_transferencia` (0092).
--
-- O estado vigente já está nas duas colunas acima; esta tabela existe para a
-- pergunta que o estado não responde — quem trocou, quando, e o que estava
-- valendo antes. Numa decisão de produto tomada por um time, isso é o registro
-- que hoje viveria num grupo de WhatsApp e se perderia.
--
-- Guarda `de` além de `para` de propósito: reconstruir a sequência a partir de
-- linhas que só dizem o destino exige ordenar e olhar a anterior, o que quebra
-- silenciosamente se duas escritas caírem no mesmo instante.
create table if not exists chat_layout_historico (
  id        bigserial primary key,
  escopo    text        not null check (escopo in ('global', 'piloto')),
  -- e-mail alvo quando escopo='piloto'; NULL quando é a decisão global
  alvo      text,
  de        text,
  para      text        not null,
  por       text,
  criada_em timestamptz not null default now(),
  -- um piloto sem alvo não diz de quem é; um global com alvo sugere um recorte
  -- que a tabela não tem. Barrar aqui evita linha de histórico que ninguém
  -- consegue interpretar depois.
  check ((escopo = 'piloto' and alvo is not null) or (escopo = 'global' and alvo is null))
);
alter table chat_layout_historico enable row level security;

create index if not exists idx_chat_layout_hist_data on chat_layout_historico (criada_em desc);

comment on table chat_layout_historico is
  'Append-only: toda troca de desenho do /chat, global ou de piloto. O estado '
  'vigente NÃO se lê daqui (está em chat_layout e acesso.chat_layout) — esta '
  'tabela responde quem trocou, quando e o que valia antes.';

-- RLS ligado sem policy nas duas tabelas novas: anon e authenticated não leem
-- linha nenhuma, service_role e o dono passam. Mesmo padrão das wth_*, de
-- tickets e das 10 tabelas fechadas em 03/08 (§12.5).
grant select on chat_layout to service_role;
grant select on chat_layout_historico to service_role;
