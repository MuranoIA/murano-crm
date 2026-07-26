-- =============================================================================
-- GATILHO DO ETL VIA pg_cron (substitui o cron do GitHub Actions, que é engolido)
--
-- POR QUÊ (medido em 26/07/2026):
--   O cron do GitHub Actions NÃO dispara na cadência configurada. Evidência limpa,
--   coletada com os workflows ATIVOS e NENHUM run em andamento:
--     etl.yml      cron */10 (6/h)  -> disparou 08:23, 08:36, 10:16, 11:37, 12:41
--     etl-fast.yml cron */15 (4/h)  -> disparou 09:46, 11:22, 12:39
--   Ou seja ~1 disparo por HORA nos dois, com intervalos de 64 a 100 min.
--   Em contraste, o pg_cron deste mesmo banco roda o `wth-sync-tudo` de 10 em 10
--   minutos sem falhar (ver `wth_sync_log`). Por isso o gatilho migra pra cá.
--
--   Obs: isto só faz sentido AGORA. Antes o run levava 34-45 min (cron de 10 min),
--   então o `concurrency group` cancelava os seguintes e mais gatilhos não ajudariam.
--   Com o run em ~6,5 min (orçamento rotativo + diff dos contadores do /v4/reports),
--   o disparo passou a ser a trava — e é o que este arquivo resolve.
--
-- ANTES DE APLICAR: inserir o token (fine-grained PAT com "Actions: read and write"
-- no repo rd-conversas-etl). Sem ele a função aborta com mensagem clara.
--   insert into wth_config (chave, valor) values ('gh_etl_token', 'github_pat_...')
--   on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
-- =============================================================================

-- log dos disparos (o risco conhecido deste tipo de job é falhar em silêncio)
create table if not exists etl_trigger_log (
  id          bigserial primary key,
  disparado_em timestamptz not null default now(),
  workflow    text not null,
  status      int,
  erro        text
);
create index if not exists idx_etl_trigger_log_em on etl_trigger_log (disparado_em desc);

create or replace function etl_disparar_workflow(p_workflow text default 'etl.yml')
returns void
language plpgsql
security definer
as $$
declare
  v_token  text;
  v_repo   text;
  v_resp   http_response;
begin
  select valor into v_token from wth_config where chave = 'gh_etl_token';
  if v_token is null or v_token = '' then
    insert into etl_trigger_log (workflow, status, erro)
    values (p_workflow, null, 'gh_etl_token ausente em wth_config');
    return;
  end if;

  -- repo configurável; default = o repo atual
  select coalesce(valor, 'romuloallbuquerque-netizen/rd-conversas-etl')
    into v_repo from wth_config where chave = 'gh_etl_repo';
  v_repo := coalesce(v_repo, 'romuloallbuquerque-netizen/rd-conversas-etl');

  select * into v_resp from http((
    'POST',
    'https://api.github.com/repos/' || v_repo || '/actions/workflows/' || p_workflow || '/dispatches',
    array[
      http_header('Authorization', 'Bearer ' || v_token),
      http_header('Accept', 'application/vnd.github+json'),
      http_header('X-GitHub-Api-Version', '2022-11-28'),
      -- o GitHub REJEITA requisição sem User-Agent
      http_header('User-Agent', 'supabase-pg-cron-etl')
    ],
    'application/json',
    '{"ref":"master","inputs":{"mode":"incremental"}}'
  )::http_request);

  -- dispatch bem-sucedido devolve 204 sem corpo
  insert into etl_trigger_log (workflow, status, erro)
  values (p_workflow, v_resp.status,
          case when v_resp.status = 204 then null else left(coalesce(v_resp.content, ''), 400) end);
exception when others then
  insert into etl_trigger_log (workflow, status, erro) values (p_workflow, null, left(sqlerrm, 400));
end;
$$;

-- a cada 10 min. O `concurrency group` do próprio workflow evita sobreposição:
-- se um run ainda estiver rodando, o novo fica pendente (e o run leva ~6,5 min).
select cron.unschedule('etl-disparar') where exists (select 1 from cron.job where jobname = 'etl-disparar');
select cron.schedule('etl-disparar', '*/10 * * * *', $$ select etl_disparar_workflow('etl.yml'); $$);

-- Conferir depois de aplicar:
--   select * from etl_trigger_log order by id desc limit 10;   -- status 204 = ok
--   select jobname, schedule, active from cron.job where jobname = 'etl-disparar';
