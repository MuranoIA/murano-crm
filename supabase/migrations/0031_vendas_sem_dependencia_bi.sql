-- =============================================================================
-- Fecha a fonte de vendas 100% NOSSA, sem depender do módulo bi_ (do ranking, que
-- pode sair do ar). Garante que as views de venda NÃO descontam cancelados via
-- bi_cancelados_dia nem faturamento_cancelados (este super-flagra vendas válidas
-- F-Faturado). O filtro de estados ativos {L,B,M,F,P} + dedup por pedido (max id)
-- já exclui os cancelamentos reais. Fontes: wth_vendas_bi (espelho da v2, sync
-- nossa). Bate com o ranking (Romulo hoje R$735,90). Aplicar só no murano-conversas.
-- (Durante a iteração criou-se wth_cancelados; aqui é removida por não ser confiável.)
-- =============================================================================
drop table if exists wth_cancelados;
drop function if exists public.wth_sync_cancelados_http(integer);

create or replace view vw_vendas_bi_total as
 with hb as ( select (now() at time zone 'America/Sao_Paulo')::date as hoje ),
 dedup as ( select distinct on (pedido) pedido, vlr_atendido, nome_usuario, codcli, posicao, data_emissao,
          lower(split_part(btrim(nome_usuario),' ',1)) as vendedor_slug from wth_vendas_bi order by pedido, id desc ),
 ativos as ( select * from dedup where posicao in ('L - Liberado','B - Bloqueado','M - Montado','F - Faturado','P - Pendente') ),
 per as ( select 'hoje'::text as periodo, hoje as ini, hoje as fim from hb
   union all select 'ontem', hoje-1, hoje-1 from hb union all select 'semana', hoje-6, hoje from hb
   union all select 'quinzena', hoje-14, hoje from hb union all select 'mes', date_trunc('month', hoje)::date, hoje from hb
   union all select 'todos', '1900-01-01'::date, hoje from hb )
 select p.periodo, a.vendedor_slug, count(distinct a.codcli) as clientes, count(*) as vendas, round(sum(a.vlr_atendido), 2) as total
 from per p join ativos a on (a.data_emissao at time zone 'America/Sao_Paulo')::date between p.ini and p.fim
 group by p.periodo, a.vendedor_slug;
