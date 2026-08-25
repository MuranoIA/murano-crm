-- =============================================================================
-- 0100 · Quem fala com a gente primeiro passa a existir.
--
-- BUG relatado pelo usuário em 25/08/2026: *"o número desconhecido que entra em
-- contato ou faz ligação não aparece no chat; mandei um oi hoje de um número
-- desconhecido e não encontrei no chat"*.
--
-- Reproduzido no dado: `wa:559184522161` mandou "Oi" às 11:13 (BRT), ligou às
-- 11:14 e autorizou receber ligações — e não estava em lugar nenhum.
--
-- ---------------------------------------------------------------------------
-- A CAUSA: as duas views exigiam que NÓS tivéssemos falado
--
--   WHERE EXISTS (SELECT 1 FROM mensagens x
--                  WHERE x.cliente_id = c.id
--                    AND x.enviada_por = 'operator'   <<< aqui
--                    AND x.tipo <> 'evento_sistema')
--
-- Ou seja: **conversa só de entrada não existia** para o board nem para o chat.
-- Medido antes do conserto: 22 clientes nessa situação, 0 aparecendo no funil.
--
-- A condição fazia sentido na era do RD, quando `clientes` recebia contatos
-- importados sem conversa nenhuma e "teve mensagem de operador" era o proxy de
-- "isto é uma conversa de verdade". Com o webhook da Cloud criando o contato a
-- partir da mensagem RECEBIDA (§16.3), a premissa se inverteu — e a fila de não
-- atribuídos (§21), que existe exatamente para o contato novo sem dono, nunca
-- recebia ninguém porque a view cortava antes dela.
--
-- Correção: a régua passa a ser **existe mensagem real**, de quem quer que seja.
-- A etapa continua saindo da mesma expressão de sempre — quem só mandou "Oi"
-- agora cai em `negociacao`, que é o certo: alguém está falando conosco e a
-- janela de 24h está aberta.
--
-- ⚠️ A condição é removida nos DOIS lados, e isso não é opcional:
--    ramo 1  usa    EXISTS (...)  para incluir quem tem conversa;
--    ramo 2  usa NOT EXISTS (...) para tirar da prospecção quem já tem conversa.
-- Afrouxar só um deixaria o mesmo cliente em duas colunas ao mesmo tempo.
--
-- As DUAS views mudam juntas, pela razão registrada na §32.2: `vw_funil` é do
-- ETL, `vw_funil_visivel` é da tela, e uma régua que diverge entre elas produz
-- board e chat discordando sem ninguém entender por quê.
--
-- Substituição cirúrgica, não `replace()` sobre `pg_get_viewdef`: o padrão
-- aparece 5 e 7 vezes nas duas views, e uma delas é a subconsulta de
-- `rd_cliente_id`, que NÃO deve mudar. Troca cega ali passaria despercebida.
--
-- ---------------------------------------------------------------------------
-- A SEGUNDA CAUSA, achada ao conferir o conserto: o filtro de RCA
--
-- Com a primeira correção aplicada o contato do usuário CONTINUAVA sumido. Ele
-- é a Kamilly, que TEM vínculo no WinThor — sob um RCA que não é nenhuma das 7
-- carteiras. E o ramo 1 exigia também:
--
--   AND (vln.cliente_id IS NULL OR ccr.slug IS NOT NULL)
--
-- ou seja: **quem tem cadastro no ERP sob RCA de fora do CRM sumia inteiro**,
-- mesmo conversando agora. Medido: 122 clientes com conversa nessa situação.
-- Era um efeito conhecido — a `vw_carteira_conflito.no_board` (0093) já
-- registrava "cliente invisivel no board e no chat" — mas ninguém tinha ligado
-- isso a "o cliente me mandou mensagem e eu não acho".
--
-- A condição fazia sentido para PROSPECÇÃO (não encher o board de um vendedor
-- com cliente de outra carteira). Não faz nenhum para uma CONVERSA ABERTA:
-- perder alguém que está falando conosco é sempre pior. Removida do ramo 1.
--
-- Onde eles caem: `vendedor` é COALESCE(ccr.slug, c.carteira), que fica NULO —
-- então vão para a FILA DE NÃO ATRIBUÍDOS do chat (§21), visível a todos, com o
-- botão ✋ Pegar. É exatamente o "lugar para ficar" que o usuário pediu.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) vw_funil — a do ETL. Idêntica à 0093, menos o filtro de remetente.
-- ---------------------------------------------------------------------------
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
            WHEN length(regexp_replace(COALESCE(c.telefone, ''::text), '\D'::text, ''::text, 'g'::text)) >= 8 AND (EXISTS ( SELECT 1
               FROM wth_carteira w2
              WHERE w2.tel8 = "right"(regexp_replace(COALESCE(c.telefone, ''::text), '\D'::text, ''::text, 'g'::text), 8))) THEN false
            WHEN (( SELECT count(DISTINCT w3.codcli) AS count
               FROM wth_carteira w3
              WHERE w3.nome_norm = upper(btrim(regexp_replace(translate(c.nome_completo, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ'::text, 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'::text), '\s+'::text, ' '::text, 'g'::text))))) = 1 THEN false
            ELSE true
        END AS sem_cadastro,
    NULL::text AS rd_cliente_id,
    vln.codcli,
    wcar.rca_num,
    c.carteira AS carteira_rd
   FROM clientes c
     JOIN LATERAL ( SELECT m.criada_em, m.conteudo, m.enviada_por, m.tipo
           FROM mensagens m
          WHERE m.cliente_id = c.id AND m.tipo <> 'evento_sistema'::text
          ORDER BY m.criada_em DESC
         LIMIT 1) ult ON true
     LEFT JOIN ( SELECT vw_vendas_mes_cliente.cliente_id_vinculo AS cliente_id,
            vw_vendas_mes_cliente.valor_mes,
            vw_vendas_mes_cliente.data_fat
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
  WHERE (EXISTS ( SELECT 1
           FROM mensagens x
          WHERE x.cliente_id = c.id AND x.tipo <> 'evento_sistema'::text))
UNION ALL
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
    NULL::date AS venda_data,
    false AS sem_cadastro,
    ( SELECT cl.id
           FROM clientes cl
          WHERE "right"(cl.telefone, 8) = "right"(w.telefone, 8)
          ORDER BY ((EXISTS ( SELECT 1
                   FROM mensagens m
                  WHERE m.cliente_id = cl.id))) DESC, cl.id DESC
         LIMIT 1) AS rd_cliente_id,
    w.codcli,
    w.rca_num,
    NULL::text AS carteira_rd
   FROM wth_carteira w
     JOIN carteira_config cc ON cc.rca_num = w.rca_num AND cc.ativo
  WHERE w.ativo IS TRUE AND NOT (EXISTS ( SELECT 1
           FROM wth_vinculo v
             JOIN mensagens m ON m.cliente_id = v.cliente_id
          WHERE v.codcli = w.codcli AND m.tipo <> 'evento_sistema'::text)) AND NOT (EXISTS ( SELECT 1
           FROM clientes cl
             JOIN mensagens m ON m.cliente_id = cl.id
          WHERE "right"(cl.telefone, 8) = "right"(w.telefone, 8) AND m.tipo <> 'evento_sistema'::text)) AND NOT (EXISTS ( SELECT 1
           FROM wth_vendas_bi vb
          WHERE vb.codcli = w.codcli AND (vb.posicao = ANY (ARRAY['L - Liberado'::text, 'B - Bloqueado'::text, 'M - Montado'::text, 'F - Faturado'::text, 'P - Pendente'::text])) AND (vb.data_emissao AT TIME ZONE 'America/Sao_Paulo'::text)::date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date))
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
    vm.data_fat AS venda_data,
    false AS sem_cadastro,
    NULL::text AS rd_cliente_id,
    vm.codcli,
    ccv.rca_num,
    NULL::text AS carteira_rd
   FROM vw_vendas_mes_cliente vm
     LEFT JOIN carteira_config ccv ON ccv.slug = vm.carteira AND ccv.ativo
  WHERE vm.cliente_id_vinculo IS NULL;

-- ---------------------------------------------------------------------------
-- 2) vw_funil_visivel — a da tela. Idêntica à 0099, menos o filtro de remetente.
-- ---------------------------------------------------------------------------
create or replace view vw_funil_visivel as
with sel as (
  select coalesce(
           (select c.linhas_visiveis from crm_config c where c.id = 1),
           (select array_agg(l.phone_number_id) from chat_linha l where l.ativo)
         ) as linhas
)
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
            WHEN length(regexp_replace(COALESCE(c.telefone, ''::text), '\D'::text, ''::text, 'g'::text)) >= 8 AND (EXISTS ( SELECT 1
               FROM wth_carteira w2
              WHERE w2.tel8 = "right"(regexp_replace(COALESCE(c.telefone, ''::text), '\D'::text, ''::text, 'g'::text), 8))) THEN false
            WHEN (( SELECT count(DISTINCT w3.codcli) AS count
               FROM wth_carteira w3
              WHERE w3.nome_norm = upper(btrim(regexp_replace(translate(c.nome_completo, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ'::text, 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'::text), '\s+'::text, ' '::text, 'g'::text))))) = 1 THEN false
            ELSE true
        END AS sem_cadastro,
    NULL::text AS rd_cliente_id,
    vln.codcli,
    wcar.rca_num,
    c.carteira AS carteira_rd
   FROM clientes c
     CROSS JOIN sel
     JOIN LATERAL ( SELECT m.criada_em, m.conteudo, m.enviada_por, m.tipo
           FROM mensagens m
          WHERE m.cliente_id = c.id AND m.tipo <> 'evento_sistema'::text
            AND COALESCE(m.linha_id, 'rd'::text) = ANY (sel.linhas)
          ORDER BY m.criada_em DESC
         LIMIT 1) ult ON true
     LEFT JOIN ( SELECT vw_vendas_mes_cliente.cliente_id_vinculo AS cliente_id,
            vw_vendas_mes_cliente.valor_mes,
            vw_vendas_mes_cliente.data_fat
           FROM vw_vendas_mes_cliente
          WHERE vw_vendas_mes_cliente.cliente_id_vinculo IS NOT NULL) nf ON nf.cliente_id = c.id
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('c', sub.conteudo, 'e', sub.enviada_por, 't', sub.criada_em) ORDER BY sub.criada_em DESC) AS msgs
           FROM ( SELECT m2.conteudo, m2.enviada_por, m2.criada_em
                   FROM mensagens m2
                  WHERE m2.cliente_id = c.id AND m2.tipo <> 'evento_sistema'::text
                    AND COALESCE(m2.linha_id, 'rd'::text) = ANY (sel.linhas)
                  ORDER BY m2.criada_em DESC
                 LIMIT 3) sub) msgs3 ON true
     LEFT JOIN wth_vinculo vln ON vln.cliente_id = c.id
     LEFT JOIN wth_carteira wcar ON wcar.codcli = vln.codcli
     LEFT JOIN carteira_config ccr ON ccr.rca_num = wcar.rca_num AND ccr.ativo
  WHERE (EXISTS ( SELECT 1
           FROM mensagens x
          WHERE x.cliente_id = c.id AND x.tipo <> 'evento_sistema'::text
            AND COALESCE(x.linha_id, 'rd'::text) = ANY (sel.linhas)))

