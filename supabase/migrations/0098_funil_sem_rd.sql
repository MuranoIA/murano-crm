-- =============================================================================
-- 0098 · Segundo interruptor: esconder as conversas vindas do RD Conversas.
--
-- Pedido do usuário (24/08/2026), textualmente: NÃO mexer na régua que
-- classifica os cards nas 5 colunas — mexer no que ALIMENTA a régua. Sem os
-- gatilhos de conversa, o card cai naturalmente em prospecção ou ociosos.
--
-- "Conversa do RD" = mensagem com `linha_id` NULO. O conceito de linha nasceu
-- no webhook da Meta (§23.4): só mensagem da Cloud carrega `linha_id`. Ausente
-- da coluna = veio do RD. Por isso o filtro é uma condição só, e barata: o
-- índice parcial `idx_msg_linha` já existe.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA VIEW NOVA, E NÃO UM FILTRO NA `vw_funil`
--
-- **O ETL LÊ A `vw_funil`** para decidir o que sincronizar:
--   src/etl/run.ts — `.gte("ultima_atividade", cutoff)` e `.eq("etapa","negociacao")`
--
-- Filtrar a view existente faria o ETL concluir que nada está ativo e PARAR DE
-- PUXAR O RD — exatamente o contrário do que foi pedido (o ETL fica rodando).
-- E falharia em silêncio: nenhum erro, só dados que param de chegar.
--
-- O preço é duplicação: as duas views precisam ser mantidas em sincronia. É
-- consciente, e some quando o board migrar para a fonte do ERP.
--
-- ---------------------------------------------------------------------------
-- O QUE MUDA, RAMO A RAMO (medido em 24/08/2026)
--
--   ramo 1  conversa visível .... 3.847 -> 2      (só Cloud tem linha_id)
--   ramo 1b NOVO: órfãos ........ 0 -> 75         (ver abaixo)
--   ramo 2  prospecção .......... 820 -> 4.091
--   ramo 3  venda sem contato ... inalterado (é nota fiscal, não conversa)
--
-- O RAMO 1b EXISTE PARA NINGUÉM SUMIR. São 75 contatos que estão no board hoje
-- só por causa de uma conversa do RD e que a prospecção NÃO alcança, porque não
-- têm vínculo nem telefone batendo no WinThor. Sem este ramo eles evaporariam
-- sem aviso. Entram como `ociosos` — não `prospeccao`, que significa "cliente da
-- carteira nunca contatado", e estes foram contatados — com `ultima_atividade`
-- NULA, porque atividade visível é justamente o que não temos.
--
-- Consequência da data nula, a mesma da prospecção: só aparecem no filtro de
-- período "todos". É honesto: filtrar por "hoje" e vê-los ali seria mentira.
--
-- SEM CARD DUPLICADO: os três ramos de cliente são mutuamente exclusivos —
--   ramo 1  tem conversa Cloud
--   ramo 1b não tem conversa Cloud E não é alcançável pelo ERP
--   ramo 2  não tem conversa Cloud E vem do ERP
-- =============================================================================

alter table crm_config
  add column if not exists conversas_rd_visiveis boolean not null default true;

comment on column crm_config.conversas_rd_visiveis is
  'Conversas do RD Conversas (mensagens sem linha_id) aparecem no board e no chat? '
  'false faz o board ler vw_funil_sem_rd e o chat listar so conversas da Cloud. '
  'NAO afeta o ETL, que continua ingerindo o RD normalmente, nem o disparo em massa, '
  'que precisa enxergar o contato real para nao re-abordar quem esta em conversa.';

