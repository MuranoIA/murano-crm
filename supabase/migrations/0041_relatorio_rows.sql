-- Relatório GERAL (Excel do board): reflete os filtros ATIVOS do dashboard. O cliente
-- envia os codclis dos cards filtrados + (opcional) codprods do filtro de produto; a função
-- devolve linhas detalhadas (base + ciclo + produto). Fonte: wth_carteira + carteira_config
-- (time/slug) + wth_ciclo (análise preditiva) + wth_faturamento (últ. compra) + wth_itens
-- (produto). p_vendedor null = admin (todos); slug = escopo forçado do vendedor. Rota
-- /api/relatorio monta o xlsx (Resumo + Base Completa + aba por consultor no admin).
-- Aplicar só no murano-conversas.
create or replace function relatorio_rows(p_codclis integer[], p_codprods integer[] default null, p_vendedor text default null)
returns table (
  "time" text, consultor text, cod_cliente integer, cliente text, telefone text, cidade text,
  ramo text, ciclo text, score numeric, dias_ausente integer, ciclo_medio numeric, ticket_medio numeric,
  total_pedidos integer, rec_total numeric, tendencia text, acao text,
  ult_compra date, dias_sem_comprar integer,
  produto text, qtd numeric, pedidos_produto bigint, valor_produto numeric, ult_compra_produto date, vendedor text
) language sql stable as $$
  with ger as ( select codcli, max(data_fat)::date as ult_geral from wth_faturamento where codcli = any(p_codclis) group by codcli ),
  prod as (
    select i.codcli, string_agg(distinct i.produto, ' / ') as produto, sum(i.quantidade) as qtd,
      count(distinct i.cod_pedido) as pedidos, round(sum(i.vlr_item),2) as valor, max(i.dt_venda)::date as ult_prod
    from wth_itens i
    where p_codprods is not null and coalesce(array_length(p_codprods,1),0) > 0 and i.codprod = any(p_codprods) and i.codcli = any(p_codclis)
    group by i.codcli
  )
  select cfg."time", w.rca_nome, w.codcli, w.nome, w.telefone, w.cidade,
    cy.ramo, cy.tipo_oportunidade, cy.score_urgencia, cy.dias_ausente, cy.ciclo_medio, cy.ticket_medio,
    cy.total_pedidos, cy.rec_total, cy.tendencia, cy.acao_recomendada,
    g.ult_geral, ((now() at time zone 'America/Sao_Paulo')::date - g.ult_geral)::integer,
    p.produto, p.qtd, p.pedidos, p.valor, p.ult_prod, cfg.slug
  from unnest(p_codclis) as a(codcli)
  join wth_carteira w on w.codcli = a.codcli
  join carteira_config cfg on cfg.rca_num = w.rca_num and cfg.ativo
  left join wth_ciclo cy on cy.codcli = a.codcli
  left join ger g on g.codcli = a.codcli
  left join prod p on p.codcli = a.codcli
  where (p_vendedor is null or cfg.slug = p_vendedor)
  order by w.rca_num, g.ult_geral desc nulls last;
$$;
grant execute on function relatorio_rows(integer[], integer[], text) to service_role;
