-- =============================================================================
-- 0104 · Pedido emitido para de FIXAR o card: 7 dias e ele volta para a fila.
--
-- Pedido do usuario (25/08/2026): *"o que determina que o card va para pedido
-- emitido pode ser o mesmo mecanismo que e hoje, nota fiscal, mas o
-- comportamento do board esta fixando o card la, eu nao quero isso, quero que
-- ele se mova igual aos outros... 7 dias apos a compra realizada, esse card pode
-- ir para lista de prospeccao"*. Autorizou substituir a regra antiga.
--
-- ---------------------------------------------------------------------------
-- SUBSTITUI A REGRA DA §32.6, ESCRITA POUCAS HORAS ANTES
--
-- Aquela consertou o card que NUNCA saia (a coluna usava um bucket que ia de
-- 1900 ate hoje e acumulava desde abril) fazendo a coluna ser o **mes
-- corrente**. Resolveu o acumulo, mas manteve um degrau: quem comprava no dia 2
-- ficava preso ate o dia 1o do mes seguinte — quase 30 dias.
--
-- A regra nova e por **IDADE DA COMPRA**, nao por calendario: 7 dias corridos.
-- O card entra ao faturar e sai sozinho uma semana depois, movendo-se como os
-- demais.
--
-- Medido em 25/08: a coluna cai de **594 para 167 clientes**. Os 427 que saem
-- NAO somem — voltam para prospeccao ou para a etapa que a conversa deles
-- indicar, que e exatamente o "se mover igual aos outros" que foi pedido.
--
-- ---------------------------------------------------------------------------
-- ⚠️ SAO DOIS LADOS, E ESQUECER UM DELES FAZ O CARD SUMIR DA TELA
--
--   1. `vw_pedido_bi_card` ganha o periodo **`7d`** — o universo da coluna.
--   2. A prospeccao das views do funil EXCLUI quem comprou. Ela precisou passar
--      de "comprou no mes" para "comprou nos ultimos 7 dias".
--
-- Se so o item 1 mudasse, o cliente que sai da coluna aos 7 dias ficaria **fora
-- das duas** ate o dia 1o. As duas views do funil (`vw_funil`, do ETL, e
-- `vw_funil_visivel`, da tela) mudam juntas pelo motivo da §32.2.
--
-- Conferido depois: prospeccao 4.524 + coluna 167 = 4.691, a carteira exata,
-- com zero `cliente_id` duplicado.
--
-- ---------------------------------------------------------------------------
-- O QUE NAO MUDA
--
-- O KPI "R$ X · N VENDAS" do cabecalho continua acumulando o MES: e o numero
-- comercial que o time acompanha. Com a coluna em 7 dias os dois passam a
-- discordar na tela, entao o front ganhou o selo **NO MES** — sem ele, pareceria
-- que um dos dois esta errado.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) o bucket de 7 dias em vw_pedido_bi_card
--
--    `7d` e `semana` tem hoje a MESMA janela (6 dias atras + hoje). Sao mantidos
--    separados de proposito: `semana` e um recorte que o usuario escolhe no
--    dropdown, e `7d` e a REGRA da coluna. Se um dia a regra virar 5 ou 10 dias,
--    muda so aqui, sem mexer no que o dropdown oferece.
-- ---------------------------------------------------------------------------
create or replace view vw_pedido_bi_card as
 WITH hb AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date AS hoje),
 dedup AS (
   SELECT DISTINCT ON (wth_vendas_bi.pedido) wth_vendas_bi.pedido, wth_vendas_bi.vlr_atendido,
     wth_vendas_bi.nome_usuario, wth_vendas_bi.codcli, wth_vendas_bi.posicao, wth_vendas_bi.data_emissao,
     lower(split_part(btrim(wth_vendas_bi.nome_usuario), ' '::text, 1)) AS vendedor_slug
   FROM wth_vendas_bi ORDER BY wth_vendas_bi.pedido, wth_vendas_bi.id DESC
 ),
 ativos AS (
   SELECT dedup.pedido, dedup.vlr_atendido, dedup.nome_usuario, dedup.codcli, dedup.posicao,
          dedup.data_emissao, dedup.vendedor_slug
   FROM dedup
   WHERE dedup.posicao = ANY (ARRAY['L - Liberado'::text,'B - Bloqueado'::text,'M - Montado'::text,'F - Faturado'::text,'P - Pendente'::text])
 ),
 mes_cli AS (
   SELECT a_1.codcli, round(sum(a_1.vlr_atendido), 2) AS valor_mes
   FROM ativos a_1, hb
   WHERE (a_1.data_emissao AT TIME ZONE 'America/Sao_Paulo'::text)::date >= date_trunc('month'::text, hb.hoje::timestamp with time zone)::date
   GROUP BY a_1.codcli
 ),
 per AS (
   SELECT 'hoje'::text AS periodo, hb.hoje AS ini, hb.hoje AS fim FROM hb
   UNION ALL SELECT 'ontem'::text, hb.hoje - 1, hb.hoje - 1 FROM hb
   UNION ALL SELECT '7d'::text, hb.hoje - 6, hb.hoje FROM hb
   UNION ALL SELECT 'semana'::text, hb.hoje - 6, hb.hoje FROM hb
   UNION ALL SELECT 'quinzena'::text, hb.hoje - 14, hb.hoje FROM hb
   UNION ALL SELECT 'mes'::text, date_trunc('month'::text, hb.hoje::timestamp with time zone)::date, hb.hoje FROM hb
   UNION ALL SELECT 'todos'::text, '1900-01-01'::date, hb.hoje FROM hb
 )
 SELECT p.periodo, a.vendedor_slug, a.codcli,
    COALESCE(max(wc.nome), 'cliente '::text || a.codcli) AS cliente,
    max(wc.telefone) AS telefone, max(vin.cliente_id) AS cliente_id,
    count(*) AS pedidos, max(mc.valor_mes) AS valor, max(a.data_emissao)::date AS ultima_compra
   FROM per p
     JOIN ativos a ON (a.data_emissao AT TIME ZONE 'America/Sao_Paulo'::text)::date >= p.ini
                  AND (a.data_emissao AT TIME ZONE 'America/Sao_Paulo'::text)::date <= p.fim
     LEFT JOIN wth_carteira wc ON wc.codcli = a.codcli
     LEFT JOIN wth_vinculo vin ON vin.codcli = a.codcli
     LEFT JOIN mes_cli mc ON mc.codcli = a.codcli
  GROUP BY p.periodo, a.vendedor_slug, a.codcli;

