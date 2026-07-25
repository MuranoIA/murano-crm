-- =============================================================================
-- Helpers de leitura do filtro por produto (feature no board):
--  - vw_produtos_venda: lista de produtos p/ o multi-select (~415 linhas)
--  - clientes_por_produto(): dado produtos + período, devolve os identificadores
--    (codclis + cliente_ids do RD + telefones8) dos clientes que compraram —
--    AGREGADO no banco p/ não esbarrar no teto de 1000 linhas do PostgREST.
-- Aplicar SOMENTE no murano-conversas (wtunzezigncwjpcqsfzk).
-- =============================================================================

create or replace view vw_produtos_venda as
select codprod,
       max(produto)           as produto,
       count(distinct codcli)  as clientes,
       max(dt_venda)          as ultima_venda
from wth_itens
group by codprod;
grant select on vw_produtos_venda to service_role;

create or replace function public.clientes_por_produto(
  p_codprods integer[],
  p_desde date,
  p_ate date default null
) returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with cc as (
    select distinct codcli
    from wth_itens
    where codprod = any(p_codprods)
      and dt_venda >= p_desde
      and (p_ate is null or dt_venda <= p_ate)
      and codcli is not null
  )
  select jsonb_build_object(
    'codclis',     coalesce((select jsonb_agg(codcli) from cc), '[]'::jsonb),
    'cliente_ids', coalesce((select jsonb_agg(distinct v.cliente_id)
                             from wth_vinculo v join cc on cc.codcli = v.codcli), '[]'::jsonb),
    'tel8',        coalesce((select jsonb_agg(distinct right(regexp_replace(w.telefone,'\D','','g'),8))
                             from wth_carteira w join cc on cc.codcli = w.codcli
                             where w.telefone is not null
                               and length(regexp_replace(w.telefone,'\D','','g')) >= 8), '[]'::jsonb),
    'total',       (select count(*) from cc)
  );
$function$;
grant execute on function public.clientes_por_produto(integer[], date, date) to service_role;
