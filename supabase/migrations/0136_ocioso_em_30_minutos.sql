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
-- ⚠️ POR SUBSTITUIÇÃO DE TEXTO, E NÃO REESCREVENDO AS VIEWS.
--
-- São três views com a mesma régua (`vw_funil` alimenta o que não é tela,
-- `vw_funil_visivel` é o board, `vw_chat_conversa` é a lista do chat) e cada
-- uma tem outras dezenas de linhas que não têm nada a ver com isto. Retypá-las
-- é como este projeto já errou uma vez (a 0133 foi reconstruída de memória e
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
begin
  novo :=
    '            WHEN ult.enviada_por = ''customer''::text AND ult.criada_em < (now() - ''00:30:00''::interval) THEN ''ociosos''::text'
    || chr(10) || velho;

  foreach v in array array['vw_funil', 'vw_funil_visivel', 'vw_chat_conversa'] loop
    def := pg_get_viewdef(v::regclass, true);

    -- Conferir a contagem ANTES de trocar é o que impede o pior caso: uma
    -- view que já mudou de forma (ou que ganhou um segundo ramo de 24h)
    -- sairia daqui com uma regra pela metade, e ninguém veria — a view
    -- continuaria respondendo, só que errado.
    ocorr := (length(def) - length(replace(def, velho, ''))) / length(velho);
    if ocorr <> 1 then
      raise exception 'em % esperava 1 ocorrência do ramo de 24h, achei %', v, ocorr;
    end if;

    execute format('create or replace view %I as %s', v, replace(def, velho, novo));
  end loop;
end $$;

comment on view vw_funil_visivel is
  'A view que as TELAS leem (0099). Desde a 0136 um card cai em `ociosos` por '
  'dois caminhos: a cliente falou por último e faz +30 min sem resposta, OU a '
  'conversa parou há +24h (de quem quer que seja a última fala). O segundo é o '
  'critério antigo e responde por quase toda a coluna; o primeiro é o pedido de '
  '14/09/2026 para encurtar o tempo de ociosidade.';
