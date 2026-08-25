-- =============================================================================
-- 0099 · O interruptor de conversas vira SELETOR DE LINHAS.
--
-- Pedido do usuário (24/08/2026): poder marcar "RD Conversas", "Murano
-- Professional", ou as duas. Isso é a GENERALIZAÇÃO do booleano da 0098, não um
-- terceiro interruptor — `conversas_rd_visiveis = false` é exatamente "só a
-- Murano Professional marcada".
--
-- Por isso a coluna antiga é MIGRADA E REMOVIDA, não mantida ao lado. Dois
-- controles sobre o mesmo assunto acabam se contradizendo ("RD escondido" com
-- "mostrar RD" marcado) e ninguém sabe qual vence.
--
-- ---------------------------------------------------------------------------
-- AS LINHAS SAEM DA TABELA, NÃO DE UMA LISTA NO CÓDIGO
--
-- `chat_linha` já é o cadastro: hoje tem `rd` (Murano Pro, +55 91 2018-2357) e
-- `1264458800091787` (Murano Professional) ativas; Shop e o número de teste
-- ficaram `ativo=false` (§28.7). Ativar uma linha amanhã a faz aparecer no
-- seletor sozinha — §14.1, configuração em tabela, não em código.
--
-- `linhas_visiveis` NULO significa **todas as ativas**, e é o estado de origem.
-- Nulo em vez de uma lista congelada de propósito: com a lista, ativar uma linha
-- nova a deixaria invisível até alguém lembrar de marcá-la — falha silenciosa.
--
-- ---------------------------------------------------------------------------
-- UMA VIEW SÓ, QUE SE FILTRA SOZINHA
--
-- A 0098 criou `vw_funil_sem_rd`, um caso particular. Com N linhas isso viraria
-- N views. Aqui a view LÊ a config: `coalesce(m.linha_id,'rd') = any(<seleção>)`.
-- A `crm_config` tem uma linha só, então o subselect é avaliado uma vez por
-- consulta.
--
-- ⚠️ A `vw_funil` continua SEM FILTRO NENHUM, e isso não é descuido — o ETL
-- depende dela para saber o que sincronizar (src/etl/run.ts:132,154). Filtrada,
-- ele concluiria que nada está ativo e pararia de puxar o RD em silêncio. O
-- pedido é o oposto: o ETL segue alimentando o banco mesmo sem nada na tela.
-- =============================================================================

alter table crm_config add column if not exists linhas_visiveis text[];

comment on column crm_config.linhas_visiveis is
  'Linhas cujas conversas aparecem no board e no chat, por phone_number_id de chat_linha '
  '(a linha do RD tem o id sintetico "rd"). NULO = todas as linhas ativas, que e o estado '
  'de origem. NAO afeta o ETL nem o disparo em massa: esconder nao pode virar agir sem saber.';

-- Migra o booleano da 0098 antes de removê-lo. `true` (estado de origem, e o que
-- está em produção hoje) vira NULO = todas; `false` vira a lista das linhas
-- ativas menos o RD.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'crm_config'
                and column_name = 'conversas_rd_visiveis') then
    execute $mig$
      update crm_config set linhas_visiveis =
        case when conversas_rd_visiveis then null
             else array(select phone_number_id from chat_linha
                         where ativo and phone_number_id <> 'rd')
        end
      where id = 1
    $mig$;
    execute 'alter table crm_config drop column conversas_rd_visiveis';
  end if;
end $$;

-- A view particular da 0098 morre junto com o booleano que a escolhia.
drop view if exists vw_funil_sem_rd;

