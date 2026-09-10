-- 0130 — quem atende no chat passa a ser ESCOLHA, não consequência
--
-- Desde a 0128 (demandas da Lais), quem não tem carteira atende no chat sob o
-- próprio e-mail. A régua era "não tem carteira e está ativo" — e isso pegou
-- gente demais: a lista de "transferir para" nasceu com NOVE pessoas, entre
-- elas contas que nunca vão atender ninguém (a conta de automação `ia@`, e
-- administradores de outras áreas).
--
-- A régua deixa de ser derivada e vira um interruptor por pessoa, no /admin.
--
-- ⚠️ A COLUNA SÓ VALE PARA QUEM NÃO TEM CARTEIRA.
-- Quem tem carteira atende PELA CARTEIRA — o endereço dela é o slug, e é assim
-- que a conversa chega. `lib/chatEscopo.enderecoDeAtendimento` devolve a
-- carteira antes de olhar este campo, de propósito: um vendedor cujo
-- `atende_chat` ficasse `false` por descuido perderia a própria caixa de
-- entrada, e o sintoma seria "sumiram minhas conversas", sem erro nenhum.
--
-- NASCE FALSO, e a semente vem de EVIDÊNCIA, não de papel: liga-se apenas para
-- quem JÁ recebeu conversa alguma vez (`chat_transferencia` com destino
-- `u:<e-mail>`). O sentido conservador é o certo aqui — ninguém ganha uma
-- atribuição que não tinha, e quem já atende não perde a sua no deploy. O resto
-- se liga na tela, com um clique.

alter table acesso add column if not exists atende_chat boolean not null default false;

comment on column acesso.atende_chat is
  'Atende no chat sob o próprio e-mail (endereço u:<email>), recebendo '
  'transferência e marcando leitura. SÓ VALE PARA QUEM NÃO TEM CARTEIRA — quem '
  'tem atende pela carteira e ignora este campo. Editável em /admin → Usuários.';

do $$
declare n int;
begin
  update acesso a
     set atende_chat = true
   where a.carteira is null
     and exists (
       select 1 from chat_transferencia t
        where t.para_carteira = 'u:' || lower(a.email)
     );
  get diagnostics n = row_count;
  raise notice 'atende_chat ligado por evidência de atendimento: % pessoa(s)', n;
end $$;
