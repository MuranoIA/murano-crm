-- 0142 — o chat-v2 vira um desenho escolhível (fase 6 do chat-v2, CLAUDE.md §73).
--
-- O piloto por pessoa já existe (0095): `acesso.chat_layout` sobrepõe o
-- desenho global para UMA pessoa. Falta só o valor 'v2' ser aceito — o CHECK
-- de 0095/0113 lista os nomes possíveis, e fora dele o banco recusa.
--
-- O que muda: SÓ as duas restrições, alargadas. Nenhuma linha é tocada, então
-- aplicar isto não troca a tela de ninguém. Quem liga o v2 para alguém é um
-- admin, em /admin → 🎨 Desenho do chat, pessoa por pessoa.
--
-- O que decide se 'v2' pode ser ESCOLHIDO continua sendo o código
-- (`lib/chatLayout.ts`, `implementado`), não o banco (§29.3): este CHECK só
-- impede lixo; ele não afirma que a tela existe.
--
-- Rollback: voltar os CHECKs aos cinco nomes. Antes, zerar quem estiver em
-- 'v2' (update acesso set chat_layout = null where chat_layout = 'v2'), senão o
-- alter falha — que é o comportamento certo: o banco não deixa esquecer alguém
-- num desenho que deixou de existir.

alter table public.acesso
  drop constraint if exists acesso_chat_layout_check;
alter table public.acesso
  add constraint acesso_chat_layout_check
  check (chat_layout is null or chat_layout in
    ('original', 'continuidade', 'bancada', 'fila', 'balcao', 'v2'));

alter table public.chat_layout
  drop constraint if exists chat_layout_layout_check;
alter table public.chat_layout
  add constraint chat_layout_layout_check
  check (layout in ('original', 'continuidade', 'bancada', 'fila', 'balcao', 'v2'));
