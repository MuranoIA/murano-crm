-- De qual tela saiu o template: massa (Admin → Disparo em massa), conversa (chat) ou card (board).
-- A Meta cobra igual nos três; sem isto o Café Code (#83) não separa o custo em massa × avulso.
-- Nullable: envios anteriores (e qualquer chamador que não informe) ficam sem origem.
alter table public.disparos_template
  add column if not exists origem text check (origem in ('massa', 'conversa', 'card'));
