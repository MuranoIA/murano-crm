-- Narrativa por IA do dashboard Inside Sales.
-- A edge function is-narrativas (supabase/functions/is-narrivas) lê is_dashboard.dados,
-- chama a API do Claude (Haiku 4.5, secret ANTHROPIC_API_KEY) e grava is_dashboard.narrativas.
-- Esta função a dispara; agendada logo após o is_refresh das 03:30 BRT.
-- Agendamento (via cron.schedule, não faz parte desta migration DDL):
--   cron.schedule('is-narrativas-diario', '45 6 * * *', 'select public.is_narrativas_run();')
create or replace function public.is_narrativas_run()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare v_resp extensions.http_response;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT','120');
  v_resp := extensions.http_post(
    'https://wtunzezigncwjpcqsfzk.supabase.co/functions/v1/is-narrativas',
    '{}', 'application/json');
  return jsonb_build_object('status', v_resp.status, 'body', left(v_resp.content, 300));
end; $function$;
