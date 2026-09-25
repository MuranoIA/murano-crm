-- =============================================================================
-- Teste da 0143 — o funil IGNORA o aviso de entrega (mensagens.aviso_entrega).
--
-- Roda DEPOIS da 0143, contra produção, dentro de uma transação que termina em
-- ROLLBACK (nada fica). Formato herdado do murano-app: tabela temporária de
-- resultado, uma linha por cenário, CONTRAPROVAS, e toda leitura de conferência
-- feita como o dono (postgres) — aqui não há sessão restrita em jogo.
--
-- A régua é testada nas DEFINIÇÕES das views (executadas ao vivo) e na
-- get_funil_card — não no conteúdo das matviews, que é uma foto de até 2 min
-- e não enxergaria as linhas inseridas nesta transação.
--
-- Esperado: todas as linhas com ok = true.
-- =============================================================================
begin;

create temp table resultado (n int, cenario text, esperado text, obtido text, ok boolean) on commit drop;

-- Uma cliente COM conversa (a mais recente, para ter etapa estável) e um
-- cadastro de PROSPECÇÃO (carteira ativa, nunca contatado) com telefone.
create temp table alvo on commit drop as
select (select cliente_id from public.vw_chat_conversa
         where cliente_id not like 'wa:%' order by ultima_atividade desc limit 1) as conversa,
       (select codcli from public.vw_funil_visivel
         where etapa = 'prospeccao' and length(regexp_replace(coalesce(telefone,''), '\D', '', 'g')) >= 10
         order by codcli limit 1) as prospect;
-- linha (número) da última mensagem da conversa: a mensagem de teste tem que
-- estar num número VISÍVEL, senão a vw_funil_visivel e a lista do chat nem a
-- enxergariam e a contraprova passaria pelo motivo errado.
alter table alvo add column linha text;
update alvo set linha = (select linha_id from public.mensagens
                          where cliente_id = alvo.conversa and tipo <> 'evento_sistema'
                          order by criada_em desc limit 1);

-- Funções auxiliares: a etapa/última atividade que cada DEFINIÇÃO devolve agora.
create function pg_temp.linha_def(v text, id text) returns text language plpgsql as $$
declare r text;
begin
  execute format('select coalesce(etapa,''-'') || ''|'' || coalesce(ultima_atividade::text,''-'') || ''|'' || coalesce(ultima_mensagem,''-'')
                    from (%s) t where cliente_id = %L',
                 rtrim(pg_get_viewdef(v::regclass, true), '; ' || chr(10)), id) into r;
  return coalesce(r, 'AUSENTE');
end $$;
create function pg_temp.linha_card(id text) returns text language sql as $$
  select coalesce((select coalesce(etapa,'-') || '|' || coalesce(ultima_atividade::text,'-') || '|' || coalesce(ultima_mensagem,'-')
                     from public.get_funil_card(id)), 'AUSENTE') $$;
create function pg_temp.tem_def(v text, id text) returns boolean language plpgsql as $$
declare r boolean;
begin
  execute format('select exists (select 1 from (%s) t where cliente_id = %L)',
                 rtrim(pg_get_viewdef(v::regclass, true), '; ' || chr(10)), id) into r;
  return r;
end $$;

create temp table antes on commit drop as
select v, pg_temp.linha_def(v, (select conversa from alvo)) as linha
  from unnest(array['vw_funil','vw_funil_visivel','vw_chat_conversa']) v
union all
select 'get_funil_card', pg_temp.linha_card((select conversa from alvo));

-- 0. a coluna existe, sem nulo, e nada no histórico foi marcado por engano
insert into resultado
select 0, 'coluna aviso_entrega not null, default false', 'sim',
       (select case when is_nullable = 'NO' and column_default = 'false' then 'sim' else 'nao' end
          from information_schema.columns where table_name = 'mensagens' and column_name = 'aviso_entrega'),
       null;

-- 1. AVISO na conversa: nada muda em nenhum dos quatro
insert into public.mensagens (id, cliente_id, enviada_por, tipo, conteudo, status, criada_em, aviso_entrega, linha_id)
select 'teste-0143-aviso', conversa, 'bot', 'template', 'Olá! Seu pedido saiu para entrega.', 'wait', now(), true, linha from alvo;

insert into resultado
select 1, 'aviso nao move: ' || a.v, a.linha,
       case when a.v = 'get_funil_card' then pg_temp.linha_card((select conversa from alvo))
            else pg_temp.linha_def(a.v, (select conversa from alvo)) end, null
  from antes a;

