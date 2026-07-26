-- =============================================================================
-- Board = CARTEIRA INTEIRA (não só conversas). A parte 2 da vw_funil deixa de ser
-- uma "fila de prospecção" restrita (só carteira sem vínculo, sem telefone batendo,
-- sem venda, jogada em 'ociosos') e passa a ser a coluna PRÓPRIA 'prospeccao':
-- TODO cliente da carteira ativa (RCA atual) que NUNCA teve conversa com operador no
-- RD Conversas (nem por vínculo CPF nem por telefone) e NÃO comprou no mês corrente.
-- Assim a carteira toda é abrangida: conversa (negociação/tentativa/ociosos) + pedido
-- (bi) + prospecção. Fonte dos clientes = wth_carteira (espelho da v2), não conversas.
-- "Comprou no mês" usa a MESMA fonte do pedido (wth_vendas_bi, estados ativos, Belém)
-- pra não haver cliente em pedido E em prospecção ao mesmo tempo. Parte 1 (conversa) e
-- parte 3 (venda sem vínculo) inalteradas. Aplicar só no murano-conversas.
-- =============================================================================
create or replace view vw_funil as
 SELECT c.id AS cliente_id,
    c.nome_completo AS cliente,
    COALESCE(ccr.slug, c.carteira) AS vendedor,
    ult.criada_em AS ultima_atividade,
    ult.conteudo AS ultima_mensagem,
    ult.enviada_por AS ultima_enviada_por,
        CASE
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
          ORDER BY m.criada_em DESC
         LIMIT 1) ult ON true
     LEFT JOIN ( SELECT vw_vendas_mes_cliente.cliente_id_vinculo AS cliente_id, vw_vendas_mes_cliente.valor_mes, vw_vendas_mes_cliente.data_fat
           FROM vw_vendas_mes_cliente
          WHERE vw_vendas_mes_cliente.cliente_id_vinculo IS NOT NULL) nf ON nf.cliente_id = c.id
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('c', sub.conteudo, 'e', sub.enviada_por, 't', sub.criada_em) ORDER BY sub.criada_em DESC) AS msgs
           FROM ( SELECT m2.conteudo, m2.enviada_por, m2.criada_em
                   FROM mensagens m2
                  WHERE m2.cliente_id = c.id AND m2.tipo <> 'evento_sistema'::text
                  ORDER BY m2.criada_em DESC
                 LIMIT 3) sub) msgs3 ON true
     LEFT JOIN wth_vinculo vln ON vln.cliente_id = c.id
     LEFT JOIN wth_carteira wcar ON wcar.codcli = vln.codcli
     LEFT JOIN carteira_config ccr ON ccr.rca_num = wcar.rca_num AND ccr.ativo
  WHERE (EXISTS ( SELECT 1 FROM mensagens x
          WHERE x.cliente_id = c.id AND x.enviada_por = 'operator'::text AND x.tipo <> 'evento_sistema'::text))
UNION ALL
 -- PROSPECÇÃO: carteira ativa (RCA atual) que nunca teve conversa com operador e não comprou no mês.
 SELECT 'winthor:'::text || w.codcli::text AS cliente_id,
    w.nome AS cliente,
    cc.slug AS vendedor,
    NULL::timestamp with time zone AS ultima_atividade,
    NULL::text AS ultima_mensagem,
    NULL::text AS ultima_enviada_por,
    'prospeccao'::text AS etapa,
    w.telefone,
    NULL::jsonb AS ultimas_mensagens,
    NULL::numeric AS venda_valor,
    NULL::date AS venda_data
   FROM wth_carteira w
     JOIN carteira_config cc ON cc.rca_num = w.rca_num AND cc.ativo
  WHERE w.ativo IS TRUE
    AND NOT (EXISTS ( SELECT 1 FROM wth_vinculo v JOIN mensagens m ON m.cliente_id = v.cliente_id
                      WHERE v.codcli = w.codcli AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text))
    AND NOT (EXISTS ( SELECT 1 FROM clientes cl JOIN mensagens m ON m.cliente_id = cl.id
                      WHERE "right"(cl.telefone, 8) = "right"(w.telefone, 8) AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text))
    AND NOT (EXISTS ( SELECT 1 FROM wth_vendas_bi vb
                      WHERE vb.codcli = w.codcli
                        AND vb.posicao IN ('L - Liberado','B - Bloqueado','M - Montado','F - Faturado','P - Pendente')
                        AND (vb.data_emissao AT TIME ZONE 'America/Sao_Paulo'::text)::date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date))
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
