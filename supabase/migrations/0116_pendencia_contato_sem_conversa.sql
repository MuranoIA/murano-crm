-- =============================================================================
-- 0116 — o grupo E: contato criado que não aparece em lugar nenhum
--
-- Achado ao responder uma pergunta do usuário em 27/08/2026: "quando se cadastra
-- um cliente novo, e ele ainda não existe no WinThor, onde ele aparece?"
--
-- A resposta era **em lugar nenhum**, e isso foi conferido caso a caso:
--
--   board      os três ramos da `vw_funil_visivel` exigem ou uma conversa
--              (ramo 1), ou uma mensagem de operador em linha escondida
--              (ramo 1b), ou cadastro no WinThor (ramo 2, prospecção).
--              Contato novo sem mensagem não satisfaz nenhum.
--   chat       a lista vem da mesma view.
--   Pendências os quatro grupos (0101) também partem de conversa ou de
--              carteira do ERP.
--
-- Medido: dos 116 contatos com id `wa:`, **2** estavam exatamente assim — sem
-- nenhuma mensagem e sem cadastro no WinThor. Ficavam visíveis apenas na aba de
-- quem os criou, e sumiam no primeiro recarregamento.
--
-- É a doença que a própria tela de Pendências existe para curar (§36.1): um
-- registro que o sistema não sabe classificar não pode simplesmente não
-- aparecer. Os outros 108 contatos sem mensagem NÃO entram aqui porque têm
-- cadastro no WinThor — aparecem no board como prospecção, sob o id sintético
-- `winthor:<codcli>`.
--
-- ⚠️ O grupo some sozinho, e isso é o desenho, não um descuido: basta a
-- primeira mensagem (em qualquer direção) para o contato entrar no board pelo
-- ramo 1, ou o CPF ser cadastrado para virar prospecção. Não é fila de trabalho
-- permanente — é uma rede para ninguém cair fora da tela.
--
-- A view inteira é recriada porque `create or replace` do Postgres não aceita
-- acrescentar um ramo a um UNION sem reescrever o corpo. Os quatro grupos
-- originais estão idênticos aos da 0101.
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
)

-- A — sem telefone: não há canal possível
select
  'A · sem telefone'::text                       as grupo,
  ('codcli:' || w.codcli)::text                  as chave,
  w.codcli,
  null::text                                     as cliente_id,
  w.nome,
  null::text                                     as telefone,
  w.cpf,
  a.slug                                         as carteira,
  w.rca_num,
  w.rca_nome,
  'Sem telefone no WinThor — não dá para enviar nada. Corrigir no cadastro do ERP.'::text as detalhe,
  null::timestamptz                              as ultima_atividade
from carteira w
  join ativas a on a.rca_num = w.rca_num
where coalesce(w.telefone, '') = ''

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

comment on view vw_pendencias_admin is
  'Registros que o sistema nao consegue classificar sozinho, por grupo. A-B vem da '
  'carteira do WinThor; C-D de conversas sem dono; E de contato criado que ainda nao '
  'tem conversa nem cadastro no ERP (0116) e por isso nao aparece em coluna nenhuma '
  'do board. Sem security_invoker: roda como dono para atravessar o RLS (§12.5).';
