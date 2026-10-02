-- =============================================================================
-- 0150 · o chat novo passa a ser o desenho de todos (demanda #57)
--
-- Decisão do dono (02/10/2026): "quero que chat-v2 seja o padrão, e as outras
-- opções sejam desabilitadas. posteriormente, depois de alguns dias de testes,
-- vamos eliminar definitivamente todas as demais".
--
-- ---------------------------------------------------------------------------
-- ⚠️ QUEM FAZ A MUDANÇA VALER É O CÓDIGO, NÃO ESTA MIGRATION.
--
-- `lib/chatLayout.ts` passou a marcar `original`, `continuidade` e `bancada`
-- como `aposentado`, e `podeAtivar` (que `layoutEfetivo` consulta antes de
-- aceitar o que veio do banco) passou a recusá-los. Com isso, a linha que ainda
-- dissesse `bancada` já cairia sozinha no padrão novo — a equipe inteira vai
-- para o v2 no deploy, mesmo que esta migration nunca rode.
--
-- Isto aqui é ARRUMAR O REGISTRO, e não é opcional por um motivo prático: a
-- tela do /admin mostra o que está gravado ao lado do que está em vigor. Com a
-- coluna dizendo `bancada` e todo mundo no v2, a tela passaria a mentir para o
-- próximo que a abrisse — exatamente o que a §29.3 separou ao criar `efetivo`.
--
-- ⚠️ E NÃO É UM CORTE SEM VOLTA. As telas antigas continuam em
-- `app/chat/` (~6.700 linhas); a volta é tirar a marca `aposentado` no código.
-- A remoção de verdade é a demanda #10 (fase 7), depois de alguns dias de uso.
-- ---------------------------------------------------------------------------

-- 1) a decisão global, registrada antes de ser aplicada
insert into public.chat_layout_historico (escopo, alvo, de, para, por)
select 'global', null, layout, 'v2', 'demanda #57 (migration 0150)'
  from public.chat_layout
 where id = 1 and layout is distinct from 'v2';

update public.chat_layout
   set layout = 'v2',
       atualizado_por = 'demanda #57 (migration 0150)',
       atualizado_em = now()
 where id = 1 and layout is distinct from 'v2';

-- 2) os pilotos por pessoa saem.
--
-- Hoje 14 das 15 pessoas estão com `chat_layout = 'v2'` gravado à mão, o que
-- era o piloto. Com o v2 virando o global, manter o piloto não muda o que elas
-- veem — e esconde o estado real: na tela do admin elas apareceriam como "em
-- piloto" para sempre, e desligar o v2 global um dia não as alcançaria.
--
-- Quem segue o global é quem de fato segue a decisão da casa.
insert into public.chat_layout_historico (escopo, alvo, de, para, por)
select 'piloto', email, chat_layout, 'v2', 'demanda #57 (migration 0150)'
  from public.acesso
 where chat_layout is not null;

update public.acesso set chat_layout = null where chat_layout is not null;
