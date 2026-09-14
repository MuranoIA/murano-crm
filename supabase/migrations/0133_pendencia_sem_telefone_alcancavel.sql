-- =============================================================================
-- 0133 — o grupo "sem telefone" dizia que NÃO DAVA para enviar, e dava.
--
-- O grupo A (0101) é `wth_carteira.telefone` vazio, e o texto dele afirmava:
--
--     "Sem telefone no WinThor — não dá para enviar nada."
--
-- A primeira metade é verdade; a segunda não. `wth_carteira` é o espelho do
-- CADASTRO do ERP. Quem decide se o CRM alcança alguém é outra coisa: o CONTATO
-- (`clientes.telefone`), que existe para todo mundo que já falou com a gente.
--
-- Medido em 14/09/2026, nos 127 do grupo A:
--
--     58  com vínculo para um contato que TEM telefone  ->  alcançáveis HOJE
--     69  sem contato nenhum                            ->  sem canal
--
-- Quase metade da lista estava rotulada como impossível, e o vendedor lia "não
-- dá para falar com ela" sobre uma cliente que ele abre no chat e responde
-- agora. É o mesmo defeito que esta tela existe para curar (§36.1): um registro
-- descrito de um jeito que não corresponde ao que ele é.
--
-- ⚠️ E OS DOIS CASOS PEDEM AÇÕES DIFERENTES — é por isso que a correção separa
-- os grupos em vez de só arrumar o texto:
--
--     A1  o telefone está no nosso histórico  ->  COPIAR para o cadastro do ERP
--     A2  não existe em lugar nenhum          ->  BUSCAR com a cliente
--
-- Juntos, os 58 do primeiro faziam o segundo parecer o dobro do que é, e a
-- tarefa fácil (copiar 58 números que já temos) ficava escondida atrás da
-- difícil.
--
-- A1 leva o TELEFONE na coluna e no texto, porque é ele que a pessoa vai digitar
-- no ERP. Uma lista mandando "procure o número" com o número no banco ao lado
-- seria trabalho inventado.
--
-- ⚠️ Escrita A PARTIR da 0116, que é a definição vigente — os grupos B, C, D e E
-- passam byte a byte. Reconstruir a view de memória é como se perde um ramo sem
-- ninguém notar.
-- =============================================================================

drop view if exists vw_pendencias_admin;

create view vw_pendencias_admin as
with ativas as (
  select rca_num, slug from carteira_config where ativo
),
carteira as (
  select w.* from wth_carteira w
    join ativas a on a.rca_num = w.rca_num
  where w.ativo is true
),
tel_clientes as (
  select id, right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 8) as t8
  from clientes
),
-- O contato vinculado (por CPF ou nome, conforme `wth_reconciliar_vinculos`) e o
-- telefone dele. É esta junção que separa A1 de A2.
--
-- `distinct on` porque um codcli pode ter mais de um vínculo; fica o contato com
-- o telefone mais LONGO, que é o mais completo (13 dígitos com o nono, contra 12
-- sem ele — herança do RD, §16.3).
tel_do_historico as (
  select distinct on (v.codcli)
         v.codcli,
         c.id as contato_id,
         regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') as tel
    from wth_vinculo v
    join clientes c on c.id = v.cliente_id
   where length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) >= 10
   order by v.codcli, length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) desc
)

-- A1 — sem telefone no ERP, mas ALCANÇÁVEL: o número está no nosso histórico
select
  'A1 · telefone recuperável'::text               as grupo,
  ('codcli:' || w.codcli)::text                   as chave,
  w.codcli,
  h.contato_id                                    as cliente_id,
  w.nome,
  h.tel                                           as telefone,
  w.cpf,
  a.slug                                          as carteira,
  w.rca_num,
  w.rca_nome,
  ('O cadastro do ERP está sem telefone, mas ele existe no nosso histórico: '
    || h.tel || '. O CRM já fala com esta cliente — falta COPIAR o número para o WinThor.')::text as detalhe,
  null::timestamptz                               as ultima_atividade
from carteira w
  join ativas a on a.rca_num = w.rca_num
  join tel_do_historico h on h.codcli = w.codcli
where coalesce(w.telefone, '') = ''

union all

