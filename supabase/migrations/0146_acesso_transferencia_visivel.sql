-- =============================================================================
-- 0146 · Quem aparece na lista de transferência de atendimento
--
-- Pedido do dono (29/09/2026, demanda #51): "crie mais um item no menu... com a
-- funcionalidade de configurar quem aparece na lista de transferência de
-- atendimentos, para o admin poder escolher quem vai aparecer na lista".
--
-- ⚠️ POR QUE NÃO REUSEI `atende_chat` (0130). São perguntas diferentes, e a
-- própria 0130 registra o perigo de confundi-las:
--
--     atende_chat            = tem caixa de entrada própria; recebe conversas
--     transferencia_visivel  = pode ser ESCOLHIDO como destino de uma transferência
--
-- `atende_chat` não se aplica a quem tem carteira, de propósito: se o
-- interruptor pudesse tirar o atendimento de um vendedor, o sintoma seria
-- "sumiram minhas conversas", sem erro nenhum na tela. Já esconder alguém da
-- lista de transferência é inofensivo — não tira conversa de ninguém, só encurta
-- um `select`. Por isso a coluna nova vale para TODO MUNDO, com ou sem carteira.
--
-- NASCE LIGADA para todos: a lista de hoje continua exatamente a mesma depois do
-- deploy. Quem some da lista some por decisão de um admin, na tela, nunca por
-- efeito colateral de uma migration (mesma régua da 0097).
-- =============================================================================

alter table acesso
  add column if not exists transferencia_visivel boolean not null default true;

comment on column acesso.transferencia_visivel is
  'Aparece na lista "Para quem" ao transferir uma conversa. Diferente de '
  'atende_chat: esconder daqui NAO tira conversa de ninguem nem impede de '
  'atender -- so encurta a lista. Configuravel em /admin-novo.';
