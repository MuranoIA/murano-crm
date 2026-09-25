-- =============================================================================
-- 0143 · O funil IGNORA o aviso de entrega ao cliente (card #19 do Entregas)
--
-- Decisão do dono (25/09/2026): o aviso "seu pedido saiu" / "você é a
-- próxima", que o Pulse manda em nome do hub (§74), NÃO move o card. Depois
-- desta migration o card fica exatamente onde estaria se o aviso não existisse.
--
-- ---------------------------------------------------------------------------
-- O PROBLEMA, como estava no ar com o PR #252
--
-- O aviso é espelhado em `mensagens` como `enviada_por='bot'`, `tipo='template'`.
-- A régua das três views pega a ÚLTIMA mensagem real (tudo que não é
-- `evento_sistema`), então o aviso virava a última mensagem e:
--   - o card ia para negociação (<24h) e depois ociosos (o ramo de template só
--     vale para `operator`);
--   - saía de "Pedido emitido" quando a última era o "*pedido faturado*";
--   - saía da PROSPECÇÃO (o ramo exige "nenhuma mensagem real"), e um
--     cliente da carteira nunca contatado virava conversa só por ter recebido
--     o aviso.
--
-- ---------------------------------------------------------------------------
-- COMO SE RECONHECE UM AVISO — uma marca gravada por quem envia
--
-- `bot` NÃO serve: é também o disparo em massa (14.679 linhas em 25/09/2026).
-- O nome do modelo (`ent_aviso_config.meta_nome`, no hub) também não: é
-- configurável — trocar o modelo lá mudaria por baixo, em silêncio, o que o
-- funil ignora, e as mensagens antigas ficariam com o nome velho.
--
-- Então: coluna `mensagens.aviso_entrega`, gravada `true` pela própria rota de
-- aviso (`web/lib/avisoEntrega.ts`) e por ninguém mais. Default `false` com
-- valor constante = só metadado no Postgres 11+, sem reescrever a tabela.
--
-- Backfill pelo vínculo exato que existe: `mensagens.id` = wamid =
-- `ent_aviso_cliente.wamid` (a fila do hub, mesmo banco). Em 25/09/2026 a fila
-- estava vazia — nenhum aviso tinha saído —, então hoje ele não muda linha
-- nenhuma. Fica para o caso de esta migration ser aplicada depois dos
-- primeiros envios.
--
-- ---------------------------------------------------------------------------
-- ONDE A MARCA É LIDA — quatro lugares, e têm que mudar juntos
--
--   vw_funil          (matview) a VERDADE: ETL (morto), disparo em massa, dono
--   vw_funil_visivel  (matview) o BOARD e as rotas de uma linha do chat
--   vw_chat_conversa  (matview) a LISTA do chat (0139)
--   get_funil_card()  (função)  o card AO VIVO do delta do board
--
-- Se um deles divergir, o board diz uma coluna e o chip do chat outra para a
-- mesma cliente (§68.1) — ou o card anda com o delta e volta no refresh.
--
-- A troca é MECÂNICA: toda condição `<alias>.tipo <> 'evento_sistema'::text`
-- (o filtro de "mensagem real", sobre `mensagens` sob os aliases m, m2 e x)
-- ganha `AND NOT <alias>.aviso_entrega`. Isso cobre de uma vez a última
-- mensagem, as 3 prévias, o EXISTS que põe a cliente no ramo de conversa, o
-- ramo 1b e os NOT EXISTS da prospecção. O que sobra — o `ORDER BY EXISTS`
-- que escolhe o `rd_cliente_id` do card de prospecção — não mede conversa,
-- só desempata cadastro, e fica como está.
--
-- Por substituição de texto sobre a definição VIVA (a lição da 0133/0136): o
-- bloco confere quantas ocorrências existem ANTES de trocar e aborta se a
-- view mudou de forma. Contagem medida em 25/09/2026: 5 / 7 / 1 / 3.
--
-- ⚠️ `get_funil_card` NÃO tem o ramo "cliente falou há +30 min -> ociosos" da
-- 0136 (drift anterior a esta migration: o delta pode mostrar negociação e o
-- refresh, 2 min depois, ociosos). Não corrigido aqui — fora do escopo; está
-- registrado no CLAUDE.md §74.
--
-- ---------------------------------------------------------------------------
-- ⚠️ O QUE MAIS MUDA, e é consequência da mesma decisão
--
-- - A lista do chat (vw_chat_conversa) também ignora o aviso: conversa cujo
--   único conteúdo é o aviso não aparece na barra lateral, e a ordem da lista
--   não sobe a cliente para o topo no dia da entrega. A mensagem continua na
--   THREAD (quem abre a conversa vê o que a cliente recebeu). Se a cliente
--   responder, a resposta é mensagem real e move tudo, como sempre.
-- - O disparo em massa lê `vw_funil`: quem só recebeu o aviso continua
--   elegível como se não tivesse recebido nada. (A rota de aviso também deixou
--   de gravar em `disparos_template`, que o anti-repetição lê.)
--
-- ---------------------------------------------------------------------------
-- REDE DE SEGURANÇA — prova, dentro da própria transação:
--
-- 1. Antes de derrubar cada matview, a definição ANTIGA é executada e guardada
--    numa tabela temporária; a nova é criada (com dados) e as duas são
--    comparadas LINHA A LINHA (EXCEPT nos dois sentidos, todas as colunas),
--    tirando só as linhas de quem tem aviso. `now()` é o mesmo nos dois lados
--    (é o início da transação), então para quem não tem aviso o resultado tem
--    que ser IDÊNTICO — não "a mesma contagem", o mesmo conteúdo.
-- 2. Índices, permissões (a 0126b/0139 tiram anon/authenticated da
--    vw_chat_conversa, e um DROP + CREATE devolveria o grant padrão do schema)
--    e o comentário voltam idênticos — conferido depois, não suposto.
-- 3. Em nenhum dos quatro objetos sobra `tipo <> 'evento_sistema'` sem a marca.
--
-- NÃO aplicar sem o código da rota (`aviso_entrega: true`) logo em seguida — e
-- NÃO publicar o código antes desta migration: o upsert com a coluna nova
-- falharia (o catch da rota engole, e o aviso sairia sem espelho no chat).
-- =============================================================================

alter table public.mensagens
  add column if not exists aviso_entrega boolean not null default false;

comment on column public.mensagens.aviso_entrega is
  'true = aviso de entrega ao cliente (hub Entregas, card #19), gravado pela '
  'rota /api/interno/avisos-entrega do Pulse. O funil (vw_funil, '
  'vw_funil_visivel, vw_chat_conversa e get_funil_card) IGNORA estas linhas: o '
  'card fica onde estaria sem o aviso (decisão do dono, 25/09/2026, 0143). A '
  'mensagem continua na thread.';

-- Backfill: o vínculo exato é o wamid (a fila do hub guarda o que a Meta devolveu).
do $$
begin
  if to_regclass('public.ent_aviso_cliente') is not null then
    update public.mensagens m
       set aviso_entrega = true
      from public.ent_aviso_cliente a
     where a.wamid is not null
       and m.id = a.wamid
       and not m.aviso_entrega;
  end if;
end $$;

do $$
declare
  padrao   constant text := '\m(m|m2|x)\.tipo <> ''evento_sistema''::text';
  troca    constant text := '\1.tipo <> ''evento_sistema''::text AND NOT \1.aviso_entrega';
  esperado constant jsonb := '{"vw_funil": 5, "vw_funil_visivel": 7, "vw_chat_conversa": 1, "get_funil_card": 3}';
  v        text;
  def      text;
  novo     text;
  corpo    text;
  ocorr    int;
  indices  text[];
  ix       text;
  acl_antes text[];
  acl_depois text[];
  comentario text;
  g        record;
  dif      bigint;
  fora     constant text :=
    -- linhas de quem TEM aviso ficam fora da comparação: para elas a mudança
    -- é justamente o que se quer. Três chaves, porque o card de uma avisada
    -- pode aparecer pelo cliente_id (conversa), pelo codcli (prospecção
    -- winthor:<codcli>) ou só pelo telefone (prospecção casada por tel8).
    'where not exists (select 1 from avisadas a where a.cliente_id = t.cliente_id
                                               or a.codcli = t.codcli
                                               or (a.tel8 is not null and a.tel8 = right(regexp_replace(coalesce(t.telefone, ''''), ''\D'', '''', ''g''), 8)))';
begin
  create temp table avisadas on commit drop as
    select distinct m.cliente_id,
           vln.codcli,
           nullif(right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8), '') as tel8
      from public.mensagens m
      left join public.clientes c on c.id = m.cliente_id
      left join public.wth_vinculo vln on vln.cliente_id = m.cliente_id
     where m.aviso_entrega;

  -- ---- as três matviews ---------------------------------------------------
  foreach v in array array['vw_funil', 'vw_funil_visivel', 'vw_chat_conversa'] loop
    if (select relkind from pg_class where relname = v and relnamespace = 'public'::regnamespace) <> 'm' then
      raise exception '% deixou de ser materializada — esta migration foi escrita para matview', v;
    end if;

    def := pg_get_viewdef(v::regclass, true);
    if position('aviso_entrega' in def) > 0 then
      raise exception '% já menciona aviso_entrega — migration aplicada duas vezes?', v;
    end if;

    select count(*) into ocorr from regexp_matches(def, padrao, 'g');
    if ocorr <> (esperado ->> v)::int then
      raise exception 'em % esperava % ocorrências do filtro de mensagem real, achei %',
        v, esperado ->> v, ocorr;
    end if;
    -- e nenhuma com outro alias, que ficaria sem a marca
    if (select count(*) from regexp_matches(def, 'tipo <> ''evento_sistema''', 'g')) <> ocorr then
      raise exception 'em % há filtro de mensagem real sob alias inesperado', v;
    end if;

    novo  := regexp_replace(def, padrao, troca, 'g');
    corpo := rtrim(def, '; ' || chr(10));

    -- o que a definição ANTIGA devolve, agora, para comparar depois
    execute format('create temp table antes on commit drop as %s', corpo);

    select array_agg(indexdef order by indexdef) into indices
      from pg_indexes where schemaname = 'public' and tablename = v;
    if indices is null then
      raise exception 'não achei índice nenhum em % — não vou derrubá-la às cegas', v;
    end if;
    select array_agg(a::text order by a::text) into acl_antes
      from pg_class c, unnest(c.relacl) a where c.relname = v and c.relnamespace = 'public'::regnamespace;
    comentario := obj_description(v::regclass, 'pg_class');

    execute format('drop materialized view public.%I', v);
    execute format('create materialized view public.%I as %s', v, novo);
    foreach ix in array indices loop
      execute ix;
    end loop;

    -- Permissões: o CREATE aplica o grant padrão do schema (que dá tudo a anon
    -- e authenticated). Volta exatamente ao que era.
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v);
    for g in
      select case when (a).grantee = 0 then 'public' else quote_ident((a).grantee::regrole::text) end as quem,
             (a).privilege_type as priv
        from (select aclexplode(array_agg(x::aclitem)) as a from unnest(acl_antes) x) s
       where (a).grantee <> (select relowner from pg_class where relname = v and relnamespace = 'public'::regnamespace)
    loop
      execute format('grant %s on public.%I to %s', g.priv, v, g.quem);
    end loop;
    select array_agg(a::text order by a::text) into acl_depois
      from pg_class c, unnest(c.relacl) a where c.relname = v and c.relnamespace = 'public'::regnamespace;
    if acl_depois is distinct from acl_antes then
      raise exception 'permissões de % mudaram: antes %, depois %', v, acl_antes, acl_depois;
    end if;

    if comentario is not null then
      execute format('comment on materialized view public.%I is %L', v, comentario);
    end if;

    if (select array_agg(indexdef order by indexdef) from pg_indexes
         where schemaname = 'public' and tablename = v) is distinct from indices then
      raise exception 'índices de % não voltaram idênticos', v;
    end if;

    -- A PROVA: para quem não tem aviso, o conteúdo é o MESMO, linha a linha.
    execute format(
      'select count(*) from (
         (select * from public.%1$I t %2$s except select * from antes t %2$s)
         union all
         (select * from antes t %2$s except select * from public.%1$I t %2$s)
       ) z', v, fora) into dif;
    if dif <> 0 then
      raise exception '% mudou para % linha(s) de quem NÃO tem aviso — abortando', v, dif;
    end if;

    raise notice '% ok: % linhas, 0 divergências fora das avisadas', v,
      (select count(*) from antes);
    drop table antes;
  end loop;

  -- ---- a função do card ao vivo ------------------------------------------
  def := pg_get_functiondef('public.get_funil_card(text)'::regprocedure);
  if position('aviso_entrega' in def) > 0 then
    raise exception 'get_funil_card já menciona aviso_entrega';
  end if;
  select count(*) into ocorr from regexp_matches(def, padrao, 'g');
  if ocorr <> (esperado ->> 'get_funil_card')::int
     or (select count(*) from regexp_matches(def, 'tipo <> ''evento_sistema''', 'g')) <> ocorr then
    raise exception 'em get_funil_card esperava % ocorrências, achei %', esperado ->> 'get_funil_card', ocorr;
  end if;
  -- CREATE OR REPLACE mantém dono, SECURITY DEFINER, search_path e o ACL.
  execute regexp_replace(def, padrao, troca, 'g');

  -- ---- nada ficou sem a marca ---------------------------------------------
  foreach v in array array['vw_funil', 'vw_funil_visivel', 'vw_chat_conversa'] loop
    def := pg_get_viewdef(v::regclass, true);
    if (select count(*) from regexp_matches(def, 'NOT \w+\.aviso_entrega', 'g')) <> (esperado ->> v)::int then
      raise exception '% ficou com a marca em número errado de lugares', v;
    end if;
  end loop;
  def := pg_get_functiondef('public.get_funil_card(text)'::regprocedure);
  if (select count(*) from regexp_matches(def, 'NOT \w+\.aviso_entrega', 'g')) <> 3 then
    raise exception 'get_funil_card ficou com a marca em número errado de lugares';
  end if;
end $$;