-- A2 — sem telefone em lugar nenhum: aí sim não há canal possível
select
  'A2 · sem telefone em lugar nenhum'::text,
  ('codcli:' || w.codcli)::text,
  w.codcli,
  null::text,
  w.nome,
  null::text,
  w.cpf,
  a.slug,
  w.rca_num,
  w.rca_nome,
  'Sem telefone no WinThor E sem contato no histórico — não há canal possível. Precisa ser obtido com a cliente.'::text,
  null::timestamptz
from carteira w
  join ativas a on a.rca_num = w.rca_num
  left join tel_do_historico h on h.codcli = w.codcli
where coalesce(w.telefone, '') = ''
  and h.codcli is null

union all

-- B — tem telefone, mas não existe contato para o botão usar
select
  'B · sem contato criado'::text,
  ('codcli:' || w.codcli)::text,
  w.codcli,
  null::text,
  w.nome,
  w.telefone,
  w.cpf,
  a.slug,
  w.rca_num,
  w.rca_nome,
  'Está na carteira e tem telefone, mas ainda não existe contato no CRM — o envio precisa de um. Tem conserto automático.'::text,
  null::timestamptz
from carteira w
  join ativas a on a.rca_num = w.rca_num
where coalesce(w.telefone, '') <> ''
  and not exists (select 1 from wth_vinculo v where v.codcli = w.codcli)
  and not exists (
    select 1 from tel_clientes cl
     where cl.t8 = right(regexp_replace(coalesce(w.telefone, ''), '\D', '', 'g'), 8)
  )

union all

-- C — conversa sem dono comercial nenhum
select
  'C · conversa sem cadastro no ERP'::text,
  c.id,
  null::integer,
  c.id,
  c.nome_completo,
  c.telefone,
  null::text,
  c.carteira,
  null::integer,
  null::text,
  'Está conversando conosco e não tem cadastro no WinThor. Cadastrar, atribuir a uma carteira ou descartar.'::text,
  (select max(m.criada_em) from mensagens m where m.cliente_id = c.id and m.tipo <> 'evento_sistema')
from clientes c
where exists (select 1 from mensagens m where m.cliente_id = c.id and m.tipo <> 'evento_sistema')
  and not exists (select 1 from wth_vinculo v where v.cliente_id = c.id)
  and not exists (
    select 1 from wth_carteira w
     where w.tel8 = right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8)
  )

union all

-- D — conversa de cliente que pertence a outro time
select
  'D · RCA fora do board'::text,
  c.id,
  vln.codcli,
  c.id,
  c.nome_completo,
  c.telefone,
  null::text,
  c.carteira,
  wcar.rca_num,
  wcar.rca_nome,
  'Conversa de cliente cujo RCA não é de nenhuma carteira do board — fica na fila de não atribuídos até alguém pegar.'::text,
  (select max(m.criada_em) from mensagens m where m.cliente_id = c.id and m.tipo <> 'evento_sistema')
from clientes c
  join wth_vinculo vln on vln.cliente_id = c.id
  left join wth_carteira wcar on wcar.codcli = vln.codcli
where exists (select 1 from mensagens m where m.cliente_id = c.id and m.tipo <> 'evento_sistema')
  and not exists (select 1 from ativas a where a.rca_num = wcar.rca_num)

union all

-- E — contato criado, sem conversa e sem cadastro no ERP: invisível (0116)
select
  'E · contato sem conversa e sem ERP'::text,
  c.id,
  null::integer,
  c.id,
  c.nome_completo,
  c.telefone,
  null::text,
  c.carteira,
  null::integer,
  null::text,
  'Cadastrado no CRM, ainda sem nenhuma mensagem e sem cadastro no WinThor — não aparece em nenhuma coluna do board. Some daqui sozinho na primeira mensagem, ou quando o CPF entrar no ERP.'::text,
  null::timestamptz
from clientes c
where not exists (select 1 from mensagens m where m.cliente_id = c.id and m.tipo <> 'evento_sistema')
  and not exists (select 1 from wth_vinculo v where v.cliente_id = c.id)
  -- o casamento por telefone é o mesmo do grupo C: sem ele, os 108 contatos
  -- provisionados da carteira (§37.4) cairiam aqui, e eles JÁ aparecem no board
  -- como prospecção
  and not exists (
    select 1 from wth_carteira w
     where length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) >= 8
       and w.tel8 = right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8)
  );

-- A mesma régua de sempre: só service_role lê, e a rota exige admin (§12.5).
revoke all on vw_pendencias_admin from anon, authenticated;
