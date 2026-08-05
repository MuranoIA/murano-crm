-- =============================================================================
-- COMPLETA O FIX DA 0042 — gatilho do etl-fast + nome do repo + bug do payload
--
-- 1) A 0042 mediu que o scheduler do GitHub disparava ~1x/HORA nos DOIS workflows:
--      etl.yml      cron */10 (6/h)  -> 08:23, 08:36, 10:16, 11:37, 12:41
--      etl-fast.yml cron */15 (4/h)  -> 09:46, 11:22, 12:39
--    ...mas só agendou o `etl.yml` no pg_cron. O etl-fast — justamente o caminho
--    "quase tempo real" — continuou dependendo do scheduler que a própria medição
--    reprovou, rodando a ~1/4 da cadência pretendida.
--
-- 2) BUG que impediria o item 1 de funcionar: a função da 0042 manda sempre
--      '{"ref":"master","inputs":{"mode":"incremental"}}'
--    mas o etl-fast.yml declara `workflow_dispatch:` SEM inputs. O GitHub responde
--    422 "Unexpected inputs provided" quando se envia input não declarado. O corpo
--    passa a ser montado conforme o workflow.
--
-- 3) O repo mudou de romuloallbuquerque-netizen/rd-conversas-etl para
--    MuranoIA/murano-crm. O default da 0042 ficou no nome antigo, dependendo do
--    redirect do GitHub — que, como o próprio comentário da rota /api/sync-etl diz,
--    "não é garantia". Corrigido no default E na linha de wth_config.
--
-- ORDEM DE APLICAÇÃO: aplicar DEPOIS de a 0069 estar no ar e do deploy do front que
-- remove o auto-sync do navegador. Antes disso, a cota liberada para o etl-fast seria
-- consumida pelo polling do board e voltariam os 429 no envio de template.
-- =============================================================================

create or replace function etl_disparar_workflow(p_workflow text default 'etl.yml')
returns void
language plpgsql
security definer
-- security definer sem search_path fixo é o vetor clássico de escalação (a 0042
-- veio sem; como esta migration reescreve a função inteira, corrige aqui).
-- http/http_header/http_response moram no schema extensions.
set search_path to 'public','extensions'
as $$
declare
  v_token  text;
  v_repo   text;
  v_body   text;
  v_resp   http_response;
begin
  select valor into v_token from wth_config where chave = 'gh_etl_token';
  if v_token is null or v_token = '' then
    insert into etl_trigger_log (workflow, status, erro)
    values (p_workflow, null, 'gh_etl_token ausente em wth_config');
    return;
  end if;

  select valor into v_repo from wth_config where chave = 'gh_etl_repo';
  v_repo := coalesce(nullif(v_repo, ''), 'MuranoIA/murano-crm');

  -- etl.yml declara o input `mode`; etl-fast.yml não declara input nenhum.
  -- Mandar input não declarado = 422 no GitHub.
  v_body := case
    when p_workflow = 'etl.yml' then '{"ref":"master","inputs":{"mode":"incremental"}}'
    else '{"ref":"master"}'
  end;

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
    v_body
  )::http_request);

  -- dispatch bem-sucedido devolve 204 sem corpo
  insert into etl_trigger_log (workflow, status, erro)
  values (p_workflow, v_resp.status,
          case when v_resp.status = 204 then null else left(coalesce(v_resp.content, ''), 400) end);
exception when others then
  insert into etl_trigger_log (workflow, status, erro) values (p_workflow, null, left(sqlerrm, 400));
end;
$$;

-- A versão da 0042 ficou com EXECUTE para PUBLIC (default do Postgres) e exposta em
-- /rest/v1/rpc/* pelo PostgREST — qualquer um com a chave anon disparava workflow no
-- GitHub à vontade, queimando minutos de Actions e a cota do RD. Só o pg_cron (que
-- roda como dono) precisa chamá-la. CREATE OR REPLACE preserva privilégios antigos,
-- então o revoke é necessário mesmo reescrevendo a função.
revoke execute on function public.etl_disparar_workflow(text) from public, anon, authenticated;

-- nome do repo atual (espelho do const REPO em web/app/api/sync-etl/route.ts)
insert into wth_config (chave, valor) values ('gh_etl_repo', 'MuranoIA/murano-crm')
on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();

-- gatilho do etl-fast, na mesma cadência que o workflow já declarava (*/15).
-- O `concurrency group: etl-fast` do próprio workflow impede sobreposição, e cada
-- run faz um loop interno de ~13 min — então */15 encadeia sem buraco.
select cron.unschedule('etl-disparar-fast') where exists (select 1 from cron.job where jobname = 'etl-disparar-fast');
select cron.schedule('etl-disparar-fast', '*/15 * * * *', $$ select etl_disparar_workflow('etl-fast.yml'); $$);

-- ---------------------------------------------------------------------------
-- SAÚDE DOS GATILHOS — o risco clássico deste tipo de job é falhar em silêncio
-- (a função nunca lança exceção; erro vira linha no log e ninguém olha).
-- ---------------------------------------------------------------------------
create or replace view vw_etl_trigger_saude as
select workflow,
       max(disparado_em) filter (where status = 204)            as ultimo_ok,
       now() - max(disparado_em) filter (where status = 204)    as desde_ultimo_ok,
       count(*) filter (where status is distinct from 204
                          and disparado_em > now() - interval '1 hour') as falhas_1h,
       (array_agg(erro order by disparado_em desc)
          filter (where erro is not null))[1]                   as ultimo_erro
from etl_trigger_log
group by workflow;

-- ---------------------------------------------------------------------------
-- Conferir depois de aplicar:
--   select * from vw_etl_trigger_saude;                  -- desde_ultimo_ok deve ficar < 20 min
--   select jobname, schedule, active from cron.job where jobname like 'etl-disparar%';
--   select * from etl_trigger_log order by id desc limit 10;   -- status 204 = ok
--
-- Teste imediato dos dois, sem esperar o cron:
--   select etl_disparar_workflow('etl.yml');
--   select etl_disparar_workflow('etl-fast.yml');
--   select * from etl_trigger_log order by id desc limit 2;
-- ---------------------------------------------------------------------------
