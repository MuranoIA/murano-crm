-- =============================================================================
-- Reverte a 0023: Pedido emitido + Vendas voltam a atribuir por QUEM LANÇOU
-- (produção real do vendedor). Atribuir por RCA atual inflava novato com o
-- histórico dos clientes herdados (Romulo aparecia com R$540k sendo que faturou
-- R$14k). Decisão do usuário: Vendas/Pedido = quem faturou; dono do cliente (RCA
-- atual) fica no vw_funil / filtro por produto / prospecção.
-- OBS: a fonte 100% correta de vendas é o ranking (bi_pedidos_dia, definição
-- data_emissao + estados ativos − cancelados). Refinar depois (aqui ainda usa
-- wth_faturamento F-Faturado). Aplicar só no murano-conversas.
-- =============================================================================
create or replace view vw_pedido_emitido_card as
 WITH per(periodo, ini, fim) AS (
   VALUES ('hoje'::text, CURRENT_DATE, CURRENT_DATE), ('ontem'::text, CURRENT_DATE - 1, CURRENT_DATE - 1),
          ('semana'::text, CURRENT_DATE - 6, CURRENT_DATE), ('quinzena'::text, CURRENT_DATE - 14, CURRENT_DATE),
          ('mes'::text, date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)::date, CURRENT_DATE),
          ('todos'::text, '1900-01-01'::date, CURRENT_DATE)
 ), vend AS (
   SELECT DISTINCT wth_carteira.rca_num, btrim(split_part(wth_carteira.rca_nome, ' - '::text, 2)) AS usuario
   FROM wth_carteira WHERE wth_carteira.rca_num IS NOT NULL AND wth_carteira.rca_nome ~~ '% - %'::text
 )
 SELECT p.periodo, btrim(f.lancado_por) AS vendedor,
    lower(split_part(btrim(f.lancado_por), ' '::text, 1)) AS vendedor_slug,
    v.rca_num AS vendedor_rca, f.codcli, btrim(f.cliente) AS cliente, vin.cliente_id, c.telefone,
    c.carteira AS carteira_rdconversas, w.rca_num AS rca_do_cliente, w.cidade,
    w.rca_num IS DISTINCT FROM v.rca_num AS cliente_de_outra_carteira,
    count(*) AS pedidos, round(sum(f.valor), 2) AS valor, max(f.data_fat) AS ultima_compra,
    CURRENT_DATE - max(f.data_fat) AS dias_atras,
    ( SELECT m.conteudo FROM mensagens m WHERE m.cliente_id = vin.cliente_id ORDER BY m.criada_em DESC LIMIT 1) AS ultima_mensagem,
    ( SELECT m.criada_em FROM mensagens m WHERE m.cliente_id = vin.cliente_id ORDER BY m.criada_em DESC LIMIT 1) AS ultima_mensagem_em
   FROM per p
     JOIN wth_faturamento f ON f.tipo = 'VENDA'::text AND f.posicao = 'F - Faturado'::text AND f.codfilial = 1 AND f.data_fat >= p.ini AND f.data_fat <= p.fim
     LEFT JOIN vend v ON v.usuario = btrim(f.lancado_por)
     LEFT JOIN wth_vinculo vin ON vin.codcli = f.codcli
     LEFT JOIN clientes c ON c.id = vin.cliente_id
     LEFT JOIN wth_carteira w ON w.codcli = f.codcli
  GROUP BY p.periodo, (btrim(f.lancado_por)), (lower(split_part(btrim(f.lancado_por), ' '::text, 1))), v.rca_num, f.codcli, (btrim(f.cliente)), vin.cliente_id, c.telefone, c.carteira, w.rca_num, w.cidade, (w.rca_num IS DISTINCT FROM v.rca_num);
