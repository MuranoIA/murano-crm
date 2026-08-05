-- =============================================================================
-- FECHA O EXECUTE DA ANON NAS FUNÇÕES — completa o ciclo da 12.5 e da 0070/0071
--
-- A 12.5 fechou as TABELAS (RLS ligado sem policy). A 0070/0071 fechou as funções
-- NOVAS. Mas toda função criada antes nasceu com EXECUTE para PUBLIC (default do
-- Postgres) e o PostgREST expõe qualquer função do schema public em /rest/v1/rpc/*.
-- Varredura ao vivo em 05/08/2026: 31 funções security definer com anon_executa=true.
--
-- As piores são as relatorio_clientes_*: retornam DADOS DE CLIENTES e, por serem
-- security definer, atravessam o RLS que a 12.5 ligou — qualquer pessoa com a chave
-- anon (pública, está no navegador) puxava lista de clientes com um POST no rpc.
-- As wth_sync_* deixavam qualquer um disparar sync completo do WinThor em loop.
--
-- POR QUE NÃO QUEBRA NADA (verificado no código antes de aplicar):
--   - Todas as rotas /api/* que usam .rpc( autenticam com SUPABASE_SERVICE_ROLE_KEY,
--     e a Edge Function is-narrativas idem. O grant do service_role é separado do
--     de anon/authenticated e NÃO é tocado aqui.
--   - As is_*/wth_sync_* são chamadas pelo pg_cron, que roda como dono — imune.
--   - Nenhum código de navegador chama .rpc( (só signInWithOAuth usa a anon key).
--
-- ROLLBACK pontual, se algum consumidor externo desconhecido quebrar (sintoma:
-- PostgREST devolve 401/404 no rpc, não lista vazia):
--   grant execute on function public.<nome>(<args>) to anon, authenticated;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Sync WinThor + reconciliação — só o pg_cron chama (jobs wth-sync-tudo etc.)
-- ---------------------------------------------------------------------------
revoke execute on function public.wth_sync_tudo()                                from public, anon, authenticated;
revoke execute on function public.wth_sync_carteira()                            from public, anon, authenticated;
revoke execute on function public.wth_sync_carteira_http()                       from public, anon, authenticated;
revoke execute on function public.wth_sync_campanhas_http()                      from public, anon, authenticated;
revoke execute on function public.wth_sync_catalogo_http()                       from public, anon, authenticated;
revoke execute on function public.wth_sync_ciclo_http()                          from public, anon, authenticated;
revoke execute on function public.wth_sync_endereco_http()                       from public, anon, authenticated;
revoke execute on function public.wth_sync_estoque_http()                        from public, anon, authenticated;
revoke execute on function public.wth_sync_faturamento_http(integer)             from public, anon, authenticated;
revoke execute on function public.wth_sync_itens_http(integer, date, date)       from public, anon, authenticated;
revoke execute on function public.wth_sync_orcamento_http()                      from public, anon, authenticated;
revoke execute on function public.wth_sync_vendas_bi_http(integer)               from public, anon, authenticated;
revoke execute on function public.wth_reconciliar_vinculos()                     from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Inside Sales (cômputo/refresh) — só o pg_cron (is-refresh-diario,
--    is-narrativas-diario) e a Edge Function (service_role) chamam
-- ---------------------------------------------------------------------------
revoke execute on function public.is_compute_novatos()                           from public, anon, authenticated;
revoke execute on function public.is_compute_opp()                               from public, anon, authenticated;
revoke execute on function public.is_dashboard_compute()                         from public, anon, authenticated;
revoke execute on function public.is_refresh()                                   from public, anon, authenticated;
revoke execute on function public.is_stage_hist_pull()                           from public, anon, authenticated;
revoke execute on function public.is_stage_pull()                                from public, anon, authenticated;
revoke execute on function public.is_narrativas_run(date)                        from public, anon, authenticated;
revoke execute on function public.is_narrativas_todos()                          from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Consultas do app — chamadas SOMENTE pelas rotas /api/* com service_role.
--    Security definer + retorno com dado de cliente = o vazamento mais grave
--    da lista; anon podia chamá-las direto pelo rpc e atravessar o RLS.
-- ---------------------------------------------------------------------------
revoke execute on function public.clientes_por_cidade(text[])                    from public, anon, authenticated;
revoke execute on function public.clientes_por_produto(integer[], date, date)    from public, anon, authenticated;
revoke execute on function public.is_dashboard_as_of(date)                       from public, anon, authenticated;
revoke execute on function public.relatorio_clientes_mosqueiro(text)             from public, anon, authenticated;
revoke execute on function public.relatorio_clientes_periodo(text, text)         from public, anon, authenticated;
revoke execute on function public.relatorio_clientes_santa_barbara(text)         from public, anon, authenticated;
revoke execute on function public.relatorio_clientes_sem_comprar(text, text)     from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Funções de trigger — o PostgREST não expõe funções que retornam trigger,
--    então eram inofensivas; revogadas por higiene/uniformidade.
-- ---------------------------------------------------------------------------
revoke execute on function public.trg_board_disparos_insert()                    from public, anon, authenticated;
revoke execute on function public.trg_board_mensagens_insert()                   from public, anon, authenticated;
revoke execute on function public.trg_board_mensagens_update()                   from public, anon, authenticated;
revoke execute on function public.app_touch_atualizado_em()                      from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Security INVOKER — o RLS das tabelas-base já bloqueia (anon leria 0 linhas),
--    revogadas por defesa em profundidade: se um dia uma tabela ganhar policy,
--    estas não viram porta lateral.
-- ---------------------------------------------------------------------------
revoke execute on function public.get_contatos_detalhes_hoje()                   from public, anon, authenticated;
revoke execute on function public.get_contatos_resumo_hoje()                     from public, anon, authenticated;
revoke execute on function public.relatorio_produto(integer[], text)             from public, anon, authenticated;
revoke execute on function public.relatorio_rows(integer[], integer[], text)     from public, anon, authenticated;
revoke execute on function public.wth_norm_cidade(text)                          from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) DAQUI PRA FRENTE: função nova NÃO nasce mais executável por anon.
--    Mata a classe do bug na origem — foi preciso consertar isso 3 vezes
--    (0070, 0071 e esta). Se um dia uma função for INTENCIONALMENTE pública,
--    o grant passa a ser explícito na migration dela:
--      grant execute on function public.<nome>(<args>) to anon, authenticated;
-- ---------------------------------------------------------------------------
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conferir depois de aplicar (deve retornar 0 linhas):
--   select p.proname from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prokind = 'f'
--     and has_function_privilege('anon', p.oid, 'EXECUTE');
--
-- E que o dono continua operando:
--   select wth_sync_tudo();   -- deve rodar em ~1-4s
-- ---------------------------------------------------------------------------
