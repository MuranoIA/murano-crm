-- =============================================================================
-- REALTIME DO BOARD — substitui o polling de 5s do navegador
--
-- POR QUÊ:
--   O board (web/app/page.tsx) recarregava /api/funil a cada 5s POR ABA ABERTA.
--   Com 7 vendedores logados isso são ~84 reconstruções completas do funil por
--   minuto — cada uma paginando vw_funil, vw_pedido_bi_card e vw_ciclo_card e
--   cruzando wth_faturamento (46k linhas). Trabalho repetido sem nenhum sinal
--   de que algo mudou.
--
--   A ingestão do RD Conversas TEM que ser pull (a API não tem webhook — 404
--   confirmado, ver CLAUDE.md seção 2). Mas a DISTRIBUIÇÃO daqui para os
--   navegadores não precisa de polling: quando o ETL grava em `mensagens`,
--   o Postgres avisa e as abas recarregam uma vez só.
--
-- DESENHO:
--   Trigger de STATEMENT (não de linha) com transition table. O ETL faz upsert
--   em lotes de até 500 linhas — um trigger FOR EACH ROW dispararia 500 eventos
--   por lote. FOR EACH STATEMENT dispara 1 evento por carteira afetada.
--
--   Canal PÚBLICO (private => false) de propósito: o board autentica por cookie
--   próprio (crm_sessao), não por Supabase Auth, então não há JWT para validar
--   um canal privado. O payload NÃO carrega dado de negócio — só o slug da
--   carteira e o horário. Quem escuta descobre "a carteira X teve atividade
--   às 14:32" e nada mais; os dados continuam vindo de /api/funil, que aplica
--   a autorização por carteira no servidor.
--
-- SEGURANÇA DE FALHA (o ponto mais importante deste arquivo):
--   A notificação NUNCA pode derrubar a escrita do ETL. Todo o corpo está sob
--   `exception when others` — se realtime.send falhar, sumir ou mudar de
--   assinatura, o upsert continua passando e o board apenas volta a depender do
--   poll lento de 60s que o front mantém como rede de proteção.
-- =============================================================================

create or replace function public.board_notificar_carteiras(p_carteiras text[])
returns void
language plpgsql
security definer
set search_path to 'public','realtime','extensions'
as $$
declare
  v_cart text;
begin
  foreach v_cart in array coalesce(p_carteiras, '{}'::text[]) loop
    perform realtime.send(
      jsonb_build_object('carteira', v_cart, 'em', now()),
      'mudou',    -- event
      'board',    -- topic
      false       -- private => canal público (ver nota acima)
    );
  end loop;
exception when others then
  -- degrada para o poll lento do front; deixa rastro no log do Postgres
  raise warning 'board_notificar_carteiras falhou (ignorado): %', sqlerrm;
end;
$$;

-- Função nova nasce com EXECUTE para PUBLIC e o PostgREST a expõe em /rest/v1/rpc/*.
-- Ninguém de fora precisa chamá-la — quem dispara são os triggers abaixo. Sem este
-- revoke, qualquer um com a chave anon forçaria TODOS os boards abertos a recarregar
-- em loop (cada reload = /api/funil inteiro) — amplificação apontada justamente para
-- o custo que esta migration elimina.
revoke execute on function public.board_notificar_carteiras(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- mensagens: INSERT = mensagem nova, sempre é novidade real.
-- ---------------------------------------------------------------------------
create or replace function public.trg_board_mensagens_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.board_notificar_carteiras(
    array(select distinct vendedor_carteira from novas where vendedor_carteira is not null)
  );
  return null;
end;
$$;

drop trigger if exists trg_board_mensagens_insert on public.mensagens;
create trigger trg_board_mensagens_insert
after insert on public.mensagens
referencing new table as novas
for each statement execute function public.trg_board_mensagens_insert();

-- ---------------------------------------------------------------------------
-- mensagens: UPDATE — aqui precisa de filtro.
--
-- O id da mensagem é sha1(cliente_id|created_at|content), então um UPDATE por
-- upsert significa que conteúdo e data são os MESMOS por construção: o ETL
-- re-baixa as últimas 50 mensagens de cada conversa e regrava as que já existem.
-- Notificar nesses casos faria o board recarregar sem que nada tivesse mudado —
-- exatamente o desperdício que esta migration existe para eliminar.
--
-- Só interessa o que de fato muda numa mensagem já conhecida: `status`
-- (wait -> success -> read -> checked) e `tipo`.
-- ---------------------------------------------------------------------------
create or replace function public.trg_board_mensagens_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.board_notificar_carteiras(
    array(
      select distinct n.vendedor_carteira
      from novas n
      join antigas a on a.id = n.id
      where n.vendedor_carteira is not null
        and (n.status is distinct from a.status or n.tipo is distinct from a.tipo)
    )
  );
  return null;
end;
$$;

drop trigger if exists trg_board_mensagens_update on public.mensagens;
create trigger trg_board_mensagens_update
after update on public.mensagens
referencing old table as antigas new table as novas
for each statement execute function public.trg_board_mensagens_update();

-- ---------------------------------------------------------------------------
-- disparos_template: template enviado pelo board precisa aparecer na hora
-- (a coluna muda de etapa e o contador do cabeçalho sobe).
-- ---------------------------------------------------------------------------
create or replace function public.trg_board_disparos_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.board_notificar_carteiras(
    array(select distinct vendedor from novas where vendedor is not null)
  );
  return null;
end;
$$;

drop trigger if exists trg_board_disparos_insert on public.disparos_template;
create trigger trg_board_disparos_insert
after insert on public.disparos_template
referencing new table as novas
for each statement execute function public.trg_board_disparos_insert();

-- ---------------------------------------------------------------------------
-- Conferir depois de aplicar:
--   select tgname, tgrelid::regclass from pg_trigger
--    where tgname like 'trg_board_%' and not tgisinternal;
--
-- Teste ao vivo (com o board aberto no navegador, deve recarregar em ~1s):
--   select public.board_notificar_carteiras(array['romulo']);
-- ---------------------------------------------------------------------------
