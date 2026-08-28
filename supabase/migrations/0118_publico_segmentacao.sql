-- =============================================================================
-- 0118 · Segmentacao do publico: produto, localizacao, financeiro, frequencia.
--
-- O documento `variaveis-segmentacao-listas-template.md` lista 11 familias de
-- filtro. Quase todas ja existem no espelho `wth_` -- o que faltava era um jeito
-- BARATO de perguntar por elas.
--
-- ---------------------------------------------------------------------------
-- POR QUE VIEW AGREGADA, E NAO CONSULTA DIRETA NA TABELA
--
-- `wth_itens` tem 185.883 linhas (medido em 28/08/2026). Perguntar "quem comprou
-- selagem" varrendo item a item e caro e, pior, exige GROUP BY -- que o
-- PostgREST nao faz. Sem estas views, o motor teria de baixar milhares de linhas
-- e agregar no Node a cada previa, e a previa roda a cada tecla digitada.
--
-- As views agrupam por (cliente, dimensao, valor). Os predicados de `dimensao` e
-- `valor` sao chaves do GROUP BY, entao o Postgres os empurra para dentro da
-- agregacao em vez de agregar tudo e filtrar depois.
--
-- ---------------------------------------------------------------------------
-- POR QUE UMA VIEW SO PARA AS QUATRO DIMENSOES
--
-- Secao, departamento, marca e produto respondem a mesma pergunta ("o que este
-- cliente compra") e sao usados do mesmo jeito. Quatro views separadas dariam
-- quatro caminhos de codigo no motor para a mesma logica -- e o dia em que
-- alguem corrigisse um esqueceria os outros tres. Uma view com a coluna
-- `dimensao` mantem um caminho so.
--
-- Custo: 205.587 linhas (60.671 secao + 23.370 depto + 10.013 marca +
-- 111.533 produto). E view, nao materializada: acompanha o `wth-sync-tudo` de 10
-- em 10 minutos sem precisar de refresh proprio -- e sem virar mais uma peca que
-- pode ficar para tras em silencio.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) O que cada cliente compra, por dimensao
-- ---------------------------------------------------------------------------
create or replace view vw_cliente_item as
select codcli, 'secao'::text as dimensao, secao as valor,
       max(dt_venda) as ultima_compra, count(distinct cod_pedido) as pedidos,
       round(sum(vlr_item)::numeric, 2) as valor_total
from wth_itens where secao is not null group by codcli, secao
union all
select codcli, 'departamento', departamento,
       max(dt_venda), count(distinct cod_pedido), round(sum(vlr_item)::numeric, 2)
from wth_itens where departamento is not null group by codcli, departamento
union all
select codcli, 'marca', marca,
       max(dt_venda), count(distinct cod_pedido), round(sum(vlr_item)::numeric, 2)
from wth_itens where marca is not null group by codcli, marca
union all
select codcli, 'produto', codprod::text,
       max(dt_venda), count(distinct cod_pedido), round(sum(vlr_item)::numeric, 2)
from wth_itens where codprod is not null group by codcli, codprod;

comment on view vw_cliente_item is
  'O que cada cliente compra, por secao/departamento/marca/produto (0118). '
  'Alimenta os filtros "comprou", "nunca comprou" e "nao compra ha N dias" do disparo em massa.';

-- ---------------------------------------------------------------------------
-- 2) Retrato financeiro por cliente
--
-- ⚠️ `wth_ciclo` ja tem ticket medio e total de pedidos, mas cobre **1.114 de
-- 8.757 clientes** (13%) e depende do motor de ciclo, que pode estar DESLIGADO
-- em Mecanismos (§30). Usa-la como fonte destes filtros excluiria 87% da base em
-- silencio -- exatamente o tipo de corte invisivel que o disparo nao pode ter.
-- Esta view sai do faturamento cru e cobre os 6.545 clientes que ja compraram.
--
-- Regras da §10.8: venda e `tipo='VENDA'`, devolucao e `tipo='DEV'`, e
-- faturamento e sempre LIQUIDO (vendas menos devolucoes).
-- ---------------------------------------------------------------------------
create or replace view vw_cliente_financeiro as
with base as (
  select codcli,
         count(*) filter (where tipo = 'VENDA')                       as pedidos,
         sum(valor) filter (where tipo = 'VENDA')                     as bruto,
         sum(valor) filter (where tipo = 'DEV')                       as devolvido,
         max(data_fat) filter (where tipo = 'VENDA')                  as ultima_compra,
         min(data_fat) filter (where tipo = 'VENDA')                  as primeira_compra,
         max(data_fat) filter (where tipo = 'DEV')                    as ultima_devolucao
  from wth_faturamento
  group by codcli
),
ultimo as (
  select distinct on (codcli) codcli, valor as valor_ultimo_pedido
  from wth_faturamento where tipo = 'VENDA'
  order by codcli, data_fat desc, id desc
)
select b.codcli,
       b.pedidos,
       round(coalesce(b.bruto, 0)::numeric, 2)                                   as receita_bruta,
       round((coalesce(b.bruto, 0) - coalesce(b.devolvido, 0))::numeric, 2)      as receita_liquida,
       round(coalesce(b.devolvido, 0)::numeric, 2)                               as devolvido,
       case when coalesce(b.bruto, 0) > 0
            then round((coalesce(b.devolvido, 0) / b.bruto)::numeric, 4) end     as taxa_devolucao,
       case when b.pedidos > 0
            then round((coalesce(b.bruto, 0) / b.pedidos)::numeric, 2) end       as ticket_medio,
       round(coalesce(u.valor_ultimo_pedido, 0)::numeric, 2)                     as valor_ultimo_pedido,
       b.ultima_compra,
       b.primeira_compra,
       b.ultima_devolucao,
       case when b.ultima_compra is not null
            then ((now() at time zone 'America/Sao_Paulo')::date - b.ultima_compra)
       end                                                                       as dias_sem_comprar
from base b left join ultimo u on u.codcli = b.codcli
where b.pedidos > 0;

comment on view vw_cliente_financeiro is
  'Ticket, receita liquida, frequencia, recencia e devolucao por cliente, direto do '
  'faturamento (0118). Cobre TODA a base que ja comprou -- ao contrario de wth_ciclo, '
  'que cobre 13% e depende do motor de ciclo estar ligado.';

-- ---------------------------------------------------------------------------
-- 3) Indices para os predicados que o motor usa
--
-- Sem eles, "quem comprou selagem" faz Seq Scan nas 185 mil linhas a cada
-- previa -- e a previa roda a cada tecla.
-- ---------------------------------------------------------------------------
create index if not exists idx_wth_itens_secao        on wth_itens (secao)         where secao is not null;
create index if not exists idx_wth_itens_departamento on wth_itens (departamento)  where departamento is not null;
create index if not exists idx_wth_itens_marca        on wth_itens (marca)         where marca is not null;
create index if not exists idx_wth_endereco_bairro    on wth_endereco (bairro)     where bairro is not null;
create index if not exists idx_wth_endereco_cidade    on wth_endereco (cidade)     where cidade is not null;

-- As views herdam o RLS das tabelas-base? NAO: elas rodam como dono e atravessam
-- o RLS de `wth_*` (§12.2). Como as `wth_*` tem RLS ligado sem policy, a chave
-- anon nao le nem as tabelas nem -- por falta de GRANT -- estas views. O app usa
-- service_role no servidor, entao le normalmente. Nenhum GRANT e concedido aqui
-- de proposito.
