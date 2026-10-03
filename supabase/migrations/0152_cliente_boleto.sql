-- =============================================================================
-- 0152 · as dívidas de boleto do cliente, no chat (demanda #64)
--
-- `ent_neofin_cobranca` é do módulo de Entregas (prefixo `ent_`) e guarda as
-- cobranças emitidas na Neofin. Ela NÃO tem cliente: tem `numero_nf`. O elo
-- até o cliente é a nota fiscal em `wth_faturamento`, e é só isso que esta
-- view faz — sem copiar dado, sem job novo. A tabela é sincronizada por fora
-- (medido em 03/10/2026: `sincronizado_em` de minutos atrás).
--
-- ---------------------------------------------------------------------------
-- ⚠️ VENCIDO É POR DATA, NUNCA PELO `status_cobranca`.
--
-- Medido em 03/10/2026: **125 cobranças estão com status `pending` e venceram**
-- — a mais antiga em 20/12/2024. Contar só o `overdue` daria 322 vencidas
-- quando são 447. Confiar no status faria o consultor dizer "está tudo em dia"
-- a quem deve há mais de um ano, e é o tipo de erro que o cliente corrige na
-- cara dele.
--
-- O status continua exposto, porque explica o resto (cancelada, paga); quem
-- decide o vermelho da tela é a data.
-- ---------------------------------------------------------------------------

-- O join nota -> cliente não tinha índice: `wth_faturamento` tem 57 mil linhas
-- e a busca por nota era varredura. Medir antes de concluir é o padrão da casa.
create index if not exists idx_wth_fat_nota on public.wth_faturamento (num_nota, codfilial);

create or replace view public.vw_cliente_boleto as
select
  n.codcli,
  c.numero_cobranca,
  c.numero_nf,
  c.codfilial,
  c.filial,
  c.tipo_cobranca,
  c.status_cobranca,
  c.valor_reais,
  (c.data_vencimento at time zone 'America/Belem')::date as vencimento,
  -- dias de atraso: positivo = vencida há N dias; negativo = vence em N dias
  ((now() at time zone 'America/Belem')::date
     - (c.data_vencimento at time zone 'America/Belem')::date) as dias,
  ((c.data_vencimento at time zone 'America/Belem')::date
     < (now() at time zone 'America/Belem')::date) as vencido,
  c.url_cobranca
from public.ent_neofin_cobranca c
cross join lateral (
  -- `min` e não `distinct`: uma nota pode ter mais de uma linha de faturamento
  -- (venda e devolução), e todas são do mesmo cliente. Sem o agregado, uma
  -- cobrança viraria duas na tela.
  select min(f.codcli) as codcli
    from public.wth_faturamento f
   where f.num_nota = c.numero_nf and f.codfilial = c.codfilial
) n
-- só o que ainda se cobra. `paid` e `cancelled` são histórico, e mostrá-los
-- transformaria o aviso de dívida num extrato que ninguém lê.
where c.status_cobranca in ('pending', 'overdue')
  and n.codcli is not null;

comment on view public.vw_cliente_boleto is
  'Cobrancas EM ABERTO (pending/overdue) por codcli, ligadas pela nota fiscal. '
  '`vencido` sai da DATA, nao do status: 125 cobrancas pending ja venceram (#64).';

-- A chave anon nunca precisou ler isto, e view que atravessa RLS por ser do
-- dono e o buraco que a §71.5 registrou. Nasce fechada.
revoke all on public.vw_cliente_boleto from anon, authenticated;
