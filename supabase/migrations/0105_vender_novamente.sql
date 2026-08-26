-- =============================================================================
-- 0105 · Pedido emitido (3 dias) -> Vender novamente (ate 18) -> Prospeccao.
--
-- Decisao do usuario (26/08/2026), confirmando as tres objecoes que levantei:
--   · o cliente fica **3 dias** em Pedido emitido;
--   · depois vai para uma coluna nova, **Vender novamente**;
--   · nova venda o traz de volta para Pedido emitido;
--   · **15 dias em Vender novamente** sem comprar (= 18 desde a compra) e ele
--     volta para Lista de prospeccao;
--   · o selo mostra o valor das compras que o levaram ali;
--   · **conversa com janela aberta ganha de tudo**.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA VIEW NOVA, E NAO MAIS UM BUCKET DE PERIODO
--
-- A `vw_pedido_bi_card` responde "quem comprou em tal janela" com uma linha por
-- cliente POR PERIODO — bom para os recortes do dropdown, ruim para uma maquina
-- de estados. Aqui a pergunta e outra: **em que etapa este cliente esta**, e a
-- resposta e uma so por cliente.
--
-- A regra inteira e funcao de UM numero: dias desde a ultima compra.
--
--      0..2   -> pedido_emitido
--      3..18  -> vender_novamente
--      >18    -> sai (volta para o fluxo normal / prospeccao)
--
-- "Voltar para Pedido emitido ao comprar de novo" sai **de graca**: a venda nova
-- muda `ultima_compra`, o contador zera, e a etapa se recalcula sozinha. Nao ha
-- estado guardado, nada para sincronizar, nada que possa ficar preso.
--
-- ---------------------------------------------------------------------------
-- O SELO NAO PODE SER "O MES VIGENTE"
--
-- Era o pedido original, e mostrei o furo: quem comprou em 30/08 e esta em
-- Vender novamente em 02/09 apareceria com **R$ 0**, porque a compra que o
-- colocou ali nao conta mais no mes vigente. Todo dia 1o isso aconteceria.
--
-- `valor_janela` soma as compras dos ultimos 18 dias — exatamente as que
-- justificam a posicao do card. Nunca contradiz a coluna em que ele esta.
--
-- ---------------------------------------------------------------------------
-- CONVERSA ABERTA GANHA DE TUDO
--
-- Sem isso, uma cliente que **esta respondendo agora** ficaria em "Vender
-- novamente" por 18 dias em vez de "Negociacao" — e reabordar quem ja esta
-- falando com voce e ruido. A view marca `conversa_aberta` (mensagem recebida
-- nas ultimas 24h) e o /api/funil usa a marca para deixar o card na coluna da
-- conversa. Hoje seriam 3 clientes; depois da migracao do numero, muitos mais.
-- =============================================================================

create or replace view vw_venda_card as
with hb as (
  select (now() at time zone 'America/Sao_Paulo')::date as hoje
),
-- mesma dedup e mesmos estados de `vw_pedido_bi_card`: um pedido pode ter varias
-- linhas em wth_vendas_bi, e vale a mais recente (id desc)
dedup as (
  select distinct on (pedido)
    pedido, codcli, vlr_atendido, posicao, data_emissao,
    lower(split_part(btrim(nome_usuario), ' ', 1)) as vendedor_slug
  from wth_vendas_bi
  order by pedido, id desc
),
ativos as (
  select d.*, (d.data_emissao at time zone 'America/Sao_Paulo')::date as dia
  from dedup d
  where d.posicao = any (array['L - Liberado','B - Bloqueado','M - Montado','F - Faturado','P - Pendente'])
),
-- uma linha por (cliente, vendedor que lancou): a ultima compra e o que a
-- janela de 18 dias movimentou
por_cliente as (
  select a.codcli, a.vendedor_slug,
         max(a.dia) as ultima_compra,
         -- `>=`, igual ao WHERE de pertencimento la embaixo: com `>`, o cliente
         -- no 18o dia entraria na coluna com valor ZERO, que e exatamente o
         -- selo mentiroso que esta view existe para evitar
         count(*) filter (where a.dia >= hb.hoje - 18)              as pedidos_janela,
         round(sum(a.vlr_atendido) filter (where a.dia >= hb.hoje - 18), 2) as valor_janela
  from ativos a, hb
  group by a.codcli, a.vendedor_slug
)
select
  p.codcli,
  p.vendedor_slug,
  coalesce(w.nome, 'cliente ' || p.codcli)               as cliente,
  w.telefone,
  v.cliente_id,
  p.ultima_compra,
  (hb.hoje - p.ultima_compra)                            as dias,
  case when (hb.hoje - p.ultima_compra) < 3
       then 'pedido_emitido' else 'vender_novamente' end as etapa,
  coalesce(p.valor_janela, 0)                            as valor,
  coalesce(p.pedidos_janela, 0)                          as pedidos,
  -- a cliente falou com a gente nas ultimas 24h? entao a conversa manda, e o
  -- /api/funil deixa o card na coluna dela em vez de numa das duas de venda
  (exists (
     select 1 from mensagens m
      where m.cliente_id = v.cliente_id
        and m.enviada_por = 'customer'
        and m.tipo <> 'evento_sistema'
        and m.criada_em > now() - interval '24 hours'
  ))                                                     as conversa_aberta
