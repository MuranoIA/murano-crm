-- Filtro "ainda não comprou X, mas já compra a linha" no board (cross-sell).
-- Espelha o padrão do filtro por produto (vw_produtos_venda + clientes_por_produto)
-- e do filtro por cidade (migration 0068).
--
-- Caso de uso real (vendedora): "quero os clientes que ainda não compraram A-LIZZ
-- mas já compraram alguma outra selagem". Alvo = MASC A LIZZ MURANO 1L (codprod
-- 20920); linha = os outros produtos do mesmo departamento (ESCOVAS/ALISANTES).
--
-- O QUE DEFINE "LINHA": o agrupamento vem do WinThor, em wth_itens —
--   departamento (13 valores, ex.: ESCOVAS/ALISANTES) -> é o que a equipe chama de
--     "linha"; é o padrão do filtro;
--   secao (~150 valores, ex.: MASC A LIZZ 1L) -> quase por produto, serve como
--     recorte mais fino quando a seção agrupa mais de um item;
--   marca (MURANO / MAXILINE / ...).
-- Quem resolve a linha é o FRONT (já tem a lista inteira de produtos em memória),
-- e manda os codprods explícitos — assim a vendedora pode destravar/destrancar
-- itens da linha sem migration nenhuma. Por isso a view abaixo ganha as 3 colunas.
--
-- cat_produtos.categoria ("Alisamento & Selagem") NÃO serve aqui: é o catálogo
-- curado da tela /catalogos, com 52 itens, e nem inclui o A-LIZZ.

-- ---------------------------------------------------------------------------
-- 1) Lista de produtos do filtro + o agrupamento de cada um.
--    Colunas antigas (codprod, produto, clientes, ultima_venda) intactas —
--    /api/produtos e quem mais lê a view continuam funcionando igual.
--    mode() e não max(): há codprod que aparece com marca diferente em linhas
--    diferentes (ex.: 20870 como MAXILINE e SUPERMAXI) — vale a mais frequente.
-- ---------------------------------------------------------------------------
create or replace view public.vw_produtos_venda as
  select
    codprod,
    max(produto)                                                     as produto,
    count(distinct codcli)                                           as clientes,
    max(dt_venda)                                                    as ultima_venda,
    mode() within group (order by departamento)                      as departamento,
    mode() within group (order by secao)                             as secao,
    mode() within group (order by marca)                             as marca
  from public.wth_itens
  group by codprod;

-- ---------------------------------------------------------------------------
-- 2) Quem já compra a linha e AINDA NÃO comprou o produto alvo.
--    Devolve os IDENTIFICADORES dos clientes (codclis + cliente_ids do RD +
--    telefones8), agregados no banco — evita o teto de 1000 linhas do PostgREST.
--    O board casa cada card por qualquer um deles e filtra em memória.
--
--    ASSIMETRIA PROPOSITAL DAS DATAS: o período (p_desde/p_ate) vale só para a
--    LINHA — "já comprou selagem recentemente". O alvo é varrido no histórico
--    INTEIRO: "ainda não comprou" só é verdade se nunca comprou. Um período no
--    alvo transformaria o filtro em "parou de comprar A-LIZZ", que é outra
--    pergunta (e traria de volta quem já é cliente do produto).
--
--    HORIZONTE REAL: wth_itens começa em 13/01/2025 (espelho da v2). Então
--    "nunca comprou" quer dizer "não comprou de 2025 pra cá" — a UI avisa.
-- ---------------------------------------------------------------------------
create or replace function public.clientes_sem_produto(
  p_alvo    integer[],
  p_linha   integer[],
  p_desde   date default null,
  p_ate     date default null
)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with da_linha as (
    select distinct codcli
    from wth_itens
    where codprod = any(p_linha)
      and (p_desde is null or dt_venda >= p_desde)
      and (p_ate   is null or dt_venda <= p_ate)
      and codcli is not null
  ),
  com_alvo as (
    select distinct codcli
    from wth_itens
    where codprod = any(p_alvo)
      and codcli is not null
  ),
  cc as (
    select codcli from da_linha
    except
    select codcli from com_alvo
  )
  select jsonb_build_object(
    'codclis',     coalesce((select jsonb_agg(codcli) from cc), '[]'::jsonb),
    'cliente_ids', coalesce((select jsonb_agg(distinct v.cliente_id)
                             from wth_vinculo v join cc on cc.codcli = v.codcli), '[]'::jsonb),
    'tel8',        coalesce((select jsonb_agg(distinct right(regexp_replace(w.telefone, '\D', '', 'g'), 8))
                             from wth_carteira w join cc on cc.codcli = w.codcli
                             where w.telefone is not null
                               and length(regexp_replace(w.telefone, '\D', '', 'g')) >= 8), '[]'::jsonb),
    'total',       (select count(*) from cc)
  );
$$;

-- Só as rotas /api/* (service_role) chamam. A default privilege da 0072 já tira
-- o EXECUTE de public/anon/authenticated; o grant abaixo é explícito de propósito.
grant execute on function public.clientes_sem_produto(integer[], integer[], date, date) to service_role;
