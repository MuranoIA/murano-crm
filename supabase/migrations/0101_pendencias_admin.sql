-- =============================================================================
-- 0101 · A lista do que o board não consegue colocar em lugar nenhum.
--
-- Pedido do usuário (25/08/2026): *"os 102, assim como outros que não estiverem
-- em carteira dos vendedores existentes no nosso board, podem aparecer em uma
-- lista para o admin resolver o que faz... por hora eles não podem ficar sem
-- serem visualizados pelo admin"*.
--
-- O princípio, que vale além desta view: **um registro que o sistema não sabe
-- classificar não pode simplesmente não aparecer.** Foi exatamente assim que a
-- conversa da §34 ficou invisível por meses — havia até uma métrica registrando
-- o caso (`vw_carteira_conflito.no_board`), mas ninguém traduziu o número em
-- "tem gente falando conosco que não achamos". Contagem escondida em view de
-- diagnóstico não é visibilidade; tela é.
--
-- Esta view NÃO resolve nada e não deve resolver: as ações vêm depois. Ela só
-- garante que o problema tenha dono e prazo, em vez de virar silêncio.
--
-- ---------------------------------------------------------------------------
-- OS QUATRO GRUPOS (medidos em 25/08/2026)
--
--   A  102  cliente da carteira SEM TELEFONE
--           Não há para onde mandar nada — nem template. Buraco de cadastro no
--           WinThor; só se resolve lá.
--
--   B  144  cliente da carteira com telefone, mas SEM linha em `clientes`
--           O board mostra o card (prospecção), e o botão de template não tem
--           `cliente_id` para usar. É o único grupo com conserto automático:
--           provisionar a linha, como faz /api/chat/novo-contato.
--
--   C   79  contato COM conversa e SEM cadastro no ERP
--           Alguém está falando conosco e não é cliente de ninguém. Decidir:
--           cadastrar no WinThor, atribuir a uma carteira, ou descartar.
--
--   D  112  contato COM conversa, cadastrado, mas RCA FORA das carteiras ativas
--           Cliente de outro time (GC/IS) que conversou com a gente. Desde a
--           0100 ele aparece na fila de não atribuídos em vez de sumir — aqui
--           é onde o admin vê quantos são e de quem deveriam ser.
--
-- `grupo` é uma letra + rótulo de propósito: a tela ordena por ela e o texto
-- explica sem depender de legenda em outro lugar.
--
-- ⚠️ Sem `security_invoker`: roda como dono para atravessar o RLS das tabelas
-- base (§12.5). Só rotas com service_role a consultam, e a rota exige admin.
-- =============================================================================

create or replace view vw_pendencias_admin as
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
  and not exists (select 1 from ativas a where a.rca_num = wcar.rca_num);

comment on view vw_pendencias_admin is
  'O que o board nao consegue classificar: sem telefone (A), sem contato criado (B), '
  'conversa sem cadastro no ERP (C), RCA fora das carteiras ativas (D). Lida so por '
  '/api/admin/pendencias. Nao resolve nada de proposito -- existe para o caso ter dono, '
  'em vez de virar silencio como aconteceu na §34.';
