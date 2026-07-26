-- Campo "Time" (IS/ISR) por vendedor em carteira_config (0039 fez o add+populate).
alter table carteira_config add column if not exists time text;
update carteira_config set time = case when rca_num in (45,46,51) then 'ISR' else 'IS' end where time is null;

-- Relatório detalhado por PRODUTO (Excel do board). Colunas do exemplo bio_plastia:
-- Time, Consultor, Cód, Cliente, Telefone, Cidade, Produto, Qtd, Pedidos, Valor, Últ.
-- Compra do produto, Últ. Compra geral, Dias sem comprar. Fonte: wth_itens (agregado por
-- produto) + wth_carteira + wth_faturamento (última compra geral) + carteira_config
-- (time/slug). p_vendedor null = todos (admin); slug = só aquele vendedor. Só no murano-conversas.
create or replace function relatorio_produto(p_codprods integer[], p_vendedor text default null)
returns table (
  "time" text, consultor text, rca_num integer, cod_cliente integer, cliente text,
  telefone text, cidade text, produto text, qtd numeric, pedidos bigint,
  valor numeric, ult_produto date, ult_geral date, dias_sem_comprar integer, vendedor text
) language sql stable as $$
  with prod as (
    select i.codcli,
      string_agg(distinct i.produto, ' / ') as produto,
      sum(i.quantidade) as qtd,
      count(distinct i.cod_pedido) as pedidos,
      round(sum(i.vlr_item), 2) as valor,
      max(i.dt_venda)::date as ult_produto
    from wth_itens i
    where i.codprod = any(p_codprods)
    group by i.codcli
  ),
  ger as ( select codcli, max(data_fat)::date as ult_geral from wth_faturamento group by codcli )
  select cfg."time", w.rca_nome as consultor, w.rca_num,
    w.codcli, w.nome, w.telefone, w.cidade,
    p.produto, p.qtd, p.pedidos, p.valor, p.ult_produto, g.ult_geral,
    ((now() at time zone 'America/Sao_Paulo')::date - coalesce(g.ult_geral, p.ult_produto))::integer as dias_sem_comprar,
    cfg.slug as vendedor
  from prod p
  join wth_carteira w on w.codcli = p.codcli
  join carteira_config cfg on cfg.rca_num = w.rca_num and cfg.ativo
  left join ger g on g.codcli = p.codcli
  where (p_vendedor is null or cfg.slug = p_vendedor)
  order by w.rca_num, coalesce(g.ult_geral, p.ult_produto) desc nulls last;
$$;
grant execute on function relatorio_produto(integer[], text) to service_role;
