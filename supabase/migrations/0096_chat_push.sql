-- =============================================================================
-- 0096 · Chat — notificação com o app FECHADO (Web Push)
--
-- O chat já avisa quem está com a aba aberta: bipe, contador no título e
-- Notification API (§18, P0). Isso cobre quem está trabalhando na tela e não
-- cobre o resto do dia — que é justamente quando a cliente escreve.
--
-- Esta migration guarda as INSCRIÇÕES de push. O endpoint que o navegador
-- devolve ao aceitar a permissão é um endereço no servidor do próprio
-- fabricante (FCM no Chrome, Mozilla autopush no Firefox, Apple no Safari); o
-- nosso servidor assina a mensagem com a chave VAPID e entrega ali. Por isso
-- não há nada nosso rodando no aparelho além do service worker.
--
-- Isto fecha a pendência que o hub registrou e recusou uma vez ("notificação
-- com o app fechado não existe", CLAUDE.md do murano-app, seção 16) — lá o
-- escopo escolhido foi avisar só quem está com a aba aberta. Aqui o app é de
-- atendimento e a aba fechada é o caso normal.
-- =============================================================================

create table if not exists chat_push_inscricao (
  id           bigserial primary key,
  -- quem se inscreveu: e-mail no login Google, ou o valor da sessão no login
  -- por papel. Mesma convenção de `chat_leitura.usuario` (§18 P0), para as
  -- duas tabelas responderem "de quem é isto" da mesma forma.
  usuario      text        not null,
  -- endereço da inscrição no servidor de push do fabricante. ÚNICO: o mesmo
  -- navegador que re-inscreve (troca de chave, reinstalação do app) devolve o
  -- mesmo endpoint, e precisa ATUALIZAR a linha em vez de criar outra — senão
  -- a pessoa recebe a mesma notificação duas, três vezes.
  endpoint     text        not null unique,
  -- chaves públicas do navegador: sem elas a mensagem não pode ser cifrada.
  -- A carga do push é criptografada ponta a ponta (RFC 8291) — o servidor do
  -- fabricante encaminha sem conseguir ler o conteúdo.
  p256dh       text        not null,
  auth         text        not null,
  -- para a pessoa reconhecer o aparelho numa lista ("Chrome no Android")
  aparelho     text,
  criada_em    timestamptz not null default now(),
  -- toda entrega bem-sucedida carimba aqui. Serve para limpar inscrição morta
  -- de aparelho trocado, que nunca devolve erro porque nunca é usada.
  usada_em     timestamptz
);

alter table chat_push_inscricao enable row level security;

create index if not exists idx_push_usuario on chat_push_inscricao (usuario);

comment on table chat_push_inscricao is
  'Inscrições de Web Push do chat, uma por navegador/aparelho. `endpoint` é '
  'único: re-inscrição atualiza a linha, senão a mesma notificação chega '
  'repetida. Entrega que volta 404/410 é apagada pela rota — inscrição morta '
  'não se conserta, só se remove.';

-- RLS ligado sem policy: anon e authenticated não leem linha nenhuma;
-- service_role e o dono passam. Mesmo padrão das wth_*, chat_layout e das 10
-- tabelas fechadas em 03/08 (§12.5).
grant select on chat_push_inscricao to service_role;