UNION ALL
 SELECT c.id AS cliente_id,
    c.nome_completo AS cliente,
    c.carteira AS vendedor,
    NULL::timestamp with time zone AS ultima_atividade,
    NULL::text AS ultima_mensagem,
    NULL::text AS ultima_enviada_por,
    'ociosos'::text AS etapa,
    c.telefone,
    NULL::jsonb AS ultimas_mensagens,
    NULL::numeric AS venda_valor,
    NULL::date AS venda_data,
    true AS sem_cadastro,
    NULL::text AS rd_cliente_id,
    NULL::integer AS codcli,
    NULL::integer AS rca_num,
    c.carteira AS carteira_rd
   FROM clientes c
     CROSS JOIN sel
  WHERE (EXISTS ( SELECT 1 FROM mensagens x
                   WHERE x.cliente_id = c.id AND x.tipo <> 'evento_sistema'::text))
    AND NOT (EXISTS ( SELECT 1 FROM mensagens m
                       WHERE m.cliente_id = c.id AND m.tipo <> 'evento_sistema'::text
                         AND COALESCE(m.linha_id, 'rd'::text) = ANY (sel.linhas)))
    AND NOT (EXISTS ( SELECT 1 FROM wth_vinculo v WHERE v.cliente_id = c.id))
    AND NOT (EXISTS ( SELECT 1 FROM wth_carteira w
                       WHERE length(regexp_replace(COALESCE(c.telefone, ''::text), '\D'::text, ''::text, 'g'::text)) >= 8
                         AND w.tel8 = "right"(regexp_replace(COALESCE(c.telefone, ''::text), '\D'::text, ''::text, 'g'::text), 8)))

