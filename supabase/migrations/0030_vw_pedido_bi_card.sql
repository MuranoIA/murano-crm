-- =============================================================================
-- Coluna Pedido emitido passa a vir das VENDAS (fonte NOSSA wth_vendas_bi, espelho
-- da v2 pela nossa sync — 0028), não mais do wth_faturamento F-Faturado (que dava 0
-- hoje pq as vendas ainda estão em Liberado/Pendente). Regra do ranking: dedup por
-- pedido (max id), estados ativos {L,B,M,F,P}, por data_emissao (Belém). 1 linha por
-- (período, vendedor, cliente): `valor` = TOTAL DO MÊS do cliente. Nome/telefone via
-- wth_carteira; cliente_id via wth_vinculo. Zero dependência do módulo bi_ (cancelados
-- descartados: o estado ativo + dedup já tira os cancelamentos reais; faturamento_
-- cancelados da v2 super-flagra vendas válidas). Aplicar só no murano-conversas.
-- =============================================================================
create or replace view vw_pedido_bi_card as
 with hb as ( select (now() at time zone 'America/Sao_Paulo')::date as hoje ),
 dedup as ( select distinct on (pedido) pedido, vlr_atendido, nome_usuario, codcli, posicao, data_emissao,
          lower(split_part(btrim(nome_usuario),' ',1)) as vendedor_slug from wth_vendas_bi order by pedido, id desc ),
 ativos as ( select * from dedup where posicao in ('L - Liberado','B - Bloqueado','M - Montado','F - Faturado','P - Pendente') ),
 mes_cli as ( select a.codcli, round(sum(a.vlr_atendido),2) as valor_mes from ativos a, hb
     where (a.data_emissao at time zone 'America/Sao_Paulo')::date >= date_trunc('month', hb.hoje)::date group by a.codcli ),
 per as ( select 'hoje'::text as periodo, hoje as ini, hoje as fim from hb
   union all select 'ontem', hoje-1, hoje-1 from hb union all select 'semana', hoje-6, hoje from hb
   union all select 'quinzena', hoje-14, hoje from hb union all select 'mes', date_trunc('month', hoje)::date, hoje from hb
   union all select 'todos', '1900-01-01'::date, hoje from hb )
 select p.periodo, a.vendedor_slug, a.codcli, coalesce(max(wc.nome), 'cliente ' || a.codcli) as cliente,
   max(wc.telefone) as telefone, max(vin.cliente_id) as cliente_id, count(*) as pedidos, max(mc.valor_mes) as valor, max(a.data_emissao)::date as ultima_compra
 from per p join ativos a on (a.data_emissao at time zone 'America/Sao_Paulo')::date between p.ini and p.fim
   left join wth_carteira wc on wc.codcli = a.codcli left join wth_vinculo vin on vin.codcli = a.codcli left join mes_cli mc on mc.codcli = a.codcli
 group by p.periodo, a.vendedor_slug, a.codcli;
grant select on vw_pedido_bi_card to service_role;
