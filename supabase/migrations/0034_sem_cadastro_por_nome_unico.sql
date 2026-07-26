-- =============================================================================
-- Corrige o selo "SEM CADASTRO" (falso-positivo): antes marcava contato cujo TELEFONE
-- não batia com a carteira, mesmo a PESSOA sendo cadastrada (ex: WANDERLEIA tem 2
-- números no RD; um não está no WinThor). Agora casa também por NOME — mas só quando o
-- nome é ÚNICO na carteira (mapeia p/ exatamente 1 cliente), pra não desmarcar por
-- homônimo: lead "MARIA SILVA" com homônimas cadastradas continua sinalizado. Nome
-- normalizado (sem acento, maiúsculas, espaços colapsados) e telefone limpo dos 2 lados.
-- CASE garante que a contagem por nome só roda nos poucos que já falharam vínculo+tel.
-- NOTA: esta versão fazia seq scan da wth_carteira por linha (vw_funil ~7s); a 0035
-- adiciona colunas geradas indexadas e reescreve a view para casar por índice (~190ms).
-- Aplicar só no murano-conversas.
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
    nf.data_fat AS venda_data,
    CASE
      WHEN vln.codcli IS NOT NULL THEN false
      WHEN EXISTS ( SELECT 1 FROM wth_carteira w2
             WHERE length(regexp_replace(COALESCE(c.telefone, ''), '\D', '', 'g')) >= 8
               AND "right"(regexp_replace(w2.telefone, '\D', '', 'g'), 8) = "right"(regexp_replace(COALESCE(c.telefone,''), '\D', '', 'g'), 8)) THEN false
      WHEN ( SELECT count(DISTINCT w3.codcli) FROM wth_carteira w3
             WHERE upper(btrim(regexp_replace(translate(w3.nome, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'), '\s+', ' ', 'g')))
                 = upper(btrim(regexp_replace(translate(c.nome_completo, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'), '\s+', ' ', 'g')))) = 1 THEN false
      ELSE true
    END AS sem_cadastro
   FROM clientes c
     JOIN LATERAL ( SELECT m.criada_em, m.conteudo, m.enviada_por, m.tipo
           FROM mensagens m WHERE m.cliente_id = c.id AND m.tipo <> 'evento_sistema'::text ORDER BY m.criada_em DESC LIMIT 1) ult ON true
     LEFT JOIN ( SELECT vw_vendas_mes_cliente.cliente_id_vinculo AS cliente_id, vw_vendas_mes_cliente.valor_mes, vw_vendas_mes_cliente.data_fat
           FROM vw_vendas_mes_cliente WHERE vw_vendas_mes_cliente.cliente_id_vinculo IS NOT NULL) nf ON nf.cliente_id = c.id
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('c', sub.conteudo, 'e', sub.enviada_por, 't', sub.criada_em) ORDER BY sub.criada_em DESC) AS msgs
           FROM ( SELECT m2.conteudo, m2.enviada_por, m2.criada_em FROM mensagens m2 WHERE m2.cliente_id = c.id AND m2.tipo <> 'evento_sistema'::text ORDER BY m2.criada_em DESC LIMIT 3) sub) msgs3 ON true
     LEFT JOIN wth_vinculo vln ON vln.cliente_id = c.id
     LEFT JOIN wth_carteira wcar ON wcar.codcli = vln.codcli
     LEFT JOIN carteira_config ccr ON ccr.rca_num = wcar.rca_num AND ccr.ativo
  WHERE (EXISTS ( SELECT 1 FROM mensagens x WHERE x.cliente_id = c.id AND x.enviada_por = 'operator'::text AND x.tipo <> 'evento_sistema'::text))
UNION ALL
 SELECT 'winthor:'::text || w.codcli::text, w.nome, cc.slug, NULL::timestamptz, NULL::text, NULL::text, 'prospeccao'::text, w.telefone, NULL::jsonb, NULL::numeric, NULL::date, false
   FROM wth_carteira w JOIN carteira_config cc ON cc.rca_num = w.rca_num AND cc.ativo
  WHERE w.ativo IS TRUE
    AND NOT (EXISTS ( SELECT 1 FROM wth_vinculo v JOIN mensagens m ON m.cliente_id = v.cliente_id WHERE v.codcli = w.codcli AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text))
    AND NOT (EXISTS ( SELECT 1 FROM clientes cl JOIN mensagens m ON m.cliente_id = cl.id WHERE "right"(cl.telefone, 8) = "right"(w.telefone, 8) AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text))
    AND NOT (EXISTS ( SELECT 1 FROM wth_vendas_bi vb WHERE vb.codcli = w.codcli AND vb.posicao IN ('L - Liberado','B - Bloqueado','M - Montado','F - Faturado','P - Pendente') AND (vb.data_emissao AT TIME ZONE 'America/Sao_Paulo'::text)::date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date))
UNION ALL
 SELECT 'venda:'::text || vm.codcli::text, vm.nome, vm.carteira, vm.data_fat::timestamptz, NULL::text, NULL::text, 'pedido_emitido'::text, vm.telefone, NULL::jsonb, vm.valor_mes, vm.data_fat, false
   FROM vw_vendas_mes_cliente vm WHERE vm.cliente_id_vinculo IS NULL;