UNION ALL
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
    NULL::date AS venda_data,
    false AS sem_cadastro,
    ( SELECT cl.id
           FROM clientes cl
          WHERE "right"(cl.telefone, 8) = "right"(w.telefone, 8)
          ORDER BY ((EXISTS ( SELECT 1 FROM mensagens m WHERE m.cliente_id = cl.id))) DESC, cl.id DESC
         LIMIT 1) AS rd_cliente_id,
    w.codcli,
    w.rca_num,
    NULL::text AS carteira_rd
   FROM wth_carteira w
     CROSS JOIN sel
     JOIN carteira_config cc ON cc.rca_num = w.rca_num AND cc.ativo
  WHERE w.ativo IS TRUE AND NOT (EXISTS ( SELECT 1
           FROM wth_vinculo v
             JOIN mensagens m ON m.cliente_id = v.cliente_id
          WHERE v.codcli = w.codcli AND m.tipo <> 'evento_sistema'::text
            AND COALESCE(m.linha_id, 'rd'::text) = ANY (sel.linhas))) AND NOT (EXISTS ( SELECT 1
           FROM clientes cl
             JOIN mensagens m ON m.cliente_id = cl.id
          WHERE "right"(cl.telefone, 8) = "right"(w.telefone, 8) AND m.tipo <> 'evento_sistema'::text
            AND COALESCE(m.linha_id, 'rd'::text) = ANY (sel.linhas))) AND NOT (EXISTS ( SELECT 1
           FROM wth_vendas_bi vb
          WHERE vb.codcli = w.codcli AND (vb.posicao = ANY (ARRAY['L - Liberado'::text, 'B - Bloqueado'::text, 'M - Montado'::text, 'F - Faturado'::text, 'P - Pendente'::text])) AND (vb.data_emissao AT TIME ZONE 'America/Sao_Paulo'::text)::date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date));