-- ---------------------------------------------------------------------------
-- vw_funil_sem_rd — a MESMA régua da vw_funil, enxergando só mensagem da Cloud.
--
-- A expressão de `etapa` é copiada caractere a caractere da 0093 de propósito:
-- o pedido foi não mexer na classificação. Se um dia a régua mudar, muda nas
-- duas — e é por isso que este comentário existe.
-- ---------------------------------------------------------------------------
create or replace view vw_funil_sem_rd as
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
     JOIN LATERAL ( SELECT m.criada_em,
            m.conteudo,
            m.enviada_por,
            m.tipo
           FROM mensagens m
          WHERE m.cliente_id = c.id AND m.tipo <> 'evento_sistema'::text
            AND m.linha_id IS NOT NULL
          ORDER BY m.criada_em DESC
         LIMIT 1) ult ON true
     LEFT JOIN ( SELECT vw_vendas_mes_cliente.cliente_id_vinculo AS cliente_id,
            vw_vendas_mes_cliente.valor_mes,
            vw_vendas_mes_cliente.data_fat
           FROM vw_vendas_mes_cliente
          WHERE vw_vendas_mes_cliente.cliente_id_vinculo IS NOT NULL) nf ON nf.cliente_id = c.id
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('c', sub.conteudo, 'e', sub.enviada_por, 't', sub.criada_em) ORDER BY sub.criada_em DESC) AS msgs
           FROM ( SELECT m2.conteudo,
                    m2.enviada_por,
                    m2.criada_em
                   FROM mensagens m2
                  WHERE m2.cliente_id = c.id AND m2.tipo <> 'evento_sistema'::text
                    AND m2.linha_id IS NOT NULL
                  ORDER BY m2.criada_em DESC
                 LIMIT 3) sub) msgs3 ON true
     LEFT JOIN wth_vinculo vln ON vln.cliente_id = c.id
     LEFT JOIN wth_carteira wcar ON wcar.codcli = vln.codcli
     LEFT JOIN carteira_config ccr ON ccr.rca_num = wcar.rca_num AND ccr.ativo
  WHERE (EXISTS ( SELECT 1
           FROM mensagens x
          WHERE x.cliente_id = c.id AND x.enviada_por = 'operator'::text AND x.tipo <> 'evento_sistema'::text
            AND x.linha_id IS NOT NULL)) AND (vln.cliente_id IS NULL OR ccr.slug IS NOT NULL)

UNION ALL
-- ramo 1b — quem só tem conversa no RD e o ERP não alcança. Ver cabeçalho.
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
  WHERE (EXISTS ( SELECT 1
           FROM mensagens x
          WHERE x.cliente_id = c.id AND x.enviada_por = 'operator'::text AND x.tipo <> 'evento_sistema'::text))
    AND NOT (EXISTS ( SELECT 1
           FROM mensagens m
          WHERE m.cliente_id = c.id AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text
            AND m.linha_id IS NOT NULL))
    AND NOT (EXISTS ( SELECT 1 FROM wth_vinculo v WHERE v.cliente_id = c.id))
    AND NOT (EXISTS ( SELECT 1
           FROM wth_carteira w
          WHERE length(regexp_replace(COALESCE(c.telefone, ''::text), '\D'::text, ''::text, 'g'::text)) >= 8
            AND w.tel8 = "right"(regexp_replace(COALESCE(c.telefone, ''::text), '\D'::text, ''::text, 'g'::text), 8)))

UNION ALL
-- ramo 2 — prospecção. Idêntico à vw_funil, com o filtro de linha nos NOT EXISTS:
-- sem ele, quem só conversou pelo RD ficaria de fora daqui E do ramo 1, e sumiria.
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
          WHERE v.codcli = w.codcli AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text
            AND m.linha_id IS NOT NULL)) AND NOT (EXISTS ( SELECT 1
           FROM clientes cl
             JOIN mensagens m ON m.cliente_id = cl.id
          WHERE "right"(cl.telefone, 8) = "right"(w.telefone, 8) AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text
            AND m.linha_id IS NOT NULL)) AND NOT (EXISTS ( SELECT 1
           FROM wth_vendas_bi vb
          WHERE vb.codcli = w.codcli AND (vb.posicao = ANY (ARRAY['L - Liberado'::text, 'B - Bloqueado'::text, 'M - Montado'::text, 'F - Faturado'::text, 'P - Pendente'::text])) AND (vb.data_emissao AT TIME ZONE 'America/Sao_Paulo'::text)::date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date))

UNION ALL
-- ramo 3 — venda do mês sem contato vinculado. Nota fiscal, não conversa: intacto.
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

comment on view vw_funil_sem_rd is
  'Mesma regua da vw_funil, enxergando so mensagem da Cloud (linha_id nao nulo). '
  'Lida pelo board e pelo chat quando crm_config.conversas_rd_visiveis = false. '
  'A vw_funil NAO pode ser filtrada no lugar desta: o ETL depende dela para saber '
  'o que sincronizar (src/etl/run.ts) e pararia de puxar o RD em silencio.';
