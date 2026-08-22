-- 0093 — RCA e carteira do RD visíveis no card + lista de conflitos para o supervisor.
--
-- CONTEXTO (medido em 22/08/2026, ANTES de escrever isto — corrige o que os docs sugeriam):
-- A `vw_funil` JÁ era RCA-first. `vendedor` é COALESCE(ccr.slug, c.carteira), onde `ccr`
-- vem do RCA do WinThor via wth_vinculo -> wth_carteira. Das 445 linhas de
-- `vw_divergencia_carteira`, 150 aparecem no board e TODAS as 150 na coluna do RCA,
-- nenhuma na da carteira do RD. Ou seja: o card nunca esteve na coluna errada.
-- O que faltava era o card DIZER que as duas atribuições discordam — quem atende no
-- RD não é quem fatura no ERP.
--
-- Esta migration NÃO muda regra de negócio: `vendedor`, `etapa` e o WHERE ficam
-- idênticos. Só expõe dois campos que já estavam nos joins existentes (zero join novo
-- no ramo 1 — importa porque /api/funil já roda em ~3,4s, §12.6) e cria a view de
-- conflitos para o supervisor.

-- ---------------------------------------------------------------------------
-- 1) vw_funil + rca_num + carteira_rd
--
--    Colunas ACRESCENTADAS no fim. Nenhuma existente muda de nome, tipo ou posição —
--    CREATE OR REPLACE VIEW falha se mudar, e levaria junto as views que dependem desta.
--    NÃO declarar security_invoker: a view tem que continuar rodando como dono para
--    atravessar o RLS das tabelas-base (§12.5).
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
    wcar.rca_num,                 -- NOVO: quem FATURA (RCA oficial do WinThor)
    c.carteira AS carteira_rd     -- NOVO: quem ATENDE (carteira no RD Conversas)
   FROM clientes c
     JOIN LATERAL ( SELECT m.criada_em,
            m.conteudo,
            m.enviada_por,
            m.tipo
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
           FROM ( SELECT m2.conteudo,
                    m2.enviada_por,
                    m2.criada_em
                   FROM mensagens m2
                  WHERE m2.cliente_id = c.id AND m2.tipo <> 'evento_sistema'::text
                  ORDER BY m2.criada_em DESC
                 LIMIT 3) sub) msgs3 ON true
     LEFT JOIN wth_vinculo vln ON vln.cliente_id = c.id
     LEFT JOIN wth_carteira wcar ON wcar.codcli = vln.codcli
     LEFT JOIN carteira_config ccr ON ccr.rca_num = wcar.rca_num AND ccr.ativo
  WHERE (EXISTS ( SELECT 1
           FROM mensagens x
          WHERE x.cliente_id = c.id AND x.enviada_por = 'operator'::text AND x.tipo <> 'evento_sistema'::text)) AND (vln.cliente_id IS NULL OR ccr.slug IS NOT NULL)
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
    NULL::text AS carteira_rd     -- prospecção nunca teve conversa no RD
   FROM wth_carteira w
     JOIN carteira_config cc ON cc.rca_num = w.rca_num AND cc.ativo
  WHERE w.ativo IS TRUE AND NOT (EXISTS ( SELECT 1
           FROM wth_vinculo v
             JOIN mensagens m ON m.cliente_id = v.cliente_id
          WHERE v.codcli = w.codcli AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text)) AND NOT (EXISTS ( SELECT 1
           FROM clientes cl
             JOIN mensagens m ON m.cliente_id = cl.id
          WHERE "right"(cl.telefone, 8) = "right"(w.telefone, 8) AND m.enviada_por = 'operator'::text AND m.tipo <> 'evento_sistema'::text)) AND NOT (EXISTS ( SELECT 1
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
    ccv.rca_num,                  -- carteira_config tem 7 linhas: join desprezível
    NULL::text AS carteira_rd
   FROM vw_vendas_mes_cliente vm
     LEFT JOIN carteira_config ccv ON ccv.slug = vm.carteira AND ccv.ativo
  WHERE vm.cliente_id_vinculo IS NULL;

-- ---------------------------------------------------------------------------
-- 2) vw_carteira_conflito — a lista que o supervisor recebe.
--
--    A `vw_divergencia_carteira` (do módulo wth_) responde "discordam?" com sim/não.
--    Isso não basta para agir: das 445, a maioria é o negócio funcionando — IS/ISR
--    atendendo cliente cujo RCA pertence ao GC ou a um vendedor de fora. Tratar todas
--    como "corrigir" produziria 3 pedidos indevidos para cada pedido legítimo, e a
--    equipe aprenderia a ignorar o aviso.
--
--    CLASSIFICAÇÃO — derivada de `carteira_config`, sem mapa de times no código
--    (§14.1: vendedor é configuração, não código). RCA que não está em carteira_config
--    é, por definição, de fora do CRM (GC ou externo).
--
--      mesmo_time      -> quem atende e quem fatura são do MESMO time e mesmo assim
--                         discordam. É quase sempre transferência feita de um lado só.
--                         ACIONÁVEL.
--      entre_times     -> times diferentes, ambos nossos (ex.: IS atende, RCA é do ISR).
--                         Pode ser legítimo; mostrar sem alarme.
--      rca_fora_do_crm -> RCA não é de nenhuma carteira ativa. Legítimo na maioria dos
--                         casos E é o grupo que some do board (o WHERE da vw_funil
--                         exige ccr.slug not null quando há vínculo).
-- ---------------------------------------------------------------------------
create or replace view vw_carteira_conflito as
with base as (
  select
    d.cliente_id,
    d.nome_completo,
    d.codcli,
    d.carteira_rdconversas                     as carteira_rd,
    d.rca_num,
    d.rca_oficial_winthor                      as rca_nome,
    cc_rd."time"                                as time_rd,
    cc_rca.slug                                as carteira_do_rca,
    cc_rca."time"                              as time_rca
  from vw_divergencia_carteira d
  left join carteira_config cc_rd  on cc_rd.slug     = d.carteira_rdconversas and cc_rd.ativo
  left join carteira_config cc_rca on cc_rca.rca_num = d.rca_num              and cc_rca.ativo
)
select
  b.cliente_id,
  b.nome_completo,
  b.codcli,
  b.carteira_rd,
  b.carteira_do_rca,
  b.rca_num,
  b.rca_nome,
  b.time_rd,
  b.time_rca,
  case
    when b.time_rca is null                 then 'rca_fora_do_crm'
    when b.time_rd  = b.time_rca            then 'mesmo_time'
    else                                         'entre_times'
  end                                        as classe,
  (f.cliente_id is not null)                 as no_board,
  u.ultima_atividade,
  cli.telefone
from base b
left join vw_funil f  on f.cliente_id  = b.cliente_id
left join clientes cli on cli.id       = b.cliente_id
left join lateral (
  select max(m.criada_em) as ultima_atividade
  from mensagens m
  where m.cliente_id = b.cliente_id and m.tipo <> 'evento_sistema'
) u on true;

comment on view vw_carteira_conflito is
  'Divergencias carteira(RD) x RCA(WinThor) classificadas por time. classe=mesmo_time e o grupo acionavel; no_board=false indica cliente invisivel no board e no chat.';
