-- =============================================================================
-- 0124 · Linha de CHAMADA escolhida em /admin (0123 fez o mesmo para mensagem)
--
-- Contexto: `linhaDeLigacao()` (lib/whatsappCalling.ts) sempre foi a env
-- WHATSAPP_PHONE_NUMBER_ID, por decisão deliberada (§20.3/§22.7 do CLAUDE.md):
-- calling é ação que ESCREVE na conta da Meta, e a linha nunca deveria vir por
-- parâmetro de request — só assim o número oficial de produção não seria
-- alcançável nem por engano.
--
-- Com a migração do número oficial para a Cloud API (0123 já resolveu o lado de
-- MENSAGEM), calling precisa da mesma escolha: hoje há mais de uma linha Cloud
-- viva, e o admin pediu explicitamente poder escolher qual delas faz e recebe
-- chamada — sem precisar trocar env na Vercel.
--
-- A garantia de segurança da §20.3 continua de pé, só que por outro caminho: a
-- escolha não vem de parâmetro de request nenhum, vem de uma coluna que só o
-- admin altera, e só entre linhas JÁ cadastradas em chat_linha (nunca um
-- phone_number_id arbitrário digitado na hora).
--
-- NULO = estado de fábrica: continua valendo WHATSAPP_PHONE_NUMBER_ID, igual
-- hoje. Nasce NULO de propósito, mesmo padrão da 0123.
-- =============================================================================

alter table crm_config add column if not exists linha_padrao_calling text;

comment on column crm_config.linha_padrao_calling is
  'phone_number_id (chat_linha) usado para ORIGINAR e RECEBER chamada de voz. '
  'NULO = estado de fábrica, vale a env WHATSAPP_PHONE_NUMBER_ID (Vercel). '
  'Independente de linha_padrao_cloud (0123, que é só mensagem) — calling tem '
  'pré-requisito próprio por número (pagamento, campo calls assinado, '
  'interruptor ligado) que não deve seguir uma troca pensada só para mensagem.';
