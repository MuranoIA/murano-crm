-- ---------------------------------------------------------------------------
-- 0121 — o Realtime deixa de ser mudo para conversa SEM carteira
--
-- MEDIDO EM 30/08/2026 (testes/casos/ciclo11-iframe-hub.mjs): com a conversa
-- ABERTA na tela, a mensagem da cliente levou 40,9s para aparecer. Veio pelo
-- poll de 60s, não pelo Realtime. O WebSocket conectava e estava inscrito
-- (`phx_reply status:ok` no diagnóstico) — o evento é que nunca era enviado.
--
-- CAUSA: os três gatilhos filtravam `where vendedor_carteira is not null`.
-- Contato novo (`wa:<numero>`) nasce SEM carteira, e continua sem: pegar da
-- fila grava em `chat_transferencia`, não em `clientes.carteira` (§18, §10.11).
-- Ou seja, o único caso que não avisava ninguém era justamente o mais urgente
-- do produto — cliente nova escrevendo agora, na fila de não atribuídos.
--
-- Nos últimos 30 dias são 82 de 37.821 mensagens sem carteira: parece pouco,
-- mas é o perfil do PASSADO, quando quase tudo vinha do RD com carteira já
-- resolvida. Depois do corte (§44), todo contato novo entra por esse caminho.
--
-- O front já sabia lidar com carteira nula e ninguém tinha percebido:
--     if (cart && sessao.carteira && cart !== sessao.carteira) return;
-- com `cart` nulo nada é filtrado, então o aviso chega a todos — que é o certo
-- para uma fila que é de todos.
--
-- Custo: um broadcast a mais por lote que contenha mensagem sem carteira. O
-- ETL faz upsert em lotes de 500, e o gatilho é POR STATEMENT (não por linha),
-- então o teto continua sendo "um aviso por carteira distinta no lote".
-- ---------------------------------------------------------------------------

create or replace function trg_board_mensagens_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- SEM o `is not null`: carteira nula vira um balde próprio, e o front
  -- entende `carteira: null` como "avisa todo mundo".
  perform public.board_notificar_carteiras(
    array(select distinct vendedor_carteira from novas)
  );
  return null;
end;
$$;

create or replace function trg_board_mensagens_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.board_notificar_carteiras(
    array(
      select distinct n.vendedor_carteira
      from novas n
      join antigas a on a.id = n.id
      where (n.status is distinct from a.status or n.tipo is distinct from a.tipo)
    )
  );
  return null;
end;
$$;

create or replace function trg_board_disparos_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.board_notificar_carteiras(
    array(select distinct vendedor from novas)
  );
  return null;
end;
$$;
