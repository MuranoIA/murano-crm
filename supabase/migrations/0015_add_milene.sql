-- =============================================================================
-- Adiciona a vendedora MILENE PAMPLONA (RCA 28, time IS) ao funil.
-- Slug de carteira: "milene" (1ª palavra do current_wallet "Milene Pamplona",
-- consistente com o vendedor_slug do lado de vendas).
-- Aplicar SOMENTE no murano-conversas (wtunzezigncwjpcqsfzk).
-- Os 4 pontos hardcoded dos 3 vendedores ganham o 28/'milene'.
-- =============================================================================

-- 1) vendas do mês por cliente (mapa rca->carteira + filtro de RCAs)
create or replace view vw_vendas_mes_cliente as
 SELECT f.codcli,
    max(wc.nome) AS nome,
    max(wc.telefone) AS telefone,
        CASE max(wc.rca_num)
            WHEN 45 THEN 'romulo'::text
            WHEN 46 THEN 'luana'::text
            WHEN 51 THEN 'kamilly'::text
            WHEN 28 THEN 'milene'::text
            ELSE NULL::text
        END AS carteira,
    max(v.cliente_id) AS cliente_id_vinculo,
    sum(CASE WHEN f.tipo = 'VENDA'::text AND f.posicao ~~ 'F%'::text THEN f.valor
             WHEN f.tipo = 'DEV'::text THEN - f.valor ELSE 0::numeric END) AS valor_mes,
    max(f.data_fat) FILTER (WHERE f.tipo = 'VENDA'::text AND f.posicao ~~ 'F%'::text) AS data_fat
   FROM wth_faturamento f
     JOIN wth_carteira wc ON wc.codcli = f.codcli AND (wc.rca_num = ANY (ARRAY[45, 46, 51, 28]))
     LEFT JOIN wth_vinculo v ON v.codcli = f.codcli
  WHERE (f.tipo = 'VENDA'::text AND f.posicao ~~ 'F%'::text OR f.tipo = 'DEV'::text)
    AND f.data_fat >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date
  GROUP BY f.codcli, wc.rca_num
 HAVING sum(CASE WHEN f.tipo = 'VENDA'::text AND f.posicao ~~ 'F%'::text THEN f.valor
                 WHEN f.tipo = 'DEV'::text THEN - f.valor ELSE 0::numeric END) > 0::numeric;

-- 2) fila de prospecção (RCAs cobertos)
create or replace view vw_fila_prospeccao as
 SELECT rca_num, rca_nome, codcli, nome, telefone, cidade
   FROM wth_carteira w
  WHERE ativo IS TRUE AND (rca_num = ANY (ARRAY[45, 46, 51, 28]))
    AND NOT (EXISTS (SELECT 1 FROM wth_vinculo v WHERE v.codcli = w.codcli));