from por_cliente p
  cross join hb
  join carteira_config cc on cc.slug = p.vendedor_slug and cc.ativo
  left join wth_carteira w on w.codcli = p.codcli
  left join wth_vinculo  v on v.codcli = p.codcli
where (hb.hoje - p.ultima_compra) <= 18;

comment on view vw_venda_card is
  'Maquina de estados das duas colunas de venda do board (0105): 0-2 dias = pedido_emitido, '
  '3-18 = vender_novamente, >18 sai e volta ao fluxo normal. Uma linha por cliente. '
  'A etapa e funcao de `dias`, entao uma venda nova zera o contador e traz o card de volta '
  'sozinho -- sem estado guardado. `valor` soma as compras da janela de 18 dias, NAO do mes '
  'vigente, que zeraria no dia 1o e contradiria a coluna. `conversa_aberta` avisa que a '
  'conversa deve ganhar precedencia.';

-- ---------------------------------------------------------------------------
-- O OUTRO LADO: a prospeccao passa a excluir 18 dias, nao 7
--
-- Mesma armadilha da 0104: o cliente fica ate 18 dias nas colunas de venda, e se
-- a prospeccao continuasse excluindo so 7, ele apareceria NAS DUAS entre o 8o e
-- o 18o dia. O bloco falha se o padrao nao aparecer uma vez em cada view.
--
-- ⚠️ O comparador e `>=`, nao `>`. Com `>` a prospeccao excluia ate o 17o dia
-- enquanto a view segurava ate o 18o — um off-by-one que colocou **40 clientes
-- em duas colunas ao mesmo tempo**, achado so ao conferir a sobreposicao depois
-- de aplicar. Regra: quando duas regras delimitam a MESMA janela, comparar os
-- dois lados com dado real antes de dar por pronto.
-- ---------------------------------------------------------------------------
do $$
declare
  alvo constant text :=
    '(vb.data_emissao AT TIME ZONE ''America/Sao_Paulo''::text)::date > ((now() AT TIME ZONE ''America/Sao_Paulo''::text)::date - 7)';
  novo constant text :=
    '(vb.data_emissao AT TIME ZONE ''America/Sao_Paulo''::text)::date >= ((now() AT TIME ZONE ''America/Sao_Paulo''::text)::date - 18)';
  v text; def text; n int;
begin
  foreach v in array array['vw_funil','vw_funil_visivel'] loop
    def := pg_get_viewdef(('public.' || v)::regclass, true);
    n := (length(def) - length(replace(def, alvo, ''))) / length(alvo);
    if n <> 1 then
      raise exception 'em % esperava 1 ocorrencia do filtro de 7 dias, achei %', v, n;
    end if;
    execute 'create or replace view public.' || v || ' as ' || replace(def, alvo, novo);
  end loop;
end $$;
