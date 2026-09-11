-- 0131 — o RD Conversas acabou. Para o que ainda roda por causa dele.
--
-- CONTEXTO (medido em 11/09/2026, antes de escrever esta migration):
--
--   · A conta na Tallos está DESATIVADA. O ETL falha com
--     `API Rest resources not available for disabled company.` — não há mais
--     de onde puxar, e não é um problema de token ou de cota.
--   · A última mensagem que entrou pelo canal do RD é de 09/09/2026.
--   · O gatilho daqui (pg_cron -> workflow_dispatch no GitHub) responde
--     `401 Bad credentials` desde 02/09/2026 às 10:30 — o PAT expirou. Foram
--     2.193 disparos falhos em nove dias, ~200 linhas de erro por dia, e
--     ninguém foi avisado: é a falha silenciosa que este projeto já temia.
--   · Os dois workflows (`etl.yml` e `etl-fast.yml`) foram desabilitados no
--     GitHub e removidos do repositório no mesmo commit desta migration.
--
-- O QUE ESTA MIGRATION **NÃO** FAZ, de propósito:
--
--   · NÃO apaga mensagem nenhuma. São 159.944 linhas com `linha_id IS NULL`
--     (94% da tabela) e elas são o histórico do que foi combinado com cada
--     cliente — preço, prazo, pedido. Decisão explícita do usuário em
--     11/09/2026: "confirmo que não é para apagar as mensagens do RD".
--     Medimos que elas não custam desempenho: contar as 170.119 leva 201 ms,
--     e `vw_funil_visivel` responde em 151 ms com ou sem elas.
--   · NÃO derruba `clientes` nem `atendimentos`, que nasceram do ETL do RD e
--     alimentam board, chat e relatórios inteiros.
--   · NÃO mexe em `wth_*` nem no cron `wth-sync-tudo` — esse é o WinThor, é
--     outro assunto, e continua sendo necessário (roda em ~3,6 s a cada 10
--     minutos, com status ok).

-- ---------------------------------------------------------------------------
-- 1) Os jobs do pg_cron que disparavam o ETL
-- ---------------------------------------------------------------------------
-- Nomes conforme as migrations 0070 e seguintes. `unschedule` estoura se o job
-- não existir, então cada um vai dentro do seu próprio bloco: numa base onde
-- um deles já tenha sido removido à mão, a migration continua aplicável.
do $$
declare j record;
begin
  for j in
    select jobname from cron.job
    where jobname in ('etl-disparar', 'etl-disparar-fast', 'etl-trigger', 'etl-fast')
       or jobname ilike 'etl%'
  loop
    perform cron.unschedule(j.jobname);
    raise notice 'cron job removido: %', j.jobname;
  end loop;
exception when undefined_table then
  raise notice 'pg_cron não está instalado aqui — nada a remover';
end $$;

-- A função que o job chamava. Some junto: mantê-la seria deixar à mão um
-- gatilho para um workflow que não existe mais, e o próximo a encontrá-la
-- gastaria tempo descobrindo por que não funciona.
drop function if exists public.etl_disparar_workflow(text);
drop function if exists public.etl_disparar_workflow();

-- ---------------------------------------------------------------------------
-- 2) As chaves de convivência com o RD saem do /admin — e o estado congela
-- ---------------------------------------------------------------------------
-- `historico_rd`, `carteira_rd_ativa` e `numero_envio` foram removidas do
-- TypeScript (lib/crmConfig.ts) e da tela. As COLUNAS ficam no banco por um
-- motivo concreto: `carteira_rd_ativa` é lida pelas VIEWS `vw_funil` e
-- `vw_funil_visivel`, que decidem de quem é cada cliente. Reescrever essas
-- views — três ramos, UNION, a régua das colunas do board inteira — para tirar
-- uma leitura que já está no valor certo seria trocar risco real por limpeza
-- cosmética, e um erro ali derruba board e chat de uma vez.
--
-- Em vez disso, o valor é fixado e o DEFAULT passa a ser o valor fixado, para
-- que ninguém religue por engano numa inserção futura.
update public.crm_config
   set carteira_rd_ativa = false,   -- dono do cliente é só o RCA do WinThor
       historico_rd       = false,  -- não há botão de histórico para oferecer
       numero_envio       = 'cloud' -- canal único; a coluna vira registro
 where id = 1;

alter table public.crm_config alter column carteira_rd_ativa set default false;
alter table public.crm_config alter column historico_rd      set default false;

-- ---------------------------------------------------------------------------
-- 3) A linha sintética 'rd' sai do catálogo de números
-- ---------------------------------------------------------------------------
-- Ela já estava `ativo=false`. Continua CADASTRADA de propósito: é o rótulo
-- das 159.944 mensagens antigas, e apagá-la deixaria esse histórico sem nome
-- em qualquer consulta futura. O `filtroLinhas` do TypeScript passou a excluir
-- `linha_id IS NULL` sempre, então ela não volta à tela por configuração.
update public.chat_linha
   set ativo = false,
       rotulo = 'Murano Pro (número antigo — encerrado em 09/09/2026)'
 where phone_number_id = 'rd';

-- Se `linhas_visiveis` ainda listar a linha 'rd', tira — sem isso o seletor do
-- /admin mostraria uma opção marcada que não existe mais.
-- ⚠️ `linhas_visiveis` e `text[]`, NAO `jsonb`. A primeira versao deste bloco
-- usava `jsonb_array_elements_text` e o operador `?`, e a migration INTEIRA
-- estourava em `operator does not exist: text[] ? unknown` — por isso ela
-- nunca chegou a rodar, e `etl_disparar_workflow` continuou no banco por dias
-- depois de a PR #180 ser mesclada. Conferido em 11/09/2026:
--   information_schema.columns -> udt_name = '_text'.
update public.crm_config
   set linhas_visiveis = array_remove(linhas_visiveis, 'rd')
 where id = 1
   and linhas_visiveis is not null
   and 'rd' = any(linhas_visiveis);

-- ---------------------------------------------------------------------------
-- 4) O log do gatilho
-- ---------------------------------------------------------------------------
-- `etl_trigger_log` tem 10.360 linhas, 2.193 delas só de 401. A tabela FICA:
-- é o registro de quando o gatilho parou, e foi ela que permitiu datar o
-- incidente. Sem job para escrever nela, ela para de crescer sozinha.
comment on table public.etl_trigger_log is
  'Histórico do gatilho do ETL do RD Conversas (encerrado em 11/09/2026, migration 0131). '
  'Somente leitura a partir daqui: o job do pg_cron e os workflows foram removidos. '
  'Os 401 a partir de 02/09/2026 são o PAT do GitHub expirado; as falhas anteriores, '
  'a conta da Tallos desativada.';
