-- =============================================================================
-- PERFORMANCE: vw_funil estava levando ~6,7s por causa do dedup da prospecção,
-- que usava LIKE com curinga à esquerda — c2.telefone LIKE '%'||right(fp.telefone,8)
-- — impedindo uso de índice e forçando um Nested Loop Anti Join com ~1,8M
-- comparações. Como a rota /api/funil pagina a view 4x (3x1000 + fallback), o
-- tempo estourava para ~27s e derrubava o board com 500 (timeout).
--
-- Correção: trocar o LIKE por igualdade sobre os últimos 8 dígitos
--   right(c2.telefone,8) = right(fp.telefone,8)
-- e criar índice funcional idx_clientes_tel8 em right(telefone,8).
-- Resultado medido: 6724ms -> 238ms (~28x). Contagens inalteradas
-- (conversas 3208 + prospecção ~156 + pedido_emitido ~173 = ~3537 cards) —
-- mesma semântica (últimos 8 dígitos), só que agora sargable.
--
-- Aplicar SOMENTE no murano-conversas (wtunzezigncwjpcqsfzk).
-- =============================================================================

create index if not exists idx_clientes_tel8 on clientes (right(telefone, 8));

create or replace view vw_funil as
 SELECT c.id AS cliente_id, c.nome_completo AS cliente, c.carteira AS vendedor,
    ult.criada_em AS ultima_atividade, ult.conteudo AS ultima_mensagem, ult.enviada_por AS ultima_enviada_por,
        CASE
            WHEN nf.data_fat IS NOT NULL THEN 'pedido_emitido'::text
            WHEN ult.enviada_por = 'operator'::text AND (ult.conteudo ~~* '%*pedido faturado%'::text OR ult.conteudo ~~* '%*pedido finalizado%'::text) AND (ult.criada_em AT TIME ZONE 'America/Sao_Paulo'::text)::date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date THEN 'pedido_emitido'::text
            WHEN ult.enviada_por = 'operator'::text AND ult.tipo = 'template'::text THEN 'tentativa_contato'::text
            WHEN ult.criada_em < (now() - '24:00:00'::interval) THEN 'ociosos'::text
            ELSE 'negociacao'::text
        END AS etapa,
    c.telefone, msgs3.msgs AS ultimas_mensagens, nf.valor_mes AS venda_valor, nf.data_fat AS venda_data
   FROM clientes c
     JOIN LATERAL ( SELECT m.criada_em, m.conteudo, m.enviada_por, m.tipo FROM mensagens m
          WHERE m.cliente_id = c.id AND m.tipo <> 'evento_sistema'::text ORDER BY m.criada_em DESC LIMIT 1) ult ON true
     LEFT JOIN ( SELECT vw_vendas_mes_cliente.cliente_id_vinculo AS cliente_id, vw_vendas_mes_cliente.valor_mes, vw_vendas_mes_cliente.data_fat
           FROM vw_vendas_mes_cliente WHERE vw_vendas_mes_cliente.cliente_id_vinculo IS NOT NULL) nf ON nf.cliente_id = c.id
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('c', sub.conteudo, 'e', sub.enviada_por, 't', sub.criada_em) ORDER BY sub.criada_em DESC) AS msgs
           FROM ( SELECT m2.conteudo, m2.enviada_por, m2.criada_em FROM mensagens m2
                  WHERE m2.cliente_id = c.id AND m2.tipo <> 'evento_sistema'::text ORDER BY m2.criada_em DESC LIMIT 3) sub) msgs3 ON true
  WHERE (EXISTS ( SELECT 1 FROM mensagens x WHERE x.cliente_id = c.id AND x.enviada_por = 'operator'::text AND x.tipo <> 'evento_sistema'::text))
UNION ALL
 SELECT 'winthor:'::text || fp.codcli::text AS cliente_id, fp.nome AS cliente, cc.slug AS vendedor,
    NULL::timestamp with time zone, NULL::text, NULL::text, 'ociosos'::text, fp.telefone, NULL::jsonb, NULL::numeric, NULL::date
   FROM vw_fila_prospeccao fp
     JOIN carteira_config cc ON cc.rca_num = fp.rca_num AND cc.ativo
  WHERE NOT (EXISTS ( SELECT 1 FROM clientes c2 WHERE "right"(c2.telefone, 8) = "right"(fp.telefone, 8)))
    AND NOT (EXISTS ( SELECT 1 FROM vw_vendas_mes_cliente vm WHERE vm.codcli = fp.codcli))
UNION ALL
 SELECT 'venda:'::text || vm.codcli::text AS cliente_id, vm.nome AS cliente, vm.carteira AS vendedor,
    vm.data_fat::timestamp with time zone, NULL::text, NULL::text, 'pedido_emitido'::text, vm.telefone, NULL::jsonb, vm.valor_mes, vm.data_fat
   FROM vw_vendas_mes_cliente vm WHERE vm.cliente_id_vinculo IS NULL;
