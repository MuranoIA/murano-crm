-- ---------------------------------------------------------------------------
-- 0120 — ✋ Pegar da fila deixa de ter corrida
--
-- MEDIDO EM 30/08/2026 (testes/casos/ciclo10-equipe-simultanea.mjs): duas
-- consultoras clicando "Pegar" na MESMA conversa no mesmo instante recebiam
-- AS DUAS um 200. `chat_transferencia` é append-only e não havia trava: cada
-- chamada leu "sem dono" antes de a outra gravar. O dono efetivo vira a última
-- linha (`vw_chat_atribuicao` desempata por `criada_em desc, id desc`), então
-- uma das duas ficava achando que tinha pegado uma conversa que era da outra —
-- e sem aviso nenhum, até recarregar a tela. Com seis pessoas dividindo a mesma
-- fila, o resultado é duas consultoras escrevendo para a mesma cliente.
--
-- POR QUE NÃO DEU PARA CONSERTAR SÓ NA ROTA: a primeira tentativa foi gravar e
-- depois reler para ver quem ficou como vigente. Não funciona, e o motivo é
-- estrutural: ler depois de escrever detecta quem escreveu ANTES, nunca quem
-- escreve DEPOIS. Cada chamada relia e via a si mesma como a última. Foi
-- exatamente o que o teste mostrou na segunda rodada: 200/200 de novo.
--
-- A decisão precisa ser atômica, e por isso mora aqui. `pg_advisory_xact_lock`
-- serializa apenas as chamadas para a MESMA conversa (a chave é o hash do
-- cliente_id) — duas pessoas pegando conversas diferentes não esperam uma pela
-- outra. O bloqueio morre junto com a transação, então não há o que vazar.
--
-- O QUE NÃO MUDA: a tabela continua append-only e o histórico continua
-- completo. Devolver para a fila (0112) segue sendo uma linha com destino nulo,
-- e uma conversa devolvida pode ser pega de novo — é por isso que a condição
-- olha o DESTINO da última linha, e não "existe alguma linha".
-- ---------------------------------------------------------------------------

create or replace function chat_pegar_da_fila(
  p_cliente_id text,
  p_para       text,
  p_por        text,
  p_observacao text default null
) returns jsonb
language plpgsql
as $$
declare
  v_ultima  chat_transferencia%rowtype;
  v_achou   boolean := false;
  v_nova    chat_transferencia%rowtype;
begin
  if p_cliente_id is null or p_para is null then
    raise exception 'chat_pegar_da_fila: cliente_id e para são obrigatórios';
  end if;

  -- Só as chamadas desta mesma conversa esperam. Solto no fim da transação.
  perform pg_advisory_xact_lock(hashtext(p_cliente_id));

  select * into v_ultima
    from chat_transferencia
   where cliente_id = p_cliente_id
   order by criada_em desc, id desc
   limit 1;
  v_achou := found;

  -- Já tem dono efetivo: quem chegou depois perde, e recebe o nome de quem levou.
  if v_achou and v_ultima.para_carteira is not null then
    return jsonb_build_object(
      'ok', false,
      'dono', v_ultima.para_carteira
    );
  end if;

  insert into chat_transferencia (cliente_id, de_carteira, para_carteira, por, observacao)
  values (p_cliente_id, null, p_para, p_por, p_observacao)
  returning * into v_nova;

  return jsonb_build_object(
    'ok', true,
    'transferencia', to_jsonb(v_nova)
  );
end;
$$;

comment on function chat_pegar_da_fila(text, text, text, text) is
  'Puxa uma conversa da fila de não atribuídos sem corrida (0120). Devolve '
  '{ok:false, dono} quando outra pessoa pegou primeiro.';

-- A rota chama com service_role, que ignora RLS; o grant explícito existe para
-- a função não depender do papel padrão mudar no futuro.
grant execute on function chat_pegar_da_fila(text, text, text, text) to service_role;