comment on view vw_pedido_bi_card is
  'Card de Pedido emitido, 1 linha por cliente por periodo. O periodo "7d" e o universo '
  'da coluna no board desde a 0104: o card entra ao faturar e sai sozinho 7 dias depois. '
  'Os demais periodos servem aos recortes do dropdown.';

-- ---------------------------------------------------------------------------
-- 2) o outro lado: a prospeccao para de excluir quem comprou ha mais de 7 dias
--
--    Substituicao cirurgica sobre a definicao vigente, com verificacao: escrever
--    as duas views por extenso aqui duplicaria ~300 linhas que a 0100 acabou de
--    definir, e a copia divergiria no proximo ajuste. O bloco FALHA (raise) se o
--    padrao nao aparecer exatamente uma vez em cada view — entao nao ha como
--    aplicar pela metade em silencio.
-- ---------------------------------------------------------------------------
do $$
declare
  alvo constant text :=
    '(vb.data_emissao AT TIME ZONE ''America/Sao_Paulo''::text)::date >= date_trunc(''month''::text, (now() AT TIME ZONE ''America/Sao_Paulo''::text))::date';
  novo constant text :=
    '(vb.data_emissao AT TIME ZONE ''America/Sao_Paulo''::text)::date > ((now() AT TIME ZONE ''America/Sao_Paulo''::text)::date - 7)';
  v text; def text; n int;
begin
  foreach v in array array['vw_funil','vw_funil_visivel'] loop
    def := pg_get_viewdef(('public.' || v)::regclass, true);
    n := (length(def) - length(replace(def, alvo, ''))) / length(alvo);
    if n <> 1 then
      raise exception 'em % esperava 1 ocorrencia do filtro de venda no mes, achei %', v, n;
    end if;
    execute 'create or replace view public.' || v || ' as ' || replace(def, alvo, novo);
  end loop;
end $$;
