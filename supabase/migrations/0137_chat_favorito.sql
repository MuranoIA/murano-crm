-- =============================================================================
-- 0137 · Favoritar conversa — pedido da Anne Karoline (14/09/2026)
--
-- *"tem uma conversa que ela quer marcar para conversar mais tarde, então ela
-- quer colocar essa conversa em favoritos"*, e Favoritos vira uma lista ao lado
-- de Meus atendimentos, Minha carteira e Fila de espera.
--
-- ---------------------------------------------------------------------------
-- ⚠️ O FAVORITO É DE QUEM MARCOU, NÃO DA CONVERSA.
--
-- A chave é (usuario, cliente_id), e não `cliente_id` sozinho com uma coluna
-- `favorita`. Duas pessoas acompanham a mesma cliente por motivos diferentes —
-- a consultora que vai retomar a negociação de tarde e a supervisora que está
-- de olho no caso. Com uma marca só na conversa, a segunda a desmarcar apagaria
-- o lembrete da primeira, e ninguém entenderia por que o favorito sumiu.
--
-- É a mesma régua de `chat_leitura` (§18 P0): filas independentes, uma linha
-- por pessoa. Por isso esta tabela é a cópia dela em forma — mesma chave
-- composta, mesmo `usuario` em texto, e sem FK para `clientes`, como lá.
--
-- ---------------------------------------------------------------------------
-- POR QUE NÃO REUSAR `chat_conversa`
--
-- Aquela tabela guarda o estado do ATENDIMENTO (aberta/resolvida, motivo, quem
-- resolveu) — uma linha por conversa, compartilhada por todo mundo, e o webhook
-- escreve nela quando a cliente responde. Um favorito ali seria apagado por
-- quem encerrasse a conversa, e valeria para a equipe inteira. São coisas com
-- donos diferentes.
--
-- ---------------------------------------------------------------------------
-- `usuario` É O MESMO DE `chat_leitura`
--
-- E-mail no login Google, ou o valor da sessão no login por papel — o que
-- `usuarioDaSessao()` devolve. Não é `carteira`: quem atende sem carteira
-- (admin, home, pós-venda) também favorita, e uma marca por carteira juntaria
-- as duas pessoas do ISR numa lista só.
-- =============================================================================

create table if not exists chat_favorito (
  usuario     text        not null,
  cliente_id  text        not null,
  criado_em   timestamptz not null default now(),
  primary key (usuario, cliente_id)
);

-- A pergunta da tela é sempre "quais são os MEUS favoritos": o índice segue a
-- chave primária, que já começa por `usuario`, então não há índice a mais aqui.

comment on table chat_favorito is
  'Conversas que a pessoa marcou para retomar depois (0137). A marca é DE QUEM '
  'MARCOU: chave (usuario, cliente_id), como chat_leitura — duas pessoas podem '
  'favoritar a mesma cliente, e uma desmarcando não apaga a da outra. `usuario` '
  'é o mesmo valor de chat_leitura.usuario (o que usuarioDaSessao() devolve).';

-- RLS ligado sem policy: anon e authenticated não leem linha nenhuma;
-- service_role e o dono passam. Mesmo padrão das tabelas fechadas em 03/08
-- (§12.5) — quem lê e escreve aqui são as rotas do app, com service_role.
alter table chat_favorito enable row level security;
grant select on chat_favorito to service_role;
