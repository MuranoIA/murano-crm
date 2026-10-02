-- 0148 — quem tirou o template da lista do chat, e quando
--
-- Pedido do dono (demanda #59, 02/10/2026): a lista de templates do chat-v2 tem
-- 31 itens e boa parte é de evento com data vencida ("O segredo do loiro
-- saudavel 28 setembro", "SEMANA DO CLIENTE COMEÇOU"). A consultora precisa de
-- um botão que tire o template da lista DELA sem apagar nada na Meta, e o
-- administrador precisa poder trazer de volta ou apagar de verdade.
--
-- ⚠️ NÃO entra um segundo interruptor. `crm_templates.ativo` JÁ é a régua de
-- "aparece na lista de escolha": `/api/templates` filtra por ele, e o
-- `/api/send-template` só resolve template ativo. Uma coluna nova do tipo
-- `oculto_no_chat` criaria dois controles para a mesma pergunta — o erro que a
-- 0099 teve de desfazer (§32): "escondido" convivendo com "ativo" e ninguém
-- sabendo qual vence.
--
-- O que falta não é um interruptor, é o REGISTRO. Hoje `ativo=false` já
-- significa três coisas diferentes no banco, e a tela do admin não as separa:
--
--   · apagado na Meta          (status = 'REMOVIDO_NA_META')
--   · de uso interno           (os avisos de entrega, que nunca foram da lista)
--   · escondido por alguém     <- isto, que não tinha como registrar
--
-- Com `oculto_por`/`oculto_em` o admin lê "escondido por Fulana em 02/10" e
-- decide com informação, em vez de ver uma linha apagada sem motivo.
--
-- Reativar pelo /admin LIMPA os dois campos: quem voltou para a lista não está
-- mais escondido por ninguém, e deixar a marca para trás faria a tela mentir
-- na próxima vez que alguém olhasse.

alter table public.crm_templates
  add column if not exists oculto_em  timestamptz,
  add column if not exists oculto_por text;

comment on column public.crm_templates.oculto_em is
  'Quando o template foi tirado da lista do chat. Registro, não interruptor — quem decide a visibilidade é `ativo`.';
comment on column public.crm_templates.oculto_por is
  'E-mail de quem tirou o template da lista do chat. Nulo em template que ficou inativo por outro motivo (apagado na Meta, uso interno).';
