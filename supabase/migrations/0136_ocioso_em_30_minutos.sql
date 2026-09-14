-- =============================================================================
-- 0136 · Ocioso passa a incluir "a cliente está esperando há 30 minutos"
--
-- Pedido do usuário (14/09/2026): *"se a última mensagem for do cliente e ele
-- ficar por 30 minutos sem receber resposta, então deve aparecer em ociosos"*.
--
-- ---------------------------------------------------------------------------
-- ⚠️ A REGRA DE HOJE NÃO É O QUE A DOCUMENTAÇÃO DIZ, E ISSO MUDA O CONSERTO.
--
-- A §11.1 descreve ociosos como "o cliente falou por último e passou de 24h".
-- A view NÃO olha quem falou:
--
--     WHEN ult.criada_em < (now() - '24:00:00') THEN 'ociosos'
--
-- É "a conversa parou há mais de 24h", de quem quer que seja a última fala.
-- Medido em 14/09/2026: 417 cards em ociosos, e apenas 16 conversas têm a
-- CLIENTE falando por último há mais de 24h. Os outros ~400 são conversas em
-- que NÓS falamos por último.
--
-- Consequência: trocar a regra ao pé da letra ("cliente E 30 min") levaria
-- ~400 cards para FORA de ociosos, direto no `ELSE` — que é negociação. O
-- pedido é diminuir o tempo de ociosidade, não esvaziar a coluna. Por isso o
-- ramo novo é ADICIONADO antes do que existe, não substitui:
--
--     cliente falou por último e faz +30 min  -> ociosos   (NOVO)
--     a conversa parou há +24h                -> ociosos   (como era)
--
-- Se um dia a intenção for mesmo substituir, é apagar o segundo WHEN — e o
-- efeito são os ~400 cards mudando de coluna de uma vez.
--
-- ---------------------------------------------------------------------------
-- ⚠️ DUAS DELAS SÃO MATERIALIZADAS — e isso não estava escrito em lugar nenhum.
--
-- `vw_funil` e `vw_funil_visivel` são MATERIALIZED VIEWs; só `vw_chat_conversa`
-- é view de verdade. Descoberto aqui, ao aplicar: `create or replace view`
-- responde "vw_funil is not a view".
--
-- O que isso significa para ESTE pedido: a coluna é uma FOTO, não uma consulta
-- ao vivo. Um card só entra em ociosos quando a foto é refeita. Medido em
-- 14/09/2026: `refresh-vw-funil` e `refresh-vw-funil-visivel` rodam a cada
-- 2 minutos (`*/2`), levando de 1 a 3,6 s. Ou seja, "30 minutos" na prática é
-- "30 minutos, mais até 2" — aceitável, e vale registrar para ninguém caçar
-- fantasma quando um card demorar um pouco a aparecer.
--
-- Consequência técnica: matview não aceita `create or replace`. É DROP +
-- CREATE, e por isso os 5 índices são capturados antes e recriados depois —
-- dois deles são UNIQUE, e sem eles o `REFRESH ... CONCURRENTLY` do cron passa
-- a falhar (só que em silêncio, num log que ninguém abre).
--
-- Conferido antes: nenhuma view depende destas duas, e elas não têm GRANT para
-- anon/authenticated. Então derrubá-las por 3 segundos não arrasta mais nada.
--
-- ---------------------------------------------------------------------------
-- ⚠️ POR SUBSTITUIÇÃO DE TEXTO, E NÃO REESCREVENDO AS VIEWS.
--
-- Cada uma tem dezenas de linhas que não têm nada a ver com isto. Retypá-las é
-- como este projeto já errou uma vez (a 0133 foi reconstruída de memória e
-- descartada). Aqui o bloco pega a definição VIVA, confere que o trecho antigo
-- aparece exatamente uma vez, e troca só ele — o resto continua byte a byte.
--
-- As três precisam mudar juntas: se a régua divergir, o board diz "Ociosos" e
-- o chip do chat diz "Negociação" para o mesmo cliente (§68.1).
-- =============================================================================

do $$
declare
  v        text;
  def      text;
  velho    text := '            WHEN ult.criada_em < (now() - ''24:00:00''::interval) THEN ''ociosos''::text';
  novo     text;
  ocorr    int;
  ehMat    boolean;
  indices  text[];
  ix       text;
begin
  novo :=
    '            WHEN ult.enviada_por = ''customer''::text AND ult.criada_em < (now() - ''00:30:00''::interval) THEN ''ociosos''::text'
    || chr(10) || velho;

  foreach v in array array['vw_funil', 'vw_funil_visivel', 'vw_chat_conversa'] loop
    select relkind = 'm' into ehMat from pg_class where relname = v and relnamespace = 'public'::regnamespace;
    def := pg_get_viewdef(v::regclass, true);

    -- Conferir a contagem ANTES de trocar é o que impede o pior caso: uma
    -- view que já mudou de forma sairia daqui com a regra pela metade, e
    -- ninguém veria — ela continuaria respondendo, só que errado.
    ocorr := (length(def) - length(replace(def, velho, ''))) / length(velho);
    if ocorr <> 1 then
      raise exception 'em % esperava 1 ocorrência do ramo de 24h, achei %', v, ocorr;
    end if;

    if ehMat then
      -- Os índices somem junto com a matview. Guardar o DDL de cada um antes
      -- é a única forma de devolvê-los idênticos — inclusive os UNIQUE, de
      -- que o REFRESH CONCURRENTLY depende.
      select array_agg(indexdef) into indices from pg_indexes
       where schemaname = 'public' and tablename = v;
      if indices is null or array_length(indices, 1) < 1 then
        raise exception 'não achei índice nenhum em % — não vou derrubá-la às cegas', v;
      end if;

      execute format('drop materialized view %I', v);
      execute format('create materialized view %I as %s', v, replace(def, velho, novo));
      foreach ix in array indices loop
        execute ix;
      end loop;
    else
      execute format('create or replace view %I as %s', v, replace(def, velho, novo));
    end if;
  end loop;
end $$;

comment on materialized view vw_funil_visivel is
  'A view que as TELAS leem (0099), MATERIALIZADA e refeita a cada 2 min pelo '
  'pg_cron. Desde a 0136 um card cai em `ociosos` por dois caminhos: a cliente '
  'falou por último e faz +30 min sem resposta, OU a conversa parou há +24h (de '
  'quem quer que seja a última fala). O segundo é o critério antigo e responde '
  'por quase toda a coluna; o primeiro é o pedido de 14/09/2026. Por ser foto, '
  'o card entra na coluna em até 2 minutos depois de vencer o prazo.';
