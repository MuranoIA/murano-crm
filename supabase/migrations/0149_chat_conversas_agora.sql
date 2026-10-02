-- =============================================================================
-- 0149 · a lista do chat para de esperar a foto (demandas #60 e #38)
--
-- Relato do dono (02/10/2026): "quando o cliente envia uma mensagem nova,
-- demora cerca de 1 a 2 minutos para essa nova mensagem aparecer na tela. A
-- notificação chega imediatamente, mas a mensagem na lista demora." E, na #38:
-- "o nome da cliente deveria ir para o topo da lista imediatamente".
--
-- A causa não é um bug: é o preço que a 0139 cobrou por escrito. `vw_chat_conversa`
-- virou MATERIALIZADA para resolver a lentidão do chat (medido lá: 5 a 52 s por
-- carga), e o comentário daquela migration já avisava —
--
--     "⚠️ O QUE ISSO MUDA PARA QUEM USA: conversa nova pode levar até 2 minutos
--      para aparecer na barra lateral do chat (a foto só é refeita a cada 2 min)."
--
-- O Realtime avisa na hora, a tela recarrega na hora — e recarrega a MESMA foto.
--
-- ---------------------------------------------------------------------------
-- POR QUE NÃO É SÓ REFRESCAR A FOTO MAIS VEZES
--
-- Medido em `pg_stat_statements` (10.871 execuções): cada
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY vw_chat_conversa` custa **1,49 s**.
-- A cada 15 s isso seria ~10% de um núcleo ligado o tempo todo, num banco que
-- já é o gargalo do horário de pico. E ainda assim sobrariam 15 s de atraso.
-- Trocar atraso por carga permanente é pagar duas vezes.
--
-- ---------------------------------------------------------------------------
-- POR QUE NÃO É UMA VIEW COMUM GÊMEA
--
-- A ideia óbvia — uma view normal com o mesmo corpo, consultada só pelos
-- clientes afetados — foi MEDIDA e não serve. O `DISTINCT ON` da CTE não
-- recebe o filtro de fora: o planejador varre `mensagens` inteira do mesmo
-- jeito e ordena em disco.
--
--     where cliente_id in (20 ids)  ->  Parallel Seq Scan + external merge
--                                       Disk: 5.688 kB ·  **641 ms**
--
-- Com o MESMO filtro DENTRO da CTE, o plano vira `Index Scan using
-- idx_msg_cliente` e o tempo cai para **0,4 ms**. Mil e seiscentas vezes.
-- É por isso que isto é uma FUNÇÃO com parâmetro, e não uma view: o parâmetro
-- é o que leva o filtro para dentro.
--
-- ---------------------------------------------------------------------------
-- COMO A REGRA NÃO DIVERGE
--
-- O corpo NÃO é copiado à mão: é lido de `pg_get_viewdef('vw_chat_conversa')`
-- na hora de criar a função, com o filtro injetado na CTE `ult`. Na data desta
-- migration as duas nascem idênticas por construção.
--
-- ⚠️ MAS ELAS PODEM DIVERGIR DEPOIS. Quem mexer na régua da `vw_chat_conversa`
-- (a etapa, o dono, o filtro de linhas) tem de REAPLICAR este bloco — como já
-- vale entre `vw_funil` e `vw_funil_visivel` (§31.1). O sintoma de esquecer é
-- a conversa recém-chegada aparecer com a etapa de ontem até a próxima foto.
-- =============================================================================

do $$
declare
  def   text;
  marca text := 'ORDER BY m.cliente_id, m.criada_em DESC';
  n     int;
begin
  if not exists (select 1 from pg_class where relname = 'vw_chat_conversa'
                   and relnamespace = 'public'::regnamespace and relkind = 'm') then
    raise exception 'vw_chat_conversa não é materializada — esta migration pressupõe a 0139';
  end if;

  def := pg_get_viewdef('vw_chat_conversa'::regclass, true);

  -- a âncora tem de ser única: se a régua mudar e o ORDER BY aparecer duas
  -- vezes, é melhor falhar aqui do que injetar o filtro no lugar errado e
  -- devolver a conversa de outra pessoa
  n := (length(def) - length(replace(def, marca, ''))) / length(marca);
  if n <> 1 then
    raise exception 'esperava 1 ocorrência de "%" na definição, achei %', marca, n;
  end if;

  def := replace(def, marca, 'AND m.cliente_id = ANY (p_ids) ' || marca);

  execute format($f$
    create or replace function public.chat_conversas_agora(p_ids text[])
    returns table (
      cliente_id         text,
      cliente            text,
      vendedor           text,
      ultima_atividade   timestamptz,
      ultima_mensagem    text,
      ultima_enviada_por text,
      etapa              text,
      telefone           text,
      codcli             integer
    )
    language sql
    stable
    security definer
    set search_path = public
    as $corpo$ %s $corpo$;
  $f$, def);
end $$;

comment on function public.chat_conversas_agora(text[]) is
  'As conversas destes clientes AGORA, sem passar pela foto de vw_chat_conversa (0139). Mesmo corpo da view, com o filtro dentro da CTE — é o que troca Seq Scan (641 ms) por Index Scan (0,4 ms). Ver 0149.';

-- `security definer` + revoke: a função lê `mensagens` e `clientes`, que têm
-- RLS ligado sem policy (§12.5). Quem a chama é o servidor com service_role,
-- que já ignora RLS — o `revoke` garante que ela não vire uma porta nova para
-- anon, que é o que `security definer` abriria se ficasse com o GRANT padrão.
revoke all on function public.chat_conversas_agora(text[]) from public, anon, authenticated;

-- A lista pede `order by ultima_atividade desc, cliente_id` em toda carga, e a
-- foto só tinha o índice único de `cliente_id` (o que o REFRESH CONCURRENTLY
-- exige). Sem este, são 4,7 mil linhas ordenadas do zero a cada página — e são
-- 5 páginas na carga completa. Serve também para achar a hora da foto em uma
-- leitura de índice: `order by ultima_atividade desc limit 1`.
create index if not exists vw_chat_conversa_atividade_idx
  on public.vw_chat_conversa (ultima_atividade desc, cliente_id);
