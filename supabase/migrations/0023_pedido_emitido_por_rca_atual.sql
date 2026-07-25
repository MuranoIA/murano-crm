-- =============================================================================
-- Pedido emitido passa a atribuir por RCA ATUAL do cliente (wth_carteira ->
-- carteira_config), não mais por "quem lançou" (lancado_por). Assim o cliente
-- aparece para o DONO ATUAL da carteira e o board reflete trocas de RCA
-- automaticamente (wth_carteira é sincronizado do WinThor a cada 10 min).
-- Consistente com vw_vendas_mes_cliente (que já usava RCA atual). O biller deixa
-- de influenciar a atribuição (fica só p/ histórico/relatório); a coluna e o
-- total nunca mostram o nome de outro vendedor. 1 linha por cliente por período,
-- somando todas as vendas do mês independente de quem faturou.
--
-- Impacto medido no total do mês: ~R$229,5k (por lançador) -> ~R$238,9k (por RCA
-- atual) — ~+4% no agregado, mas a atribuição por cliente fica correta.
-- vw_pedido_emitido_total não muda (agrega esta view, agora já por RCA atual).
-- Nota: os cards de CONVERSA do funil seguem por clientes.carteira (tag RD), que
-- está 98,4% alinhada ao RCA atual (o time do RD mantém). Alinhar 100% ao RCA
-- seria mexer no vw_funil (adiado; divergência de só ~14 cards).
-- Aplicar SOMENTE no murano-conversas (wtunzezigncwjpcqsfzk).
-- =============================================================================
create or replace view vw_pedido_emitido_card as
 WITH per(periodo, ini, fim) AS (
   VALUES ('hoje'::text, CURRENT_DATE, CURRENT_DATE),
          ('ontem'::text, CURRENT_DATE - 1, CURRENT_DATE - 1),
          ('semana'::text, CURRENT_DATE - 6, CURRENT_DATE),
          ('quinzena'::text, CURRENT_DATE - 14, CURRENT_DATE),
          ('mes'::text, date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date, CURRENT_DATE),
          ('todos'::text, '1900-01-01'::date, CURRENT_DATE)
 ), vend AS (
   SELECT DISTINCT wth_carteira.rca_num,
          btrim(split_part(wth_carteira.rca_nome, ' - '::text, 2)) AS usuario
   FROM wth_carteira
   WHERE wth_carteira.rca_num IS NOT NULL AND wth_carteira.rca_nome ~~ '% - %'::text
 )
 SELECT p.periodo,
    cc.slug AS vendedor,
    cc.slug AS vendedor_slug,
    cc.rca_num AS vendedor_rca,
    f.codcli,
    max(btrim(f.cliente)) AS cliente,
    vin.cliente_id,
    max(c.telefone) AS telefone,
    max(c.carteira) AS carteira_rdconversas,
    w.rca_num AS rca_do_cliente,
    max(w.cidade) AS cidade,
    bool_or(v.rca_num IS DISTINCT FROM w.rca_num) AS cliente_de_outra_carteira,
    count(*) AS pedidos,
    round(sum(f.valor), 2) AS valor,
    max(f.data_fat) AS ultima_compra,
    CURRENT_DATE - max(f.data_fat) AS dias_atras,
    ( SELECT m.conteudo FROM mensagens m WHERE m.cliente_id = vin.cliente_id ORDER BY m.criada_em DESC LIMIT 1) AS ultima_mensagem,
    ( SELECT m.criada_em FROM mensagens m WHERE m.cliente_id = vin.cliente_id ORDER BY m.criada_em DESC LIMIT 1) AS ultima_mensagem_em
   FROM per p
     JOIN wth_faturamento f ON f.tipo = 'VENDA'::text AND f.posicao = 'F - Faturado'::text AND f.codfilial = 1 AND f.data_fat >= p.ini AND f.data_fat <= p.fim
     JOIN wth_carteira w ON w.codcli = f.codcli
     JOIN carteira_config cc ON cc.rca_num = w.rca_num AND cc.ativo
     LEFT JOIN vend v ON v.usuario = btrim(f.lancado_por)
     LEFT JOIN wth_vinculo vin ON vin.codcli = f.codcli
     LEFT JOIN clientes c ON c.id = vin.cliente_id
  GROUP BY p.periodo, cc.slug, cc.rca_num, f.codcli, vin.cliente_id, w.rca_num;
