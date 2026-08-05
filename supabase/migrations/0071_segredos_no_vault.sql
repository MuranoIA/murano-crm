-- =============================================================================
-- SEGREDOS NO VAULT (com fallback para wth_config)
--
-- PROBLEMA: `wth_config` é uma tabela comum guardando, em TEXTO PURO:
--   - gh_etl_token       -> PAT do GitHub com "Actions: read and write"
--   - a service_role key do murano-clientes-v2 (irrestrita: lê e escreve a v2 inteira)
-- O RLS está ligado sem policy, então anon/authenticated não leem — o risco imediato
-- está coberto. Mas qualquer backup, dump, export de tabela ou consulta feita com a
-- service_role expõe os segredos em claro, e o PAT dá poder de disparar workflow no
-- repositório. Segredo deve morar no Vault (pgsodium), que guarda cifrado em repouso.
--
-- ESTRATÉGIA: NÃO quebrar nada. Esta migration só cria um leitor que tenta o Vault
-- PRIMEIRO e cai no wth_config se não achar. Ela funciona idêntica antes e depois de
-- você mover o segredo — a migração do valor em si é o passo manual abaixo, porque
-- exige o segredo em mãos (eu não tenho, e ele não deve passar por arquivo versionado).
-- =============================================================================

create or replace function public.segredo_de(p_nome text, p_chave_legado text default null)
returns text
language plpgsql
security definer
set search_path to 'public','vault','extensions'
as $$
declare v text;
begin
  -- 1) Vault. Em bloco próprio: se a extensão não estiver habilitada ou a view não
  --    for legível, cai no legado em vez de derrubar quem chamou.
  begin
    select decrypted_secret into v from vault.decrypted_secrets where name = p_nome limit 1;
  exception when others then
    v := null;
  end;
  if v is not null and v <> '' then return v; end if;

  -- 2) legado: wth_config em texto puro
  if p_chave_legado is not null then
    select valor into v from wth_config where chave = p_chave_legado;
  end if;
  return nullif(v, '');
end;
$$;

-- SEM ESTE REVOKE A MIGRATION FAZ O CONTRÁRIO DO QUE PROMETE: função nova nasce com
-- EXECUTE para PUBLIC, o PostgREST a expõe em /rest/v1/rpc/segredo_de, e ela é
-- security definer — ou seja, atravessa o RLS que hoje protege wth_config. Qualquer
-- pessoa com a chave anon (pública, está no navegador) faria
--   POST /rest/v1/rpc/segredo_de {"p_nome":"gh_etl_token","p_chave_legado":"gh_etl_token"}
-- e receberia o PAT em texto puro. Só as funções do banco (que rodam como dono)
-- precisam deste leitor.
revoke execute on function public.segredo_de(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- etl_disparar_workflow passa a ler o PAT pelo leitor acima.
-- Corpo idêntico ao da 0070 — muda só a origem do token.
-- ---------------------------------------------------------------------------
create or replace function etl_disparar_workflow(p_workflow text default 'etl.yml')
returns void
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare
  v_token  text;
  v_repo   text;
  v_body   text;
  v_resp   http_response;
begin
  v_token := public.segredo_de('gh_etl_token', 'gh_etl_token');
  if v_token is null then
    insert into etl_trigger_log (workflow, status, erro)
    values (p_workflow, null, 'gh_etl_token ausente (Vault e wth_config)');
    return;
  end if;

  select valor into v_repo from wth_config where chave = 'gh_etl_repo';
  v_repo := coalesce(nullif(v_repo, ''), 'MuranoIA/murano-crm');

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
      http_header('User-Agent', 'supabase-pg-cron-etl')
    ],
    'application/json',
    v_body
  )::http_request);

  insert into etl_trigger_log (workflow, status, erro)
  values (p_workflow, v_resp.status,
          case when v_resp.status = 204 then null else left(coalesce(v_resp.content, ''), 400) end);
exception when others then
  insert into etl_trigger_log (workflow, status, erro) values (p_workflow, null, left(sqlerrm, 400));
end;
$$;

-- reafirma o revoke da 0070 (CREATE OR REPLACE preserva privilégios, mas se esta
-- migration rodar num banco onde a 0070 não rodou, a função nasceria pública)
revoke execute on function public.etl_disparar_workflow(text) from public, anon, authenticated;

-- =============================================================================
-- PASSO MANUAL (rodar no SQL Editor, NÃO versionar o valor real)
--
-- 1. Guardar o PAT no Vault:
--      select vault.create_secret('github_pat_XXXX', 'gh_etl_token',
--                                 'PAT do GitHub p/ workflow_dispatch do ETL');
--
-- 2. Conferir que o leitor já pega do Vault:
--      select left(public.segredo_de('gh_etl_token','gh_etl_token'), 12);
--
-- 3. Testar o dispatch de verdade ANTES de apagar o legado:
--      select etl_disparar_workflow('etl.yml');
--      select * from etl_trigger_log order by id desc limit 1;   -- precisa dar 204
--
-- 4. Só então remover a cópia em texto puro:
--      delete from wth_config where chave = 'gh_etl_token';
--
-- 5. Repetir para a service_role key da v2. NÃO fiz aqui porque a função que a usa
--    (wth_sync_carteira_http) não foi revisada nesta passagem e ela alimenta o
--    wth-sync-tudo de 10 em 10 min — trocar às cegas arrisca parar carteira e
--    faturamento. Quando for mexer, o padrão é o mesmo: vault.create_secret(...),
--    trocar a leitura por public.segredo_de('v2_service_role_key','<chave_atual>'),
--    testar com `select wth_sync_tudo();`, e só então apagar de wth_config.
--
-- APROVEITE PARA ROTACIONAR: o PAT esteve em texto puro num banco com histórico de
-- exposição da anon (ver CLAUDE.md 12.5). Gerar um novo no GitHub e guardar só no
-- Vault é mais seguro que mover o atual de lugar.
-- =============================================================================
