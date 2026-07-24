-- =============================================================================
-- Adiciona à vw_funil a coluna `ultimas_mensagens` (jsonb): as 3 últimas
-- mensagens reais (ignora evento_sistema), mais recente primeiro, cada uma
-- { "c": conteudo, "e": enviada_por, "t": criada_em }. O front mostra até 3 bolhas.
-- Mantém `ultima_mensagem`/`ultima_enviada_por` (compat + ordenação/etapa).
--
-- CREATE OR REPLACE VIEW só aceita coluna nova no FINAL -> `ultimas_mensagens`
-- vem depois de `telefone` (que já era a última). Resto da lógica = migration 0004.
-- =============================================================================
create or replace view vw_funil as
select
  c.id                as cliente_id,
  c.nome_completo      as cliente,
  c.carteira           as vendedor,
  ult.criada_em        as ultima_atividade,
  ult.conteudo         as ultima_mensagem,
  ult.enviada_por      as ultima_enviada_por,
  case
    when ult.enviada_por = 'operator'
      and (ult.conteudo ilike '%*pedido faturado%' or ult.conteudo ilike '%*pedido finalizado%')
      and (ult.criada_em at time zone 'America/Sao_Paulo')::date
          >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
      then 'pedido_emitido'
    when venda.fechado_em is not null
      and venda.fechado_em >= ult.criada_em
      and (venda.fechado_em at time zone 'America/Sao_Paulo')::date
          >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
      then 'pedido_emitido'
    when ult.enviada_por = 'operator' and ult.tipo = 'template'
      then 'tentativa_contato'
    when ult.enviada_por = 'customer' and ult.criada_em < now() - interval '24 hours'
      then 'ociosos'
    when ult.enviada_por = 'operator'
      and (ult.conteudo ilike '%*pedido faturado%' or ult.conteudo ilike '%*pedido finalizado%')
      then 'ociosos'
    when venda.fechado_em is not null and venda.fechado_em >= ult.criada_em
      then 'ociosos'
    else 'negociacao'
  end                  as etapa,
  c.telefone           as telefone,
  msgs3.msgs           as ultimas_mensagens
from clientes c
join lateral (
  select m.criada_em, m.conteudo, m.enviada_por, m.tipo
  from mensagens m
  where m.cliente_id = c.id and m.tipo <> 'evento_sistema'
  order by m.criada_em desc
  limit 1
) ult on true
left join lateral (
  select max(a.fechado_em) as fechado_em
  from atendimentos a
  where a.cliente_id = c.id and a.tabulacao = 'venda_realizada'
) venda on true
left join lateral (
  select jsonb_agg(jsonb_build_object('c', sub.conteudo, 'e', sub.enviada_por, 't', sub.criada_em) order by sub.criada_em desc) as msgs
  from (
    select m2.conteudo, m2.enviada_por, m2.criada_em
    from mensagens m2
    where m2.cliente_id = c.id and m2.tipo <> 'evento_sistema'
    order by m2.criada_em desc
    limit 3
  ) sub
) msgs3 on true
where exists (
  select 1 from mensagens x
  where x.cliente_id = c.id and x.enviada_por = 'operator' and x.tipo <> 'evento_sistema'
)

union all

select
  'winthor:' || fp.codcli::text as cliente_id,
  fp.nome                       as cliente,
  case fp.rca_num when 45 then 'romulo' when 46 then 'luana' when 51 then 'kamilly' end as vendedor,
  null::timestamptz             as ultima_atividade,
  null::text                    as ultima_mensagem,
  null::text                    as ultima_enviada_por,
  'ociosos'                     as etapa,
  fp.telefone                   as telefone,
  null::jsonb                   as ultimas_mensagens
from vw_fila_prospeccao fp
where fp.rca_num in (45, 46, 51)
  and not exists (
    select 1 from clientes c2 where c2.telefone like '%' || right(fp.telefone, 8)
  );
