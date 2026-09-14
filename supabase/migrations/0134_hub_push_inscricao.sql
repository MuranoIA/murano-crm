-- =============================================================================
-- 0134 · Push do HUB — a inscrição que o Pulse não consegue fazer sozinho
--
-- A 0096 já guarda inscrições de Web Push do chat (`chat_push_inscricao`) e
-- elas funcionam: duas ativas, entregues hoje. Só que ambas são de quem abre
-- `crm.muranoprofessional.com.br` DIRETO. Quem trabalha dentro do hub nunca
-- conseguiu ativar, e não por falta de botão.
--
-- ⚠️ O MOTIVO, MEDIDO EM 14/09/2026, não deduzido:
--
--   contexto                        Notification.permission ANTES de pedir
--   ------------------------------  -------------------------------------
--   topo, sem iframe                default   (dá para perguntar)
--   iframe de MESMA origem          default   (dá para perguntar)
--   iframe CROSS-ORIGIN             denied    <- o caso do hub
--
-- O hub é `app.muranoprofessional.com.br` e o Pulse é
-- `crm.muranoprofessional.com.br`: origens diferentes. Num iframe assim o
-- navegador já reporta `denied` antes de qualquer pergunta, e `requestPermission`
-- devolve sem nunca mostrar prompt. Não há `allow=` que conserte — notificação
-- não é recurso delegável por Permissions Policy, ao contrário do microfone
-- (§22.5). Logo, a INSCRIÇÃO tem de nascer no documento de topo, que é o hub.
--
-- E uma armadilha junto, para ninguém cair nela: no mesmo instante em que
-- `Notification.permission` dizia `denied`, `navigator.permissions.query`
-- respondeu `prompt`. Código que confiar na Permissions API vai concluir que
-- pode perguntar, pedir, receber `default` e tentar para sempre, sem prompt
-- nenhum aparecer. A régua é `Notification.permission`.
--
-- POR QUE TABELA NOVA, E NÃO UMA COLUNA NA 0096. São inscrições de ORIGENS
-- diferentes, com ciclos de vida diferentes: o service worker é outro, o
-- endpoint é outro, e revogar a permissão no hub não diz nada sobre a do
-- Pulse. Misturar as duas numa tabela só faria toda consulta carregar um
-- `where origem = ...` que ninguém lembraria de escrever — e o erro apareceria
-- como notificação entregue à origem errada, que falha em silêncio.
--
-- O hub mora no MESMO projeto Supabase que o CRM (`wtunzezigncwjpcqsfzk`,
-- conferido no `.env.local` dos dois). É isso que permite o desenho simples:
-- quem ENTREGA continua sendo o webhook do WhatsApp, do lado do CRM, que é o
-- único lugar que sabe que uma cliente falou. O hub só registra a inscrição.
-- Nenhuma chamada entre serviços, nenhuma segunda regra de "quem avisar".
-- =============================================================================

create table if not exists hub_push_inscricao (
  id           bigserial primary key,

  -- quem se inscreveu: o e-mail do Supabase Auth do hub. É a mesma chave que
  -- `chat_push_inscricao.usuario` e a mesma que `acesso.email` — o que permite
  -- reusar `destinatarios()` do CRM sem tradução nenhuma.
  usuario      text        not null,

  -- endereço da inscrição no servidor de push do fabricante. ÚNICO pelo motivo
  -- da 0096: o mesmo navegador que se re-inscreve devolve o mesmo endpoint e
  -- precisa ATUALIZAR a linha, senão a pessoa recebe tudo em duplicata.
  endpoint     text        not null unique,

  -- chaves públicas do navegador; sem elas a carga não pode ser cifrada (RFC 8291)
  p256dh       text        not null,
  auth         text        not null,

  aparelho     text,

  -- De qual módulo do hub é este aviso. Nasce 'pulse' porque é o primeiro, e
  -- existe para o próximo não precisar de tabela nova: a inscrição do navegador
  -- é uma só por pessoa/aparelho, o que varia é quem manda.
  modulo       text        not null default 'pulse',

  -- ---- o batimento que decide se vale notificar --------------------------
  -- A regra de negócio é "só avisa quando a aba do hub NÃO está em foco". Quem
  -- sabe disso é o navegador, não o servidor — então a aba carimba aqui
  -- enquanto está à frente, e a entrega pula quem carimbou agora há pouco.
  --
  -- É `visto_em` e não um booleano `focada` de propósito: booleano depende de
  -- alguém escrever `false` ao sair, e a aba fechada por engano, o notebook que
  -- dorme ou a queda de rede deixariam o registro preso em "focada para sempre"
  -- — e a pessoa pararia de receber aviso sem nunca entender por quê. Um
  -- carimbo vence sozinho.
  visto_em     timestamptz,

  criada_em    timestamptz not null default now(),
  usada_em     timestamptz
);

create index if not exists idx_hub_push_usuario on hub_push_inscricao (usuario);

comment on table hub_push_inscricao is
  'Inscrições de Web Push registradas no HUB (app.muranoprofessional.com.br), '
  'uma por navegador/aparelho. Existem separadas de chat_push_inscricao porque '
  'são de outra ORIGEM: outro service worker, outro endpoint, outra permissão. '
  'Em iframe cross-origin o navegador recusa a permissão de notificação antes '
  'de perguntar (medido em 14/09/2026), então a inscrição do time só pode '
  'nascer no documento de topo. `visto_em` é o batimento da aba em foco: a '
  'entrega pula quem carimbou há pouco, porque quem está olhando a tela não '
  'precisa de notificação.';

-- RLS ligado sem policy: anon e authenticated não leem linha nenhuma;
-- service_role e o dono passam. Mesmo padrão da 0096 e das tabelas fechadas
-- em 03/08 (§12.5). As duas pontas que tocam nisto — a rota do hub e a
-- entrega do CRM — usam service_role.
alter table hub_push_inscricao enable row level security;
grant select on hub_push_inscricao to service_role;
