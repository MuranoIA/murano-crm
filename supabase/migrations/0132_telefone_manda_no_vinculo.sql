-- =============================================================================
-- 0132 · O telefone da conversa manda no vínculo com o WinThor.
--
-- Relato do usuário (11/09/2026), com dois casos reais:
--
--   ANA PAULA RIBEIRO SILVA — (91) 98620-5515 — codcli 3193
--   CAROLINA NOVAIS         — (91) 98278-8034 — codcli 3192
--
-- No WinThor os dois cadastros estão CERTOS. No Pulse, a conversa que corre no
-- número 98620-5515 aparecia como CAROLINA NOVAIS, e a Carolina de verdade
-- tinha sumido do board. O pedido, literal: "a atualização que for feita no
-- banco whintor, deve ser refletida no sistema pulse".
--
-- ---------------------------------------------------------------------------
-- A CAUSA: wth_vinculo nunca era revisto depois de criado
--
-- Todo o ERP chega à tela por UMA ponte. As views do funil fazem:
--
--     LEFT JOIN wth_vinculo  vln  ON vln.cliente_id = c.id
--     LEFT JOIN wth_carteira wcar ON wcar.codcli    = vln.codcli
--
-- e é de wcar que saem o nome (0108), o rca_num, a carteira e as compras.
-- Vínculo apontando para o codcli errado não erra um campo: erra a pessoa.
--
-- O contato 69ea93bcafa14254c5b8e7be (telefone 559186205515, que é da Ana
-- Paula) carrega clientes.cpf = 03607663238 — o CPF da CAROLINA, herdado de um
-- cadastro errado lá atrás. A passada 1 da reconciliação casa por CPF e
-- SOBRESCREVE (on conflict do update ... where origem <> 'manual'), então ela
-- reafirmava o codcli 3192 a cada 10 minutos. As passadas 2 (telefone) e 3
-- (nome) só olham quem NÃO TEM vínculo — nunca corrigem um.
--
-- Resultado: um CPF errado gravado uma vez vence para sempre, e nenhuma
-- correção feita no WinThor consegue alcançar a tela. Era esse o bug.
--
-- ---------------------------------------------------------------------------
-- A REGRA NOVA, E POR QUE ELA É A CERTA
--
-- `clientes` não é uma pessoa: é UMA CONVERSA DE WHATSAPP. E quem decide de
-- quem é uma conversa de WhatsApp é o número por onde a mensagem chega — não um
-- CPF que alguém digitou num cadastro há meses.
--
-- Então: quando o telefone do contato casa, de forma única e exata, com um
-- cliente ATIVO do WinThor, é esse cliente o dono do vínculo — mesmo que já
-- exista vínculo por CPF apontando para outro.
--
-- Isso inverte a ordem de confiança da 0125 (CPF > telefone > nome) para o caso
-- específico em que os dois DISCORDAM. A ordem continua valendo para descobrir
-- um vínculo novo; o que muda é quem ganha o desempate.
--
-- ---------------------------------------------------------------------------
-- ⚠️ O QUE ESTA MIGRATION DELIBERADAMENTE NÃO FAZ: desvincular
--
-- O pedido também dizia que o número antigo "deve permanecer no chat como um
-- número qualquer sem nome". A leitura tentadora seria: telefone do contato que
-- não bate com o telefone do ERP => tira o vínculo. Medido antes de escrever, e
-- a medição recusa essa regra:
--
--   4.797  contato e ERP com o MESMO telefone           — nada a fazer
--       6  telefone do contato é de OUTRO codcli ativo  — é o bug, e é o que muda
--     199  telefone do contato não existe no ERP        — NÃO TOCAR
--       0  telefone batendo com mais de um codcli       — ambíguo, ficaria de fora
--
-- Nos 199, nome e CPF do vínculo CONCORDAM com o contato: é a cliente que
-- conversa por um número que o ERP não conhece (o WhatsApp pessoal, o segundo
-- chip). Desvinculá-los tiraria carteira, RCA e histórico de compra de 199
-- pessoas certas para resolver 6 erradas. Pelo mesmo motivo, nada é feito com
-- os 145 codcli que hoje têm mais de um contato apontando para eles — em 89
-- deles há conversa nos DOIS números, e em vários o número que "não bate" é o
-- mais ativo (uma cliente com 304 mensagens no número de fora contra 50 no
-- cadastrado). Escolher por telefone ali apagaria a conversa principal.
--
-- Quem deixa de ser "a Carolina" deixa de sê-lo por ganhar o dono certo, nunca
-- por perder o dono. Errar por omissão continua sendo mais seguro que errar por
-- adivinhação — é a mesma régua da 0125.
--
-- Efeito medido desta migration: 6 vínculos corrigidos, nenhum removido.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) A régua, em um lugar só
--
-- Duas passadas precisam da mesma resposta ("de quem o telefone desta conversa
-- diz que ela é?"): a trava da passada 1 e a correção nova. Repetir o SQL nas
-- duas criaria duas verdades que divergem no primeiro ajuste — o projeto já
-- pagou isso mais de uma vez (§32.2 do CLAUDE.md).
--
-- `ativo` é exigido aqui e não na passada 2 de propósito: aqui o vínculo é
-- TROCADO, e trocar um vínculo existente por um cadastro desativado no ERP
-- seria piorar. Descobrir um vínculo novo é outro grau de risco.
-- ---------------------------------------------------------------------------
create or replace view public.vw_erp_por_telefone as
  select
    c.id                     as cliente_id,
    min(w.codcli)            as codcli,
    min(coalesce(w.cpf, '')) as cpf
  from clientes c
  join wth_carteira w
    on w.ativo
   and w.tel8 = right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8)
  where length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) >= 8
  group by c.id
  having count(distinct w.codcli) = 1;   -- telefone de duas pessoas não decide nada