-- 3) funil — branch de prospecção (mapa rca->carteira + filtro de RCAs)
create or replace view vw_funil as
 SELECT c.id AS cliente_id,
    c.nome_completo AS cliente,
    c.carteira AS vendedor,
    ult.criada_em AS ultima_atividade,
    ult.conteudo AS ultima_mensagem,
    ult.enviada_por AS ultima_enviada_por,
        CASE
            WHEN nf.data_fat IS NOT NULL THEN 'pedido_emitido'::text
            WHEN ult.enviada_por = 'operator'::text AND (ult.conteudo ~~* '%*pedido faturado%'::text OR ult.conteudo ~~* '%*pedido finalizado%'::text) AND (ult.criada_em AT TIME ZONE 'America/Sao_Paulo'::text)::date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date THEN 'pedido_emitido'::text
            WHEN ult.enviada_por = 'operator'::text AND ult.tipo = 'template'::text THEN 'tentativa_contato'::text
            WHEN ult.criada_em < (now() - '24:00:00'::interval) THEN 'ociosos'::text
            ELSE 'negociacao'::text
        END AS etapa,
    c.telefone,
    msgs3.msgs AS ultimas_mensagens,
    nf.valor_mes AS venda_valor,
    nf.data_fat AS venda_data
   FROM clientes c
     JOIN LATERAL ( SELECT m.criada_em, m.conteudo, m.enviada_por, m.tipo
           FROM mensagens m
          WHERE m.cliente_id = c.id AND m.tipo <> 'evento_sistema'::text
          ORDER BY m.criada_em DESC LIMIT 1) ult ON true
     LEFT JOIN ( SELECT vw_vendas_mes_cliente.cliente_id_vinculo AS cliente_id,
            vw_vendas_mes_cliente.valor_mes, vw_vendas_mes_cliente.data_fat
           FROM vw_vendas_mes_cliente
          WHERE vw_vendas_mes_cliente.cliente_id_vinculo IS NOT NULL) nf ON nf.cliente_id = c.id
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('c', sub.conteudo, 'e', sub.enviada_por, 't', sub.criada_em) ORDER BY sub.criada_em DESC) AS msgs
           FROM ( SELECT m2.conteudo, m2.enviada_por, m2.criada_em
                   FROM mensagens m2
                  WHERE m2.cliente_id = c.id AND m2.tipo <> 'evento_sistema'::text
                  ORDER BY m2.criada_em DESC LIMIT 3) sub) msgs3 ON true
  WHERE (EXISTS ( SELECT 1 FROM mensagens x WHERE x.cliente_id = c.id AND x.enviada_por = 'operator'::text AND x.tipo <> 'evento_sistema'::text))
UNION ALL
 SELECT 'winthor:'::text || fp.codcli::text AS cliente_id,
    fp.nome AS cliente,
        CASE fp.rca_num
            WHEN 45 THEN 'romulo'::text
            WHEN 46 THEN 'luana'::text
            WHEN 51 THEN 'kamilly'::text
            WHEN 28 THEN 'milene'::text
            ELSE NULL::text
        END AS vendedor,
    NULL::timestamp with time zone AS ultima_atividade,
    NULL::text AS ultima_mensagem,
    NULL::text AS ultima_enviada_por,
    'ociosos'::text AS etapa,
    fp.telefone,
    NULL::jsonb AS ultimas_mensagens,
    NULL::numeric AS venda_valor,
    NULL::date AS venda_data
   FROM vw_fila_prospeccao fp
  WHERE (fp.rca_num = ANY (ARRAY[45, 46, 51, 28]))
    AND NOT (EXISTS ( SELECT 1 FROM clientes c2 WHERE c2.telefone ~~ ('%'::text || "right"(fp.telefone, 8))))
    AND NOT (EXISTS ( SELECT 1 FROM vw_vendas_mes_cliente vm WHERE vm.codcli = fp.codcli))
UNION ALL
 SELECT 'venda:'::text || vm.codcli::text AS cliente_id,
    vm.nome AS cliente,
    vm.carteira AS vendedor,
    vm.data_fat::timestamp with time zone AS ultima_atividade,
    NULL::text AS ultima_mensagem,
    NULL::text AS ultima_enviada_por,
    'pedido_emitido'::text AS etapa,
    vm.telefone,
    NULL::jsonb AS ultimas_mensagens,
    vm.valor_mes AS venda_valor,
    vm.data_fat AS venda_data
   FROM vw_vendas_mes_cliente vm
  WHERE vm.cliente_id_vinculo IS NULL;

-- 4) divergência de carteira (mapa carteira->rca oficial)
create or replace view vw_divergencia_carteira as
 SELECT c.id AS cliente_id, c.nome_completo, c.carteira AS carteira_rdconversas,
    w.rca_num, w.rca_nome AS rca_oficial_winthor, w.codcli
   FROM clientes c
     JOIN wth_vinculo v ON v.cliente_id = c.id
     JOIN wth_carteira w ON w.codcli = v.codcli
  WHERE NOT (c.carteira = 'romulo'::text AND w.rca_num = 45
          OR c.carteira = 'luana'::text AND w.rca_num = 46
          OR c.carteira = 'kamilly'::text AND w.rca_num = 51
          OR c.carteira = 'milene'::text AND w.rca_num = 28);
