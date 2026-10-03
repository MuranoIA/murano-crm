-- =============================================================================
-- 0153 · dívida é BOLETO. Pix sai da conta. (demanda #64, correção)
--
-- A 0152 contou toda cobrança em aberto da Neofin — boleto e pix. Estava
-- errado, e o dono pegou comparando com o painel de cobrança dele: o painel
-- dava R$ 54 mil de inadimplência e eu disse R$ 164 mil.
--
-- ---------------------------------------------------------------------------
-- ⚠️ A DIFERENÇA ERA PIX INTEIRO — e pix na Neofin NÃO É TÍTULO A RECEBER.
--
-- O ciclo de vida das cobranças prova, medido em 03/10/2026:
--
--                cancelada        paga
--   boleto        497 (18%)      1.733 (60%)
--   pix        13.610 (71%)      4.721 (25%)
--
-- 71% de todo pix emitido é CANCELADO. Ele é oferecido como forma de pagamento
-- e descartado — quem paga de outro jeito deixa o pix apodrecendo em aberto.
-- Reforça: de 322 pix vencidos, 24 têm uma cobrança IRMÃ da mesma nota que foi
-- PAGA (R$ 10.819) — o cliente pagou o boleto e o pix ficou lá.
--
-- Boleto se comporta como dívida de verdade: 18% cancelado, 60% pago.
--
-- ⚠️ O ESTRAGO QUE ISSO CAUSAVA no chat, que é pior que não ter a tela:
--
--                              com pix     só boleto
--   clientes com aviso            220          58
--   com algo vencido               85          28
--   vencido em reais        R$ 39.716   R$ 13.705
--
-- Avisar 220 quando são 58 é ensinar o consultor a ignorar o aviso. Alarme
-- falso não é um exagero inofensivo: ele desliga a atenção para o verdadeiro.
--
-- Decisão do dono (03/10/2026), perguntado se pix vencido conta em algum caso:
-- "nunca. se baseie pelo artfact".
--
-- ⚠️ "A vencer" CONTINUA, e só para boleto: a demanda pede "atrasados,
-- vencidos, ou a pagar" com todas as letras. O que saiu foi o pix, não o
-- futuro.
-- ---------------------------------------------------------------------------

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
  ((now() at time zone 'America/Belem')::date
     - (c.data_vencimento at time zone 'America/Belem')::date) as dias,
  ((c.data_vencimento at time zone 'America/Belem')::date
     < (now() at time zone 'America/Belem')::date) as vencido,
  c.url_cobranca
from public.ent_neofin_cobranca c
cross join lateral (
  select min(f.codcli) as codcli
    from public.wth_faturamento f
   where f.num_nota = c.numero_nf and f.codfilial = c.codfilial
) n
where c.status_cobranca in ('pending', 'overdue')
  -- ⚠️ SÓ BOLETO. Ver o bloco longo acima antes de alargar isto: `credit_card`
  -- e `generic` somam 7 linhas na base inteira e nenhuma em aberto, mas pix
  -- traria 322 títulos de volta, e eles não são dívida.
  and c.tipo_cobranca = 'boleto'
  and n.codcli is not null;

comment on view public.vw_cliente_boleto is
  'BOLETOS em aberto por codcli, ligados pela nota fiscal. Pix fica de fora: '
  '71% do pix emitido e cancelado, ele e forma de pagamento, nao titulo (0153). '
  '`vencido` sai da DATA, nao do status.';

revoke all on public.vw_cliente_boleto from anon, authenticated;
