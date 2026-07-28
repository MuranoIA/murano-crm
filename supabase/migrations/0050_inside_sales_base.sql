-- ===== Dashboard Inside Sales — fundação =====
-- Config editável da equipe IS (roster + metas). Muda todo mês sem tocar em código.
create table if not exists public.is_config (
  slug text primary key, nome text not null, meta numeric not null,
  novato boolean not null default false, cor text not null,
  ordem integer not null default 0, ativo boolean not null default true
);
alter table public.is_config enable row level security;
insert into public.is_config (slug, nome, meta, novato, cor, ordem) values
  ('milene','Milene',80000,false,'#34D399',1),
  ('thamires','Thamires',80000,false,'#7C5CFC',2),
  ('anne','Anne',80000,false,'#FBBF24',3),
  ('thiago','Thiago',80000,false,'#F87171',4),
  ('luana','Luana',30000,true,'#38BDF8',5),
  ('romulo','Rômulo',30000,true,'#FB923C',6),
  ('kamilly','Kamilly',30000,true,'#E879F9',7)
on conflict (slug) do nothing;

create table if not exists public.is_param (chave text primary key, valor text not null);
alter table public.is_param enable row level security;
insert into public.is_param (chave, valor) values ('codfilial','1'),('meses_comparacao','3')
on conflict (chave) do nothing;

-- Snapshot (uma linha; reescrito toda madrugada).
create table if not exists public.is_dashboard (
  id integer primary key default 1, dados jsonb, narrativas jsonb,
  atualizado_em timestamptz, check (id = 1)
);
alter table public.is_dashboard enable row level security;
insert into public.is_dashboard (id) values (1) on conflict (id) do nothing;

-- Staging: espelho temporário do v2 (4 meses, Filial 1) usado só pelo cálculo noturno.
create table if not exists public.is_stage_fat (
  pedido integer, codfilial integer, codcli integer, tipo text, nome_usuario text, data_fat date
);
create table if not exists public.is_stage_itens (
  cod_pedido integer, codfilial integer, codprod integer, vlr_item numeric, quantidade numeric, dt_venda date
);
create index if not exists is_stage_fat_ped_idx on public.is_stage_fat(pedido, codfilial);
create index if not exists is_stage_itens_ped_idx on public.is_stage_itens(cod_pedido, codfilial);
alter table public.is_stage_fat enable row level security;
alter table public.is_stage_itens enable row level security;
