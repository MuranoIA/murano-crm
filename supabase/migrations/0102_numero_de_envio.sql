-- =============================================================================
-- 0102 · O admin escolhe por qual número o CRM fala.
--
-- Pedido do usuário (25/08/2026), com print do sintoma: ele digitou um número
-- que JÁ existia no RD, a conversa abriu — e o envio devolveu apenas `RD 429`.
-- *"o ideal é que eu possa ver qualquer contato... e quando abrir a janela de
-- conversa, mensagens, templates, ligação, isso deve ocorrer para o número que
-- estiver previamente setado no painel administrativo"*.
--
-- ---------------------------------------------------------------------------
-- O QUE MUDA NA DECISÃO DE CANAL
--
-- Hoje quem decide é `canalDeResposta()` (lib/whatsapp.ts), POR CONVERSA:
-- responde pelo canal em que o cliente falou por último. Isso foi desenhado
-- para a transição (§16.3) e continua sendo um bom padrão — mas não é o que o
-- usuário quer agora: ele quer uma decisão ÚNICA, do admin, valendo para
-- mensagem, template e ligação, em qualquer contato.
--
--   numero_envio = 'rd'     -> tudo pelo Murano Pro (RD Conversas)
--   numero_envio = 'cloud'  -> tudo pelo Murano Professional (WhatsApp Cloud)
--   numero_envio = NULL     -> automático (o comportamento de hoje)
--
-- NASCE NULO de propósito: nenhum deploy troca o canal de envio de sete pessoas
-- por efeito colateral. Escolher é ato do admin, com nome e hora registrados —
-- mesma regra da 0097.
--
-- ---------------------------------------------------------------------------
-- POR QUE 'cloud' E NÃO O phone_number_id
--
-- Guardar o id da linha pareceria mais preciso e seria uma armadilha: quem
-- carimba `linha_id` nas mensagens enviadas é `linhaDeEnvio()`, que lê a env
-- `WHATSAPP_PHONE_NUMBER_ID`. Duas fontes para a mesma decisão divergem no dia
-- em que alguém trocar uma e esquecer a outra — e o sintoma seria mensagem
-- saindo por um número e sendo registrada como de outro.
--
-- A §28.6 já estabelece que a env é A linha da Cloud e que trocá-la move os sete
-- pontos de envio de uma vez. Então 'cloud' significa exatamente "a linha da
-- Cloud do app", sem segunda fonte. Enviar por VÁRIAS linhas Cloud é outra
-- funcionalidade, e aí o lugar de mudar é a env virar tabela — não esta coluna.
-- =============================================================================

alter table crm_config
  add column if not exists numero_envio text
    check (numero_envio is null or numero_envio in ('rd', 'cloud'));

comment on column crm_config.numero_envio is
  'Numero pelo qual o CRM envia mensagem, template e ligacao. "rd" = Murano Pro '
  '(RD Conversas); "cloud" = Murano Professional (WhatsApp Cloud API, a linha da env '
  'WHATSAPP_PHONE_NUMBER_ID); NULO = automatico, responde pelo canal em que o cliente '
  'falou por ultimo (comportamento anterior a 0102). Nasce NULO para nenhum deploy '
  'trocar o canal por efeito colateral.';
