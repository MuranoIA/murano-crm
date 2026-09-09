-- =============================================================================
-- 0125 · wth_reconciliar_vinculos() ganha 3ª passada: nome, quando único
--
-- Contexto (09/09/2026): clientes sem telefone certo (ou sem telefone algum) e
-- sem CPF capturado nunca ganham `wth_vinculo` — as duas passadas já existentes
-- (CPF, depois telefone-8-dígitos-quando-único) não têm o que casar. Sem
-- vínculo, `vw_funil.vendedor` fica NULO mesmo quando o cliente É de RCA
-- conhecido, e ele cai na fila "sem dono" do chat — visível a TODOS — quando
-- devia cair só na fila de quem é dono de verdade, em "esperando".
--
-- A régua de nome único JÁ EXISTE no projeto: `vw_funil` usa exatamente este
-- casamento (nome normalizado, `count(distinct codcli) = 1`) para a flag
-- `sem_cadastro` desde a 0034 — só nunca tinha sido promovida de informativa
-- para vínculo de verdade. Aqui ela é promovida, com a MESMA régua e a mesma
-- exigência de unicidade (nome comum demais continua sem vínculo — errar por
-- omissão é mais seguro que errar por adivinhação).
--
-- Pedido explícito do usuário: vale para TUDO que `wth_vinculo` alimenta —
-- board, disparo em massa, autorização de ligação e chat — não só o chat. Uma
-- fonte de verdade só, como o resto do projeto já exige (§29.3/§11.5 do
-- CLAUDE.md). `origem='nome'` para poder auditar separado das outras duas —
-- é o sinal mais fraco dos três, e precisa ficar identificável se algum dia
-- alguém for conferir uma divergência.
-- =============================================================================

-- 'nome' precisa ser um origem válido antes da função poder gravá-lo.
alter table wth_vinculo drop constraint if exists wth_vinculo_origem_check;
alter table wth_vinculo add constraint wth_vinculo_origem_check
  check (origem = any (array['cpf', 'telefone', 'nome', 'manual']));

create or replace function public.wth_reconciliar_vinculos()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cpf integer;
  v_tel integer;
  v_nome integer;
begin
  -- Passada 1 — CPF (idêntica à versão anterior)
  with candidatos as (
    select
      c.id  as cliente_id,
      w.codcli,
      w.cpf,
      row_number() over (partition by c.id order by w.codcli) as rn
    from clientes c
    join wth_carteira w
      on w.cpf = regexp_replace(coalesce(c.cpf, ''), '[^0-9]', '', 'g')
    where coalesce(c.cpf, '') <> ''
      and w.cpf is not null
  )
  insert into wth_vinculo (cliente_id, codcli, cpf, origem, conferido_em)
  select cliente_id, codcli, cpf, 'cpf', now()
  from candidatos
  where rn = 1
  on conflict (cliente_id) do update
    set codcli       = excluded.codcli,
        cpf          = excluded.cpf,
        origem       = 'cpf',
        conferido_em = now()
    where wth_vinculo.origem <> 'manual';

  get diagnostics v_cpf = row_count;

  -- Passada 2 — telefone (idêntica à versão anterior): só para quem AINDA não
  -- tem vínculo, match único de tel8
  with sem_vinculo as (
    select
      c.id as cliente_id,
      right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8) as tel8
    from clientes c
    where not exists (select 1 from wth_vinculo v where v.cliente_id = c.id)
      and length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) >= 8
  ),
  unicos as (
    select s.cliente_id, min(w.codcli) as codcli, min(coalesce(w.cpf, '')) as cpf
    from sem_vinculo s
    join wth_carteira w on w.tel8 = s.tel8
    group by s.cliente_id
    having count(distinct w.codcli) = 1
  )
  insert into wth_vinculo (cliente_id, codcli, cpf, origem, conferido_em)
  select cliente_id, codcli, cpf, 'telefone', now()
  from unicos
  on conflict (cliente_id) do nothing;

  get diagnostics v_tel = row_count;

  -- Passada 3 — NOVA (0125): nome normalizado, só para quem CPF e telefone não
  -- resolveram. Mesma normalização e mesma exigência de unicidade que
  -- `vw_funil.sem_cadastro` já usa (0034) — reaproveitada, não inventada.
  with sem_vinculo_nome as (
    select
      c.id as cliente_id,
      upper(btrim(regexp_replace(translate(c.nome_completo,
        'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
        'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
        '\s+', ' ', 'g'))) as nome_norm
    from clientes c
    where not exists (select 1 from wth_vinculo v where v.cliente_id = c.id)
      and coalesce(c.nome_completo, '') <> ''
  ),
  unicos_nome as (
    select s.cliente_id, min(w.codcli) as codcli, min(coalesce(w.cpf, '')) as cpf
    from sem_vinculo_nome s
    join wth_carteira w on w.nome_norm = s.nome_norm
    group by s.cliente_id
    having count(distinct w.codcli) = 1
  )
  insert into wth_vinculo (cliente_id, codcli, cpf, origem, conferido_em)
  select cliente_id, codcli, cpf, 'nome', now()
  from unicos_nome
  on conflict (cliente_id) do nothing;

  get diagnostics v_nome = row_count;

  return v_cpf + v_tel + v_nome;
end;
$function$;

comment on function public.wth_reconciliar_vinculos() is
  'Casa clientes com o WinThor em 3 passadas, nesta ordem de confiança: CPF, '
  'telefone (tel8 único), nome (normalizado, único). Roda a cada 10 min via '
  'wth_sync_tudo(). origem na wth_vinculo diz qual passada resolveu cada um — '
  '"nome" é o sinal mais fraco dos três e o primeiro a suspeitar numa '
  'divergência de carteira.';
