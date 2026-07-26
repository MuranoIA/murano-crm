-- =============================================================================
-- Lixeira: clientes que o consultor identificou como CLIENTE FINAL (a empresa só
-- atende profissionais de cabelo) e arrastou pra descartar. Ficam aqui por tempo
-- indeterminado; o card some do funil. Depois o usuário decide (restaurar/excluir).
-- Guarda vários identificadores (cliente_id RD, codcli, tel8) pra casar o mesmo cliente
-- independente de como ele aparece no board (conversa/prospecção/pedido).
-- Aplicar só no murano-conversas.
-- =============================================================================
create table if not exists wth_descartados (
  id bigint generated always as identity primary key,
  cliente_id text,
  codcli integer,
  tel8 text,
  cliente text,
  vendedor text,
  motivo text default 'cliente final',
  descartado_por text,
  criado_em timestamptz default now()
);
create index if not exists idx_descartados_cliente_id on wth_descartados(cliente_id);
create index if not exists idx_descartados_codcli on wth_descartados(codcli);
create index if not exists idx_descartados_tel8 on wth_descartados(tel8);
grant select, insert, delete on wth_descartados to service_role;
