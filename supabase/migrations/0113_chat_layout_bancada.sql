-- =============================================================================
-- 0113 — a Direção 4 ("bancada") passa a ser um valor aceito
--
-- A 0095 fixou os quatro nomes possíveis num CHECK, e o comentário dela explica
-- por quê: este valor é lido pelo /chat para escolher o que renderizar, então um
-- typo aplicado por SQL manual deixaria a tela sem desenho para todo mundo ao
-- mesmo tempo. O preço dessa proteção é este arquivo — desenho novo exige
-- migration, e é uma troca que continua valendo.
--
--   bancada — Direção 4: nada de novo na tela, tudo no mesmo ritmo. Herda as
--             correções da 1 e submete a tela a uma grade (espaço, tipografia,
--             raio, altura de controle, elevação e papel de cor).
--             Laudo: prototipos/laudo-tema-premium.md
--
-- ⚠️ O que esta migration NÃO decide: se a Direção 4 tem tela construída. Isso
-- é fato do CÓDIGO (`implementado` em web/lib/chatLayout.ts), não desta tabela,
-- e a separação é o ponto inteiro da 0095 — duplicar aqui criaria duas verdades
-- que divergem no primeiro deploy, e o admin conseguiria estabelecer para todos
-- um desenho que ninguém construiu. Aceitar o valor e implementá-lo são coisas
-- diferentes; esta migration só faz a primeira.
--
-- Nada é apagado e nenhum valor existente muda: quem está em 'original' ou
-- 'continuidade' continua onde está. `original` segue sendo válido, então o
-- caminho de volta continua aberto — a régua da §29.3 do CLAUDE.md.
-- =============================================================================

-- 1) o desenho global (linha única)
alter table chat_layout drop constraint if exists chat_layout_layout_check;
alter table chat_layout add constraint chat_layout_layout_check
  check (layout in ('original', 'continuidade', 'bancada', 'fila', 'balcao'));

-- 2) o piloto por usuário. NULL continua significando "segue o global", que é
--    o estado da esmagadora maioria das linhas de `acesso`.
alter table acesso drop constraint if exists acesso_chat_layout_check;
alter table acesso add constraint acesso_chat_layout_check
  check (chat_layout is null
         or chat_layout in ('original', 'continuidade', 'bancada', 'fila', 'balcao'));

-- `chat_layout_historico` não é tocada de propósito: `de` e `para` são texto
-- livre lá, e devem continuar sendo. O histórico registra o que aconteceu,
-- inclusive uma troca para um desenho que mais tarde saia do catálogo — um
-- CHECK ali passaria a rejeitar a escrita de um fato passado.