-- 2. CONTRAPROVA: a MESMA mensagem sem a marca move os quatro. Sem isto o
--    cenário 1 passaria também se as views tivessem parado de enxergar
--    mensagem nova de qualquer tipo.
insert into public.mensagens (id, cliente_id, enviada_por, tipo, conteudo, status, criada_em, aviso_entrega, linha_id)
select 'teste-0143-comum', conversa, 'bot', 'template', 'Campanha sem a marca', 'wait', now() + interval '1 second', false, linha from alvo;

insert into resultado
select 2, 'sem a marca MOVE: ' || a.v, 'diferente de antes',
       case when (case when a.v = 'get_funil_card' then pg_temp.linha_card((select conversa from alvo))
                       else pg_temp.linha_def(a.v, (select conversa from alvo)) end) like '%Campanha sem a marca'
            then 'diferente de antes' else 'igual' end, null
  from antes a;

-- 3. PROSPECÇÃO: cliente nunca contatada recebe SÓ o aviso (o contato nasce
--    como a rota faz: cadastro + vínculo pelo codcli). O card winthor:<codcli>
--    continua na prospecção, e o cadastro novo não vira conversa.
-- A vw_funil monta MENOS cards de prospeccao que a visivel (25/09/2026: 153
-- contra 406), entao o prospect escolhido pode nem estar nela. A regra e "o
-- aviso nao muda a presenca do card": compara com o antes, nao com true.
create temp table prospect_antes on commit drop as
select pg_temp.tem_def('vw_funil', 'winthor:' || (select prospect from alvo))::text as na_vw_funil;

insert into public.clientes (id, nome_completo, telefone, canal)
select 'teste-0143-cli', w.nome, w.telefone, 'whatsapp'
  from public.wth_carteira w, alvo where w.codcli = alvo.prospect;
insert into public.wth_vinculo (cliente_id, codcli, cpf, origem)
select 'teste-0143-cli', prospect, 'teste-0143', 'manual' from alvo;
insert into public.mensagens (id, cliente_id, enviada_por, tipo, conteudo, status, criada_em, aviso_entrega, linha_id)
values ('teste-0143-aviso-p', 'teste-0143-cli', 'bot', 'template', 'Seu pedido saiu.', 'wait', now(), true, (select linha from alvo));

insert into resultado values
  (3, 'prospect com aviso segue em prospeccao (visivel)', 'true',
      pg_temp.tem_def('vw_funil_visivel', 'winthor:' || (select prospect from alvo))::text, null),
  (4, 'prospect com aviso: presenca na vw_funil igual a de antes', (select na_vw_funil from prospect_antes),
      pg_temp.tem_def('vw_funil', 'winthor:' || (select prospect from alvo))::text, null),
  (5, 'cadastro so com aviso nao vira conversa (visivel)', 'false',
      pg_temp.tem_def('vw_funil_visivel', 'teste-0143-cli')::text, null),
  (6, 'cadastro so com aviso fora da lista do chat', 'false',
      pg_temp.tem_def('vw_chat_conversa', 'teste-0143-cli')::text, null),
  (7, 'cadastro so com aviso: get_funil_card vazio', 'AUSENTE',
      pg_temp.linha_card('teste-0143-cli'), null);

-- 8-9. CONTRAPROVA da prospecção: uma mensagem real tira da prospecção.
insert into public.mensagens (id, cliente_id, enviada_por, tipo, conteudo, status, criada_em, aviso_entrega, linha_id)
values ('teste-0143-real-p', 'teste-0143-cli', 'customer', 'text', 'oi', 'received', now(), false, (select linha from alvo));
insert into resultado values
  (8, 'mensagem real TIRA da prospeccao', 'false',
      pg_temp.tem_def('vw_funil_visivel', 'winthor:' || (select prospect from alvo))::text, null),
  (9, 'mensagem real vira conversa', 'true',
      pg_temp.tem_def('vw_funil_visivel', 'teste-0143-cli')::text, null);

-- 10. permissões que a 0143 recriou: a lista do chat continua fechada para anon
insert into resultado values
  (10, 'vw_chat_conversa sem select para anon', 'false',
       has_table_privilege('anon', 'public.vw_chat_conversa', 'select')::text, null),
  (11, 'indices unicos (REFRESH CONCURRENTLY) presentes', '3',
       (select count(*)::text from pg_indexes where schemaname = 'public'
          and tablename in ('vw_funil','vw_funil_visivel','vw_chat_conversa') and indexdef like 'CREATE UNIQUE%'), null);

update resultado set ok = (esperado = obtido);
select n, ok, cenario, esperado, obtido from resultado order by n, cenario;

rollback;
