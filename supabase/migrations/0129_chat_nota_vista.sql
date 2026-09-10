-- =============================================================================
-- 0129 · A nota interna passa a AVISAR o dono da conversa
--
-- Hoje a nota (0082) é um bilhete deixado dentro da thread: aparece no ponto da
-- conversa em que foi escrita, e o cliente nunca vê. O que faltava é o outro
-- lado do gesto — quando o supervisor observa uma conversa e anota "cobra o
-- retorno hoje", o vendedor dono só descobre se abrir aquela conversa por
-- acaso. Um recado que depende de acaso não é recado.
--
-- Esta tabela é a marca de "já vi esta nota", POR USUÁRIO. A pergunta que a
-- tela faz é a negação dela:
--
--     nota de OUTRA pessoa, numa conversa que está na minha lista,
--     sem linha aqui para mim  ->  é aviso
--
-- Note o que NÃO existe aqui: nenhuma coluna de destinatário. O escopo do
-- /api/chat já resolve isso — a lista de um vendedor só traz as conversas dele
-- (carteira + transferências vigentes, `aplicaEscopo`), então "nota numa
-- conversa da minha lista" É "nota para mim", sem uma segunda régua de dono
-- que divergiria da primeira no primeiro ajuste (mesma armadilha da §32.2 do
-- CLAUDE.md, onde duas views precisam andar juntas).
--
-- Tabela separada, e não uma coluna `vista_em` em `chat_nota`, porque a mesma
-- nota tem mais de um leitor possível: o dono da conversa, e o supervisor que
-- olha depois. Uma coluna só guardaria o primeiro que passou.
--
-- Sem FK para o usuário (não há tabela de usuário canônica — `acesso` é
-- cadastro de permissão, e o login por senha nem e-mail tem, §chatUsuario).
-- COM FK para `chat_nota`, com cascade: apagada a nota, a marca não faz
-- sentido nenhum e some junto.
--
-- RLS ligado sem policy, como todo o resto do módulo do chat: anon e
-- authenticated não leem linha nenhuma; o app entra por service_role.
-- =============================================================================

create table if not exists chat_nota_vista (
  nota_id  bigint      not null references chat_nota(id) on delete cascade,
  usuario  text        not null,
  vista_em timestamptz not null default now(),
  primary key (nota_id, usuario)
);

-- a consulta quente é "as marcas DESTE usuário", para negar contra as notas
create index if not exists idx_chat_nota_vista_usuario
  on chat_nota_vista (usuario);

alter table chat_nota_vista enable row level security;

-- ---------------------------------------------------------------------------
-- As 18 notas que já existem nascem VISTAS — o coringa `'*'`
--
-- Sem isto, o dia do deploy começaria com um aviso para cada nota escrita
-- desde 27/08/2026, em conversas que já foram atendidas e encerradas há
-- semanas. O primeiro contato da equipe com o recurso seria um alarme falso, e
-- alarme falso é como se ensina alguém a ignorar um alarme.
--
-- `usuario = '*'` significa "esta nota é anterior ao recurso; ninguém precisa
-- ser avisado dela". A leitura consulta as marcas do usuário E as do coringa,
-- então isto vale inclusive para quem entrar no sistema depois — o que uma
-- semeadura por usuário conhecido não daria.
-- ---------------------------------------------------------------------------
insert into chat_nota_vista (nota_id, usuario)
select id, '*' from chat_nota
on conflict do nothing;
