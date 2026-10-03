-- =============================================================================
-- 0151 · a carteira do administrativo (demanda #62)
--
-- O RCA 11 do WinThor ("ADMINISTRATIVO VENUS", 1.869 clientes) nunca esteve em
-- `carteira_config`. Consequência que ninguém tinha visto: como
-- `vw_chat_conversa` resolve o dono por `COALESCE(ccr.slug, clientes.carteira)`,
-- e o `ccr` não casa com um RCA desconhecido, os 1.639 clientes do RCA 11 que já
-- têm conversa continuavam aparecendo **sob a consultora anterior** — mesmo
-- depois de o ERP já os ter passado para o administrativo.
--
-- Medido em 02/10/2026: kamilly 661 · luana 649 · thiago 205 · romulo 59 ·
-- sem dono 30 · milene 17 · anne 11 · thamires 7.
--
-- ---------------------------------------------------------------------------
-- ⚠️ POR QUE `rca_num` FICA NULO, SE O RCA EXISTE E É O 11
--
-- Porque o dono pediu uma mudança PARCIAL, e `rca_num` é uma regra CONTÍNUA.
-- Com `rca_num = 11`, o `ccr.slug` passaria a valer para todo cliente do RCA 11
-- e os 1.639 mudariam de dono de uma vez — inclusive quem está respondendo
-- agora. A decisão (02/10/2026) foi outra:
--
--   "Mova somente os da Kamilly e os da Luana e os do Romulo, mas eliminando
--    quem tem conversa nos últimos três dias."
--
-- Isso é um RECORTE DE UM MOMENTO, não uma regra: daqui a três dias as mesmas
-- conversas estariam paradas, e ninguém pediu que elas migrassem sozinhas. Um
-- recorte de momento se grava no espelho (`clientes.carteira`), que é
-- exatamente o degrau que o `COALESCE` usa quando não há RCA cadastrado.
--
-- ⚠️ CONSEQUÊNCIA, para quem ler isto depois: o administrativo NÃO recebe
-- cliente novo do RCA 11 automaticamente. Cada passagem é explícita. Se um dia
-- a regra passar a ser "tudo do RCA 11 é dele", basta pôr 11 aqui — e aí o
-- espelho deixa de ser consultado, porque o `ccr` ganha dele no COALESCE.
--
-- ⚠️ E o espelho é estável: desde a remoção do ETL do RD (§69) nada reescreve
-- `clientes.carteira` de contato já conhecido. O `wth-sync-tudo` escreve
-- `wth_carteira`, que é outra tabela.
-- ---------------------------------------------------------------------------

-- 1) a carteira existe -------------------------------------------------------
insert into public.carteira_config (slug, rca_num, employee_id, cor, ativo, "time")
values ('administrativo', null, null, '#64748b', true, 'ADM')
on conflict (slug) do update
  set ativo = true, cor = excluded.cor, "time" = excluded."time";

-- 2) quem passa para ela -----------------------------------------------------
--
-- ⚠️ O CORTE É UM INSTANTE FIXO, não `now()`. Com `now()` esta migration daria
-- um conjunto diferente a cada execução — e replay num banco limpo (§19.2)
-- produziria uma carteira que nunca existiu. O instante abaixo é o da decisão.
do $$
declare
  v_ate constant timestamptz := timestamptz '2026-10-02 23:00:00+00';
  v_movidos int;
begin
  create temporary table tmp_adm_move on commit drop as
  with adm as (
    select distinct v.cliente_id
      from public.wth_carteira w
      join public.wth_vinculo v on v.codcli = w.codcli
     where w.rca_num = 11
  )
  select cl.id as cliente_id, cl.carteira as de
    from adm a
    join public.clientes cl on cl.id = a.cliente_id
   where cl.carteira in ('kamilly', 'luana', 'romulo')
     -- "sem conversa nos últimos três dias". Evento de sistema não é conversa:
     -- contá-lo deixaria com a consultora alguém que ninguém atendeu.
     and not exists (
       select 1 from public.mensagens m
        where m.cliente_id = cl.id
          and m.tipo <> 'evento_sistema'
          and m.criada_em >  v_ate - interval '3 days'
          and m.criada_em <= v_ate
     );

  -- 3) registra ANTES de mudar: `carteira_transferencia` é append-only e é o
  --    único lugar onde fica escrito de quem cada cliente saiu.
  insert into public.carteira_transferencia
         (cliente_id, de_carteira, para_carteira, por, observacao, sucesso)
  select cliente_id, de, 'administrativo', 'demanda #62 (migration 0151)',
         'RCA 11 (ADMINISTRATIVO VENUS) — sem conversa nos 3 dias anteriores a 02/10/2026',
         true
    from tmp_adm_move;

  -- 4) o espelho
  update public.clientes cl
     set carteira = 'administrativo'
    from tmp_adm_move t
   where cl.id = t.cliente_id;

  get diagnostics v_movidos = row_count;
  raise notice 'clientes passados para o administrativo: %', v_movidos;
end $$;

-- 5) o acesso dele no Pulse --------------------------------------------------
-- papel `vendedor`: vê só a própria carteira, como kamilly e luana.
-- ⚠️ Isto NÃO cria a conta do hub — lá o cadastro é por tela (/admin do hub),
-- porque a senha passa pelo Supabase Auth.
insert into public.acesso (email, nome, papel, carteira, ativo)
values ('administrativo@muranoprofessional.com.br', 'Administrativo', 'vendedor', 'administrativo', true)
on conflict (email) do update
  set papel = 'vendedor', carteira = 'administrativo', ativo = true;
