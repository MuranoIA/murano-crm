-- Relatório: clientes de SANTA BÁRBARA (do Pará) — irmão do de Mosqueiro.
-- Santa Bárbara é MUNICÍPIO (campo cidade: "SANTA BARBARA", "SANTA BARBARA DO PARA"...),
-- então filtra por cidade começando com 'santa barbara' (exclui "NOVA SANTA BARBARA").
-- Sem período (filtro de localização). p_vendedor: slug (null = todas as carteiras/admin).
create or replace function public.relatorio_clientes_santa_barbara(
  p_vendedor text default null
)
returns table(
  codcli integer, cliente text, telefone text, bairro text, cidade text,
  vendedor text, ultima_compra date, dias_sem_comprar integer, cliente_id text
)
language sql stable security definer set search_path to public
as $function$
  with hb as (select (now() at time zone 'America/Sao_Paulo')::date as hoje),
  dedup as (
    select distinct on (pedido) pedido, codcli, posicao, data_emissao
    from wth_vendas_bi order by pedido, id desc
  ),
  ativos as (
    select codcli, data_emissao from dedup
    where posicao = any (array['L - Liberado','B - Bloqueado','M - Montado','F - Faturado','P - Pendente'])
  ),
  ultima as (
    select codcli, max((data_emissao at time zone 'America/Sao_Paulo')::date) as ultima_compra
    from ativos group by codcli
  ),
  sb as (
    select codcli, cidade, bairro
    from wth_endereco
    where cidade ilike 'santa barbara%'
  )
  select
    m.codcli,
    coalesce(c.nome, 'cliente ' || m.codcli) as cliente,
    c.telefone,
    m.bairro,
    m.cidade,
    coalesce(cc.slug, nullif(btrim(regexp_replace(c.rca_nome, '^[0-9]+ *- *', '')), '')) as vendedor,
    coalesce(ul.ultima_compra, ((select hoje from hb) - cl.dias_ausente)) as ultima_compra,
    coalesce(cl.dias_ausente, ((select hoje from hb) - ul.ultima_compra))::integer as dias_sem_comprar,
    vin.cliente_id
  from sb m
  left join wth_carteira c on c.codcli = m.codcli
  left join carteira_config cc on cc.rca_num = c.rca_num
  left join ultima ul on ul.codcli = m.codcli
  left join lateral (select dias_ausente from vw_ciclo_card where codcli = m.codcli limit 1) cl on true
  left join lateral (select cliente_id from wth_vinculo where codcli = m.codcli limit 1) vin on true
  where (p_vendedor is null or cc.slug = p_vendedor)
  order by c.nome nulls last;
$function$;
