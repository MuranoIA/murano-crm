-- =============================================================================
-- 0073 · Vínculo por TELEFONE (fallback do CPF) + funil respeita o RCA do time
--
-- Problema (caso J.D.C., 06/08/2026): contato do RD sem CPF não ganha wth_vinculo,
-- então a vw_funil cai no fallback da tag `clientes.carteira` — que fica
-- DESATUALIZADA quando o RCA troca no WinThor. Efeito duplo: o card fica no board
-- do vendedor ANTIGO e o dedup da prospecção esconde o cliente do board do NOVO.
-- Medido antes desta migration: 683 contatos sem vínculo; 598 com match ÚNICO de
-- telefone (tel8) na wth_carteira; 4 ambíguos; 17 com RCA divergente da tag.
--
-- Mudanças:
-- 1) wth_reconciliar_vinculos(): ganha a passada 2 (telefone) — cria vínculo com
--    origem 'telefone' quando o tel8 do contato casa com EXATAMENTE UM codcli da
--    wth_carteira. Ambíguos ficam de fora por segurança. Se o CPF aparecer depois,
--    a passada 1 (CPF) sobrescreve o vínculo (origem vira 'cpf'); 'manual' é
--    intocável como antes.
-- 2) vw_funil: cliente COM vínculo cujo RCA NÃO resolve para uma carteira_config
--    ativa (ex.: transferido para RCA fora do time do CRM) SAI do funil — decisão
--    do usuário em 06/08/2026. Sem vínculo, continua o fallback da tag (cobre o
--    contato novo que ainda não tem cadastro no WinThor).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) O check de origem só aceitava 'cpf' e 'manual' — inclui 'telefone'
-- ---------------------------------------------------------------------------
alter table wth_vinculo drop constraint wth_vinculo_origem_check;
alter table wth_vinculo add constraint wth_vinculo_origem_check
  check (origem = any (array['cpf'::text, 'manual'::text, 'telefone'::text]));

-- ---------------------------------------------------------------------------
-- 1) Reconciliação: CPF (passada 1, inalterada) + telefone (passada 2, nova)
-- ---------------------------------------------------------------------------
create or replace function public.wth_reconciliar_vinculos()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cpf integer;
  v_tel integer;
begin
  -- Passada 1 — CPF (idêntica à versão anterior)
  with candidatos as (
    select
      c.id  as cliente_id,
      w.codcli,
      w.cpf,
      row_number() over (partition by c.id order by w.codcli) as rn
    from clientes c
    join wth_carteira w
      on w.cpf = regexp_replace(coalesce(c.cpf, ''), '[^0-9]', '', 'g')
    where coalesce(c.cpf, '') <> ''
      and w.cpf is not null
  )
  insert into wth_vinculo (cliente_id, codcli, cpf, origem, conferido_em)
  select cliente_id, codcli, cpf, 'cpf', now()
  from candidatos
  where rn = 1
  on conflict (cliente_id) do update
    set codcli       = excluded.codcli,
        cpf          = excluded.cpf,
        origem       = 'cpf',
        conferido_em = now()
    where wth_vinculo.origem <> 'manual';

  get diagnostics v_cpf = row_count;

  -- Passada 2 — telefone (só para quem AINDA não tem vínculo): match único de tel8
  with sem_vinculo as (
    select
      c.id as cliente_id,
      right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8) as tel8
    from clientes c
    where not exists (select 1 from wth_vinculo v where v.cliente_id = c.id)
      and length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) >= 8
  ),
  unicos as (
    select s.cliente_id, min(w.codcli) as codcli, min(coalesce(w.cpf, '')) as cpf
    from sem_vinculo s
    join wth_carteira w on w.tel8 = s.tel8
    group by s.cliente_id
    having count(distinct w.codcli) = 1
  )
  insert into wth_vinculo (cliente_id, codcli, cpf, origem, conferido_em)
  select cliente_id, codcli, cpf, 'telefone', now()
  from unicos
  on conflict (cliente_id) do nothing;

  get diagnostics v_tel = row_count;
  return v_cpf + v_tel;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2) vw_funil: com vínculo, o RCA manda — fora do time = fora do funil.
--    (Definição idêntica à viva em 06/08/2026, exceto a condição nova no WHERE
--     do 1º branch: `and (vln.cliente_id is null or ccr.slug is not null)`.)
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
    vln.codcli
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
          WHERE x.cliente_id = c.id AND x.enviada_por = 'operator'::text AND x.tipo <> 'evento_sistema'::text))
    AND (vln.cliente_id IS NULL OR ccr.slug IS NOT NULL)
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
    w.codcli
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
    vm.codcli
   FROM vw_vendas_mes_cliente vm
  WHERE vm.cliente_id_vinculo IS NULL;
