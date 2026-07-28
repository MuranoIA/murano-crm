-- Espelho do catálogo/estoque/campanhas do v2 para o Orçamento, para que a Vercel
-- leia SOMENTE o murano-conversas (nunca mais o v2 direto). Mesmo padrão dos demais wth_*.
-- RLS ligado sem policy: só service_role lê (a rota /api/orcamento usa service_role).

create table if not exists public.wth_catalogo (
  codprod         integer primary key,
  produto         text,
  marca           text,
  secao           text,
  preco_tabela    numeric,
  sincronizado_em timestamptz default now()
);
alter table public.wth_catalogo enable row level security;
comment on table public.wth_catalogo is 'Espelho do catálogo+preço de tabela do v2 (vw_tabela_precos). Reescrito pelo sync. Fonte do Orçamento.';

create table if not exists public.wth_estoque (
  codprod         integer primary key,
  qt_disponivel   numeric,
  sincronizado_em timestamptz default now()
);
alter table public.wth_estoque enable row level security;
comment on table public.wth_estoque is 'Espelho do estoque disponível (filial 1) do v2 (estoque_winthor). Atualizado a cada 30 min.';

create table if not exists public.wth_campanhas (
  codprod         integer not null,
  preco           numeric not null,
  nome            text,
  sincronizado_em timestamptz default now(),
  primary key (codprod, preco)
);
alter table public.wth_campanhas enable row level security;
create index if not exists wth_campanhas_codprod_idx on public.wth_campanhas(codprod);
comment on table public.wth_campanhas is 'Campanhas de desconto ATIVAS por produto (ofertas 1-item, não-combo) espelhadas do v2. Reescrito pelo sync.';