-- ---------------------------------------------------------------------------
-- vw_funil_visivel — a MESMA régua da vw_funil, enxergando só as linhas marcadas.
--
-- A expressão de `etapa` é copiada caractere a caractere da 0093 de propósito: o
-- pedido foi não mexer na classificação dos cards. Se a régua mudar, muda nas
-- duas — é para isso que este comentário existe.
--
-- Ramos, e por que cada um:
--   1   cliente com conversa VISÍVEL -> classificado pela régua normal
--   1b  cliente que só tem conversa em linha ESCONDIDA e que o ERP não alcança
--       -> `ociosos`, para ninguém sumir da tela sem aviso
--   2   prospecção (carteira do WinThor, sem conversa visível)
--   3   REMOVIDO: era o card sintético `venda:<codcli>`. O board já o descartava
--       (`etapa !== "pedido_emitido"` em /api/funil) e ele só aparecia, indevido,
--       na lista do chat. Os 39 são todos clientes de carteira ativa, então
--       continuam no board pelo ramo 2 ou pela coluna Pedido emitido, que vem da
--       nota fiscal (vw_pedido_bi_card) e não da conversa.
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
          WHERE x.cliente_id = c.id AND x.enviada_por = 'operator'::text AND x.tipo <> 'evento_sistema'::text
            AND COALESCE(x.linha_id, 'rd'::text) = ANY (sel.linhas))) AND (vln.cliente_id IS NULL OR ccr.slug IS NOT NULL)

UNION ALL
-- ramo 1b — só tem conversa em linha escondida e o ERP não alcança. Ver cabeçalho.
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
                   WHERE x.cliente_id = c.id AND x.enviada_por = 'operator'::text
                     AND x.tipo <> 'evento_sistema'::text))
    AND NOT (EXISTS ( SELECT 1 FROM mensagens m
                       WHERE m.cliente_id = c.id AND m.enviada_por = 'operator'::text
                         AND m.tipo <> 'evento_sistema'::text
                         AND COALESCE(m.linha_id, 'rd'::text) = ANY (sel.linhas)))
    AND NOT (EXISTS ( SELECT 1 FROM wth_vinculo v WHERE v.cliente_id = c.id))
    AND NOT (EXISTS ( SELECT 1 FROM wth_carteira w
                       WHERE length(regexp_replace(COALESCE(c.telefone, ''::text), '\D'::text, ''::text, 'g'::text)) >= 8
                         AND w.tel8 = "right"(regexp_replace(COALESCE(c.telefone, ''::text), '\D'::text, ''::text, 'g'::text), 8)))

UNION ALL
-- ramo 2 — prospecção, com o filtro de linha nos NOT EXISTS: sem ele, quem só
-- conversou numa linha escondida ficaria de fora daqui E do ramo 1, e sumiria.
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
          WHERE v.codcli = w.codcli AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text
            AND COALESCE(m.linha_id, 'rd'::text) = ANY (sel.linhas))) AND NOT (EXISTS ( SELECT 1
           FROM clientes cl
             JOIN mensagens m ON m.cliente_id = cl.id
          WHERE "right"(cl.telefone, 8) = "right"(w.telefone, 8) AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text
            AND COALESCE(m.linha_id, 'rd'::text) = ANY (sel.linhas))) AND NOT (EXISTS ( SELECT 1
           FROM wth_vendas_bi vb
          WHERE vb.codcli = w.codcli AND (vb.posicao = ANY (ARRAY['L - Liberado'::text, 'B - Bloqueado'::text, 'M - Montado'::text, 'F - Faturado'::text, 'P - Pendente'::text])) AND (vb.data_emissao AT TIME ZONE 'America/Sao_Paulo'::text)::date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date));

comment on view vw_funil_visivel is
  'Mesma regua da vw_funil, enxergando so as linhas marcadas em crm_config.linhas_visiveis '
  '(NULO = todas as ativas de chat_linha). Lida pelo board e pelo chat. A vw_funil NAO pode '
  'ser filtrada no lugar desta: o ETL depende dela para saber o que sincronizar e pararia de '
  'puxar o RD em silencio. Sem o ramo sintetico venda:<codcli>, que o board ja descartava.';
