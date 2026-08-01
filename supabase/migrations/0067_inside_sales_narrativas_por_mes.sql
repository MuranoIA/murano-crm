-- Análise (narrativa IA) também para os meses encerrados.
-- Antes a narrativa existia só para o mês corrente, gravada em is_dashboard.narrativas.
-- Agora fica cacheada por mês: mês fechado é gerado uma vez e nunca mais muda
-- (os dados de um mês encerrado são estáveis), o mês corrente é regerado toda madrugada.

create table if not exists public.is_narrativas_mes (
  mes date primary key,
  narrativas jsonb not null,
  gerado_em timestamptz not null default now()
);
alter table public.is_narrativas_mes enable row level security;

-- A função antiga não tinha parâmetro; recriamos com p_mes (null = mês corrente).
drop function if exists public.is_narrativas_run();

create or replace function public.is_narrativas_run(p_mes date default null)
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare v_resp extensions.http_response; v_body text;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT','180');
  v_body := case when p_mes is null then '{}'
                 else jsonb_build_object('mes', to_char(p_mes,'YYYY-MM'))::text end;
  v_resp := extensions.http_post(
    'https://wtunzezigncwjpcqsfzk.supabase.co/functions/v1/is-narrativas',
    v_body, 'application/json');
  return jsonb_build_object('mes', p_mes, 'status', v_resp.status, 'body', left(v_resp.content, 300));
end; $function$;

-- Roda toda madrugada: regera o mês corrente e preenche os 3 meses anteriores que
-- ainda não tenham análise. Mês fechado que já tem cache não é regerado (não muda,
-- e cada geração custa uma chamada de API).
create or replace function public.is_narrativas_todos()
returns jsonb language plpgsql security definer set search_path to 'public','extensions'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mes date; v_out jsonb := '[]'::jsonb; i integer;
begin
  v_out := v_out || jsonb_build_array(is_narrativas_run(null));
  for i in 1..3 loop
    v_mes := (date_trunc('month', v_hoje) - make_interval(months => i))::date;
    if not exists (select 1 from is_narrativas_mes where mes = v_mes) then
      v_out := v_out || jsonb_build_array(is_narrativas_run(v_mes));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'execucoes', v_out);
end; $function$;

-- Reagendar o cron para chamar o wrapper:
--   select cron.unschedule('is-narrativas-diario');
--   select cron.schedule('is-narrativas-diario','45 6 * * *','select public.is_narrativas_todos();');
