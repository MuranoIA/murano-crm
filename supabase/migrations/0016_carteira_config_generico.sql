-- =============================================================================
-- GENÉRICO: fonte única dos vendedores do funil = tabela carteira_config.
-- Adicionar vendedor = 1 linha aqui (slug, rca_num, employee_id, cor) + a tag
-- "carteira <nome>" no painel do RD Conversas. Zero código, zero SQL depois.
-- As 4 views param de hardcodar os RCAs e passam a ler da config.
-- Aplicar SOMENTE no murano-conversas (wtunzezigncwjpcqsfzk). Verificado: os
-- contadores do funil ficaram IDÊNTICOS ao baseline (funil 3092, vendas 329,
-- fila 1658, diverg 27) — refactor sem mudança de resultado.
-- =============================================================================

create table if not exists carteira_config (
  slug        text primary key,
  rca_num     integer unique,
  employee_id text,
  cor         text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
insert into carteira_config (slug, rca_num, employee_id, cor) values
  ('romulo',  45, '6a3a97bbb94e6ad472ee9d02', '#ea6a08'),
  ('luana',   46, '6a3a99836da6dc52edf34c5a', '#0d9488'),
  ('kamilly', 51, '6a3a9851e785f9118ec9141d', '#9333ea'),
  ('milene',  28, '69e2d5bc7a1da8f60a3d1883', '#2563eb')
on conflict (slug) do update set rca_num=excluded.rca_num, employee_id=excluded.employee_id, cor=excluded.cor, ativo=true;
grant select on carteira_config to anon, authenticated, service_role;

create or replace view vw_vendas_mes_cliente as
 SELECT f.codcli,
    max(wc.nome) AS nome,
    max(wc.telefone) AS telefone,
    max(cc.slug) AS carteira,
    max(v.cliente_id) AS cliente_id_vinculo,
    sum(CASE WHEN f.tipo = 'VENDA'::text AND f.posicao ~~ 'F%'::text THEN f.valor
             WHEN f.tipo = 'DEV'::text THEN - f.valor ELSE 0::numeric END) AS valor_mes,
    max(f.data_fat) FILTER (WHERE f.tipo = 'VENDA'::text AND f.posicao ~~ 'F%'::text) AS data_fat
   FROM wth_faturamento f
     JOIN wth_carteira wc ON wc.codcli = f.codcli
     JOIN carteira_config cc ON cc.rca_num = wc.rca_num AND cc.ativo
     LEFT JOIN wth_vinculo v ON v.codcli = f.codcli
  WHERE (f.tipo = 'VENDA'::text AND f.posicao ~~ 'F%'::text OR f.tipo = 'DEV'::text)
    AND f.data_fat >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date
  GROUP BY f.codcli, wc.rca_num
 HAVING sum(CASE WHEN f.tipo = 'VENDA'::text AND f.posicao ~~ 'F%'::text THEN f.valor
                 WHEN f.tipo = 'DEV'::text THEN - f.valor ELSE 0::numeric END) > 0::numeric;

create or replace view vw_fila_prospeccao as
 SELECT w.rca_num, w.rca_nome, w.codcli, w.nome, w.telefone, w.cidade
   FROM wth_carteira w
     JOIN carteira_config cc ON cc.rca_num = w.rca_num AND cc.ativo
  WHERE w.ativo IS TRUE
    AND NOT (EXISTS (SELECT 1 FROM wth_vinculo v WHERE v.codcli = w.codcli));

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
  WHERE NOT (EXISTS ( SELECT 1 FROM clientes c2 WHERE c2.telefone ~~ ('%'::text || "right"(fp.telefone, 8))))
    AND NOT (EXISTS ( SELECT 1 FROM vw_vendas_mes_cliente vm WHERE vm.codcli = fp.codcli))
UNION ALL
 SELECT 'venda:'::text || vm.codcli::text AS cliente_id, vm.nome AS cliente, vm.carteira AS vendedor,
    vm.data_fat::timestamp with time zone, NULL::text, NULL::text, 'pedido_emitido'::text, vm.telefone, NULL::jsonb, vm.valor_mes, vm.data_fat
   FROM vw_vendas_mes_cliente vm WHERE vm.cliente_id_vinculo IS NULL;

create or replace view vw_divergencia_carteira as
 SELECT c.id AS cliente_id, c.nome_completo, c.carteira AS carteira_rdconversas,
    w.rca_num, w.rca_nome AS rca_oficial_winthor, w.codcli
   FROM clientes c
     JOIN wth_vinculo v ON v.cliente_id = c.id
     JOIN wth_carteira w ON w.codcli = v.codcli
  WHERE NOT (EXISTS (SELECT 1 FROM carteira_config cc WHERE cc.slug = c.carteira AND cc.rca_num = w.rca_num));
