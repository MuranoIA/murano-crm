-- =============================================================================
-- 0139 · vw_chat_conversa vira MATERIALIZADA — a lentidão geral do chat
--
-- Investigação pedida pelo usuário (17/09/2026): "os processos do chat e do
-- funil ainda estão lentos". Medido antes de decidir, não suposto:
--
--   GET /api/chat, sessão admin:  4.050 conversas, 3,16 MB, 5,5 a 52 s
--   GET /api/chat, sessão vendedor (carteira só): 657 KB — e AINDA 11 a 17 s
--
-- O payload menor não acelerou nada — descartou "tamanho da resposta" como
-- causa. `EXPLAIN ANALYZE` direto no Postgres, sem a rede até a máquina de
-- teste no meio, achou a causa de verdade:
--
--   Subquery Scan on vw_chat_conversa (actual time=310.708..440.385 rows=4050)
--     -> ... Parallel Seq Scan on mensagens m (actual time=0.464..151.142
--            rows=17026 loops=2) Rows Removed by Filter: 80330
--
-- `vw_chat_conversa` é view COMUM (não materializada) — a própria 0136 já
-- tinha achado isso de passagem ("só vw_chat_conversa é view de verdade") e
-- não agiu. Toda leitura refaz um DISTINCT ON sobre `mensagens` inteira
-- (170 mil linhas e crescendo) para achar a última mensagem de cada cliente.
--
-- E pior: `/api/chat` pagina de 1000 em 1000 (o teto do PostgREST) — com
-- 4.050 linhas isso são 5 páginas, e cada `.range()` é uma consulta SEPARADA
-- que refaz a MESMA varredura inteira de `mensagens` só para devolver um
-- pedaço diferente. ~450ms × 5 = a conta não fecha exatamente com os 5-52s
-- medidos (o resto é rede/overhead da minha máquina de teste até a nuvem,
-- não algo que a Vercel paga do mesmo jeito) — mas é trabalho puro de banco,
-- pago do zero a cada chamada, e cresce junto com `mensagens`. Só piora.
--
-- `vw_funil` e `vw_funil_visivel` já são materializadas (refresh a cada 2 min
-- via pg_cron, 1 a 4s cada) exatamente por este motivo. Esta migration aplica
-- o MESMO remédio, já testado em produção, à view que faltava.
--
-- ---------------------------------------------------------------------------
-- ⚠️ O QUE ISSO MUDA PARA QUEM USA: conversa nova pode levar até 2 minutos
-- para aparecer na barra lateral do chat (a foto só é refeita a cada 2 min).
-- Mensagem NOVA dentro de uma conversa JÁ ABERTA continua instantânea — isso
-- vem do Realtime + `/api/chat/thread?desde=` (§65), que não depende desta
-- view. É a mesma troca que o board já aceitou para `vw_funil_visivel`
-- (§30.4: "30 minutos, mais até 2") — aqui é "conversa nova, mais até 2".
--
-- ⚠️ Nenhuma outra view depende de `vw_chat_conversa` (conferido via
-- pg_depend antes de escrever isto) e ela não tem GRANT para anon nem
-- authenticated (0126b já tinha fechado isso) — a troca para materializada
-- não abre nem fecha nada além do que já estava.
-- =============================================================================

do $$
declare
  def   text;
  ehMat boolean;
begin
  select relkind = 'm' into ehMat from pg_class where relname = 'vw_chat_conversa' and relnamespace = 'public'::regnamespace;
  if ehMat then
    raise exception 'vw_chat_conversa já é materializada — nada a fazer aqui';
  end if;

  def := pg_get_viewdef('vw_chat_conversa'::regclass, true);

  execute format('drop view %I', 'vw_chat_conversa');
  execute format('create materialized view %I as %s', 'vw_chat_conversa', def);

  -- UNIQUE em cliente_id: sem índice único o REFRESH ... CONCURRENTLY do
  -- pg_cron falha (em silêncio, no log que ninguém abre — a mesma armadilha
  -- que a 0136 documentou para vw_funil).
  execute 'create unique index vw_chat_conversa_cliente_id_idx on public.vw_chat_conversa (cliente_id)';

  -- Mesma régua da 0126b: sem GRANT para quem não é dono nem service_role.
  execute 'revoke all on public.vw_chat_conversa from anon, authenticated';
end $$;

comment on materialized view public.vw_chat_conversa is
  'A lista de conversas do CHAT (sidebar), MATERIALIZADA desde 0139 e refeita '
  'a cada 2 min pelo pg_cron — o mesmo remédio que vw_funil/vw_funil_visivel '
  'já usavam. Antes, toda abertura de aba e todo poll de 60s refaziam um '
  'DISTINCT ON sobre a tabela mensagens inteira (170 mil linhas), e a '
  'paginação de /api/chat (5 páginas para 4.050 conversas) repetia essa '
  'varredura 5 vezes por requisição. Conversa nova pode levar até 2 min para '
  'aparecer na sidebar; mensagem nova numa conversa já aberta continua '
  'instantânea (Realtime + /api/chat/thread?desde=, não depende desta view).';

-- Mesmo padrão de refresh-vw-funil / refresh-vw-funil-visivel (0069/0126) —
-- mesma cadência, para as três fotos do sistema envelhecerem juntas.
select cron.schedule(
  'refresh-vw-chat-conversa',
  '*/2 * * * *',
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.vw_chat_conversa $$
);
