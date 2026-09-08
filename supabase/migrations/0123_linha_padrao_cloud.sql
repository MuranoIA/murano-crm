-- =============================================================================
-- 0123 · Linha Cloud padrão de envio, escolhida em /admin (não mais só a env)
--
-- Contexto: até aqui só existia UMA linha Cloud viva de cada vez, então
-- WHATSAPP_PHONE_NUMBER_ID (Vercel) bastava como "a" linha de envio para
-- conversa sem histórico ainda (linhaDaConversa() em lib/whatsapp.ts, que já
-- resolve por conversa quando ela existe, cai nesta env quando não existe).
-- Com um segundo número real cadastrado na Meta, "a" env vira ambígua: qual
-- das duas linhas Cloud ativas é a padrão? Isso precisa virar escolha no
-- admin, não redeploy.
--
-- NULO = estado de fábrica: continua valendo WHATSAPP_PHONE_NUMBER_ID, exatamente
-- como hoje. Nasce NULO de propósito — mesmo padrão de toda chave nova deste
-- projeto (§29.3, §30.2): nenhum deploy troca o número de saída de ninguém.
--
-- Isto governa só MENSAGEM (texto, template, mídia). Ligação continua presa à
-- env por decisão separada — calling tem pré-requisito próprio por número
-- (pagamento, campo `calls` assinado, interruptor de calling ligado) que não
-- deve mudar sozinho quando o admin troca a linha padrão de mensagem.
-- =============================================================================

alter table crm_config add column if not exists linha_padrao_cloud text;

comment on column crm_config.linha_padrao_cloud is
  'phone_number_id (chat_linha) usado como linha Cloud de saída quando a conversa '
  'ainda não tem uma linha própria (contato novo, ou histórico só no RD). '
  'NULO = estado de fábrica, vale a env WHATSAPP_PHONE_NUMBER_ID (Vercel). '
  'Nunca aponta para calling — ligação segue presa à env (ver lib/whatsapp.ts).';
