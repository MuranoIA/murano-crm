-- =============================================================================
-- 0140 · Captura de erro do cliente — a tela para de ficar muda quando quebra
--
-- Relato da Kamilly (17/09/2026): "Application error: a client-side exception
-- has occurred" quatro vezes no mesmo dia, dentro do iframe do hub. Investiguei
-- bastante (iframe estreito, troca rápida de conversa, redimensionamento,
-- sessão real dela com a fila de 772 conversas) e não consegui reproduzir.
--
-- O achado que importa mais que a causa pontual: este projeto **não tem
-- NENHUM arquivo de captura de erro** (`error.tsx`/`global-error.tsx`) em
-- lugar nenhum. Quando algo quebra, o Next.js mostra o texto genérico e
-- NADA fica registrado — nem console persistente, nem banco. Foi por isso
-- que não sobrou nenhuma pista desta vez.
--
-- Esta migration é só a mesa onde esse erro passa a pousar. A tela que o
-- lê e o botão de registrar (`web/app/error.tsx`, `global-error.tsx`,
-- `/api/erros`) vêm no mesmo PR, código do app — aqui é só a tabela.
-- =============================================================================

create table if not exists erro_cliente (
  id            bigint generated always as identity primary key,
  criado_em     timestamptz not null default now(),
  -- a URL (pathname + query) onde a tela quebrou — o primeiro filtro de
  -- qualquer investigação é "em qual tela".
  rota          text,
  mensagem      text,
  stack         text,
  -- o Next.js gera um "digest" por erro (hash determinístico da causa) — serve
  -- para agrupar "é a mesma quebra de sempre" sem comparar stack inteiro.
  digest        text,
  usuario_email text,
  usuario_papel text,
  -- dentro do iframe do hub ou acesso direto? é exatamente a pergunta que a
  -- investigação de hoje não conseguiu responder sem isto.
  embutido      boolean,
  user_agent    text,
  -- campo de escape para o que não tem coluna própria ainda (viewport, etc.) —
  -- sem isso, todo dado novo pediria uma migration só para caber.
  extra         jsonb
);

comment on table erro_cliente is
  'Erros de renderização capturados no navegador (error.tsx/global-error.tsx). '
  'Existe porque em 17/09/2026 um erro relatado por uma vendedora não deixou '
  'nenhum rastro — nem console, nem banco. Gravado pela rota /api/erros, que '
  'roda com service_role e nunca lança exceção própria (um erro ao registrar '
  'um erro não pode virar uma segunda tela quebrada).';

-- Mesma régua do resto da casa (§12.5 do CLAUDE.md): RLS ligado, SEM policy.
-- anon/authenticated não leem nem escrevem nada; só service_role (a rota da
-- API) atravessa. Consultar é sempre via SQL direto ou pela própria rota.
alter table erro_cliente enable row level security;