comment on view public.vw_erp_por_telefone is
  'De quem o TELEFONE diz que a conversa é: contato -> codcli ativo do WinThor, '
  'só quando o casamento por tel8 é único. Fonte única do desempate da 0132 — '
  'usada pela trava da passada de CPF e pela passada de correção.';

-- ---------------------------------------------------------------------------
-- 2) A reconciliação
-- ---------------------------------------------------------------------------
create or replace function public.wth_reconciliar_vinculos()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cpf  integer;
  v_tel  integer;
  v_nome integer;
  v_corr integer;
begin
  -- Passada 1 — CPF.
  --
  -- ⚠️ Mudou UMA coisa: o `not exists` no fim. Sem ele, esta passada desfaz a
  -- correção da passada 4 a cada 10 minutos, e o bug volta sozinho — foi
  -- exatamente assim que ele sobreviveu até aqui.
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
      and not exists (
        select 1 from vw_erp_por_telefone t
         where t.cliente_id = c.id and t.codcli <> w.codcli
      )
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

  -- Passada 2 — telefone, para quem ainda não tem vínculo (inalterada).
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

  -- Passada 3 — nome normalizado, único (inalterada, 0125).
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

  -- Passada 4 — NOVA (0132): corrigir o que já existe.
  --
  -- É a única passada que TROCA um vínculo em vez de descobrir um. Só age
  -- quando o codcli realmente difere, então em regime normal ela toca zero
  -- linhas — não é uma reescrita de 5 mil linhas a cada 10 minutos.
  --
  -- origem = 'telefone' deixa a correção auditável: quem for investigar uma
  -- divergência de carteira vê qual sinal decidiu. `manual` continua acima de
  -- tudo — decisão de gente não é desfeita por job.
  update wth_vinculo v
     set codcli       = t.codcli,
         cpf          = nullif(t.cpf, ''),
         origem       = 'telefone',
         conferido_em = now()
    from vw_erp_por_telefone t
   where t.cliente_id = v.cliente_id
     and v.codcli    <> t.codcli
     and v.origem    <> 'manual';

  get diagnostics v_corr = row_count;

  return v_cpf + v_tel + v_nome + v_corr;
end;
$function$;

comment on function public.wth_reconciliar_vinculos() is
  'Casa clientes com o WinThor em 4 passadas: CPF, telefone (tel8 único), nome '
  '(normalizado, único) e — desde a 0132 — correção por telefone, que TROCA o '
  'vínculo quando o número da conversa pertence, no WinThor, a outro cliente. '
  'O telefone ganha do CPF no desempate porque `clientes` é uma conversa de '
  'WhatsApp, não uma pessoa. Nenhuma passada remove vínculo.';
