-- Filtro por cidade no board (funil-murano). Espelha o padrão do filtro por produto
-- (migration 0020), mas SEM período: cidade é atributo fixo do cliente, vindo de
-- wth_endereco (espelho da v2, migration 0060). Chave de ligação: codcli.

-- Normalização de cidade: sem acento + maiúsculo + trim, pra "BELEM" e "BELÉM"
-- (que hoje aparecem separados no banco) contarem como a MESMA cidade.
create or replace function public.wth_norm_cidade(p text)
returns text language sql immutable as $$
  select upper(trim(translate(coalesce(p, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')));
$$;

-- Lista de cidades p/ o multi-select do filtro. cidade_norm = chave (usada no match);
-- cidade = rótulo bonito (a grafia mais comum, capitalizada); clientes = nº de clientes.
create or replace view public.vw_cidades as
  select
    public.wth_norm_cidade(cidade)                                   as cidade_norm,
    initcap(mode() within group (order by trim(cidade)))            as cidade,
    count(*)::int                                                    as clientes
  from public.wth_endereco
  where nullif(trim(cidade), '') is not null
  group by public.wth_norm_cidade(cidade);

-- Dadas cidades (chaves normalizadas), devolve os IDENTIFICADORES dos clientes de lá
-- (codclis + cliente_ids do RD + telefones8), agregados no banco — evita o teto de 1000
-- linhas do PostgREST. O board casa cada card por qualquer um desses e filtra em memória.
create or replace function public.clientes_por_cidade(p_cidades text[])
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with cc as (
    select distinct codcli
    from wth_endereco
    where public.wth_norm_cidade(cidade) = any(p_cidades)
      and codcli is not null
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
