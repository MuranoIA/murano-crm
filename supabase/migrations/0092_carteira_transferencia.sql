-- =============================================================================
-- 0092 · Gestão de Carteira — histórico de transferências no RD Conversas
--
-- ⚠️ ISTO NÃO É `chat_transferencia` (migration 0081). As duas tabelas têm
-- colunas quase idênticas e significados opostos — confundi-las quebra o chat:
--
--   · chat_transferencia  -> quem ATENDE este diálogo agora. Lida por
--     `vw_chat_atribuicao` e por `lib/chatEscopo.ts` como "dono efetivo": é o
--     que decide em qual caixa a conversa aparece em /chat e /api/chat/buscar.
--     Gravar carteira ali faria conversas sumirem da caixa de um vendedor e
--     brotarem na de outro, e mexeria na fila de não atribuídos (§21).
--
--   · carteira_transferencia (esta) -> quem é o DONO COMERCIAL do contato no RD
--     Conversas. É o registro de uma escrita que aconteceu LÁ FORA, na API do
--     RD (`POST /v2/wallets`), não um estado que o CRM controla.
--
-- Append-only, como a 0081: o histórico É o registro pedido. O estado vigente
-- não sai daqui — sai de `clientes.carteira` (espelho) e, no fim das contas,
-- do `current_wallet` do RD, que é a fonte da verdade deste campo.
--
-- Por que existe `sucesso`/`erro`, que a 0081 não tem: aqui cada linha é uma
-- chamada de rede a um sistema de terceiro, num lote que pode falhar no meio.
-- Registrar só o que deu certo esconderia exatamente o caso que o supervisor
-- precisa ver — o cliente que ficou para trás no meio de uma transferência de
-- carteira inteira.
-- =============================================================================

create table if not exists carteira_transferencia (
  id            bigint generated always as identity primary key,
  cliente_id    text not null,
  de_carteira   text,             -- slug de origem (null = contato sem carteira)
  para_carteira text not null,    -- slug de destino, validado contra carteira_config
  por           text not null,    -- e-mail da sessão que executou
  observacao    text,
  sucesso       boolean not null default true,
  erro          text,             -- preenchido quando sucesso = false
  criada_em     timestamptz not null default now()
);

create index if not exists idx_carteira_transf_cliente
  on carteira_transferencia (cliente_id, criada_em desc);

create index if not exists idx_carteira_transf_data
  on carteira_transferencia (criada_em desc);

-- Mesmo padrão das outras tabelas deste banco (§12.5): RLS ligado SEM policy.
-- anon e authenticated não enxergam linha nenhuma; service_role (que é quem as
-- rotas /api/* usam) ignora RLS e continua lendo e escrevendo normalmente.
alter table carteira_transferencia enable row level security;

comment on table carteira_transferencia is
  'Histórico de transferências de CARTEIRA (dono comercial) feitas pelo CRM via POST /v2/wallets do RD Conversas. Não confundir com chat_transferencia, que é atendimento de conversa.';
