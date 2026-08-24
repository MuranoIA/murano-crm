-- =============================================================================
-- 0094 · Cadastra a linha "Murano Professional" (+55 91 8166-0019) na Cloud API
--
-- Primeiro número REAL nosso a nascer direto na Cloud API além do piloto. Sem
-- esta linha em `chat_linha`, toda conversa que entrar por ele chega ao chat
-- com `linha_id` preenchido mas SEM rótulo: o cabeçalho da conversa e o filtro
-- por número da sidebar (§23.4) mostram o id cru da Meta, e o número fica
-- indistinguível dos demais na tela.
--
-- Conferido na Graph API em 23/08/2026, com o token do system user Murano Pulse:
--   id 1264458800091787 · display_phone_number "+55 91 8166-0019"
--   verified_name "Murano Professional" · account_mode LIVE
--   code_verification_status VERIFIED · platform_type CLOUD_API
--
-- O que esta migration NÃO faz (mesma ressalva da 0089 e da /api/admin/linhas):
-- cadastro de linha é RÓTULO, não roteamento. Por qual número o app envia
-- continua decidido por `canalDeResposta` + WHATSAPP_PHONE_NUMBER_ID na Vercel.
-- Nada aqui toca o número de teste, a linha piloto nem o número oficial do RD.
-- =============================================================================

insert into chat_linha (phone_number_id, numero, rotulo, carteira, ativo)
values ('1264458800091787', '+559181660019', 'Murano Professional', null, true)
on conflict (phone_number_id) do nothing;
