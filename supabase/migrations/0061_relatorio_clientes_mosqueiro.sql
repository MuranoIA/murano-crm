-- Relatório: clientes de MOSQUEIRO (distrito/ilha de Belém). Mosqueiro aparece na v2
-- como CIDADE, BAIRRO (ex.: "VILA (MOSQUEIRO)") ou dentro do ENDEREÇO — cobrimos os três
-- via wth_endereco (espelho). Junta nome/telefone/vendedor (wth_carteira) e recência de
-- compra (wth_vendas_bi + vw_ciclo_card). Sem período: é filtro de localização.
-- p_vendedor: slug (null = todas as carteiras/admin). Vendedor vê só os da sua carteira.
create or replace function public.relatorio_clientes_mosqueiro(
  p_vendedor text default null
)
returns table(
  codcli           integer,
  cliente          text,
  telefone         text,
  bairro           text,
  cidade           text,
  vendedor         text,
  ultima_compra    date,
  dias_sem_comprar integer,
  cliente_id       text
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
  mosq as (
    select codcli, cidade, bairro
    from wth_endereco
    where cidade ilike '%mosqueiro%' or bairro ilike '%mosqueiro%' or endereco ilike '%mosqueiro%'
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
  from mosq m
  left join wth_carteira c on c.codcli = m.codcli
  left join carteira_config cc on cc.rca_num = c.rca_num
  left join ultima ul on ul.codcli = m.codcli
  left join lateral (select dias_ausente from vw_ciclo_card where codcli = m.codcli limit 1) cl on true
  left join lateral (select cliente_id from wth_vinculo where codcli = m.codcli limit 1) vin on true
  where (p_vendedor is null or cc.slug = p_vendedor)
  order by c.nome nulls last;
$function$;
