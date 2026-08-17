-- =============================================================================
-- 0087 · Ligação por dentro do chat — registro e sinalização
--
-- Duas coisas diferentes moram nesta tabela, de propósito:
--
--   1) O REGISTRO da ligação (quem ligou pra quem, quando, quanto durou, no que
--      deu) — o contato por voz passa a aparecer na conversa e a contar como
--      tentativa de contato, o que nenhuma ligação fazia antes.
--
--   2) A SINALIZAÇÃO da chamada de voz do WhatsApp (WhatsApp Business Calling
--      API). O SDP da outra ponta NÃO volta na resposta HTTP do Graph: ele chega
--      pelo webhook, num processo separado do navegador que está com o microfone
--      aberto. Alguém tem que fazer a ponte entre os dois — é `sdp_remoto` aqui,
--      mais o broadcast do Realtime lá embaixo. Sem isso o WebRTC não fecha.
--
-- ESCOPO — SÓ O PILOTO (decisão do usuário em 17/08/2026):
-- a ligação existe apenas onde a conversa já corre na Cloud API. O número
-- oficial ainda está no RD/Tallos (§16) e o RD não tem API de voz, então em
-- conversa do RD não há ligação — o botão nem aparece, e a rota barra.
-- A coluna `canal` aceita 'tel' porque um dia pode fazer sentido registrar
-- ligação feita pelo celular; HOJE NADA GRAVA ESSE VALOR. Se for descartado de
-- vez, estreitar o CHECK numa migration própria.
--
-- NÃO grava em `mensagens`. Ligação não é mensagem: uma linha lá viraria "a
-- última mensagem" da conversa, moveria o card de etapa no funil (§11.1) e
-- abriria uma espera no indicador de tempo de resposta — exatamente os dois bugs
-- silenciosos que a reação causou e a 0086 corrigiu (§21.2). Aqui é tabela
-- própria, e a thread do chat intercala pela data, como já faz com notas e
-- transferências.
-- =============================================================================

create table if not exists chat_ligacao (
  id            bigint generated always as identity primary key,
  cliente_id    text not null,
  canal         text not null check (canal in ('whatsapp', 'tel')),
  direcao       text not null check (direcao in ('saida', 'entrada')),

  -- Ciclo de vida. 'discando' e 'tocando' são estados VIVOS: a view de ativas
  -- abaixo é o que o navegador consulta ao abrir a tela, para reencontrar uma
  -- chamada em curso depois de um F5.
  status        text not null default 'discando'
                check (status in ('discando', 'tocando', 'em_curso', 'concluida',
                                  'recusada', 'nao_atendida', 'falhou', 'cancelada')),

  call_id       text unique,     -- wacid da Meta; nulo entre o INSERT e a resposta do Graph
  linha_id      text,            -- phone_number_id por onde a chamada correu (§0080)
  carteira      text,            -- dono efetivo da conversa no momento da ligação
  por           text,            -- e-mail de quem operou; null se ninguém atendeu
  telefone      text,            -- destino, como discado (E.164 sem '+')

  iniciada_em   timestamptz not null default now(),
  atendida_em   timestamptz,     -- quando o áudio começou de fato
  encerrada_em  timestamptz,
  duracao_seg   integer,         -- só o tempo FALADO (de atendida_em a encerrada_em)

  -- resultado, no vocabulário que a equipe já usa para tabulação (§6). Quem
  -- preenche é o vendedor ao encerrar — é o que transforma "liguei" em dado.
  motivo        text,
  observacao    text,
  erro          text,            -- mensagem do Graph quando status='falhou'

  -- Sinalização WebRTC. Guarda o ÚLTIMO SDP recebido da
  -- outra ponta e ainda não consumido pelo navegador:
  --   · saída  -> chega um 'answer'  (a cliente aceitou a nossa oferta)
  --   · entrada-> chega um 'offer'   (a cliente está ligando; respondemos answer)
  -- Fica no banco, e não só no broadcast, porque o navegador pode assinar o canal
  -- depois do evento (F5 no meio do toque). O banco é a memória; o broadcast é só
  -- o toque na campainha.
  sdp_remoto    text,
  sdp_tipo      text check (sdp_tipo in ('offer', 'answer')),

  atualizada_em timestamptz not null default now()
);

create index if not exists idx_chat_ligacao_cliente
  on chat_ligacao (cliente_id, iniciada_em desc);

-- índice parcial: as chamadas VIVAS são pouquíssimas, e é o que a tela consulta
-- a cada abertura
create index if not exists idx_chat_ligacao_ativa
  on chat_ligacao (status, iniciada_em desc)
  where status in ('discando', 'tocando', 'em_curso');

alter table chat_ligacao enable row level security;

comment on table chat_ligacao is
  'Ligações do chat pela WhatsApp Business Calling API (só conversas da Cloud API). '
  'Registro do contato por voz + sinalização WebRTC. NÃO é mensagem: não entra em '
  '`mensagens` para não mexer na etapa do funil nem nos indicadores de tempo de resposta.';
comment on column chat_ligacao.canal is
  'Hoje sempre ''whatsapp''. O CHECK aceita ''tel'' como reserva para um eventual registro de '
  'ligação feita pelo celular; nada grava esse valor (decisão de 17/08/2026: ligação só no piloto).';
comment on column chat_ligacao.duracao_seg is
  'Tempo FALADO (atendida_em -> encerrada_em). Chamada não atendida tem duração nula, '
  'não zero — "ninguém atendeu" e "atendeu e desligou na hora" são resultados diferentes.';
comment on column chat_ligacao.sdp_remoto is
  'Último SDP da outra ponta ainda não consumido pelo navegador. Ponte entre o webhook '
  '(que recebe) e a aba com o microfone aberto (que precisa). Ver 0087 e §22.';

-- ---------------------------------------------------------------------------
-- Chamadas vivas — o que a tela procura ao abrir
-- ---------------------------------------------------------------------------
create or replace view vw_chat_ligacao_ativa as
select id, cliente_id, canal, direcao, status, call_id, linha_id,
       carteira, por, telefone, iniciada_em, atendida_em, sdp_tipo
from chat_ligacao
where status in ('discando', 'tocando', 'em_curso')
  -- rede de segurança: chamada que ficou pendurada (webhook de término perdido)
  -- não fica "viva" para sempre entupindo a tela de todo mundo
  and iniciada_em > now() - interval '2 hours';

-- ---------------------------------------------------------------------------
-- Realtime: a campainha
--
-- Trigger de LINHA (não de statement como o board da 0069): aqui as escritas são
-- uma de cada vez — uma ligação por vez, por definição — então não existe o
-- problema de lote de 500 que motivou o statement trigger lá.
--
-- O payload NÃO leva `cliente_id`. O canal é público (mesma razão do `board`,
-- §15.4: o chat autentica por cookie próprio, não por Supabase Auth, então não
-- há JWT para validar canal privado) e `cliente_id` pode ser `wa:<telefone>` —
-- ou seja, PII. Vai só o `call_id`, que é um id opaco da Meta. Quem escuta
-- descobre "a chamada X mudou para tocando" e mais nada; para saber DE QUEM é e
-- pegar o SDP, o navegador chama /api/chat/ligacao/estado, que autoriza no
-- servidor como todo o resto.
--
-- Falha aqui nunca derruba a escrita: o corpo inteiro está sob `exception when
-- others`, igual à 0069. Sem Realtime a ligação ainda é registrada; o que se
-- perde é a campainha instantânea.
-- ---------------------------------------------------------------------------
create or replace function public.trg_ligacao_notificar()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'realtime', 'extensions'
as $$
begin
  -- só avisa quando há novidade de verdade: status mudou, ou chegou SDP novo
  if tg_op = 'UPDATE'
     and new.status = old.status
     and new.sdp_remoto is not distinct from old.sdp_remoto then
    return null;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'call_id',  new.call_id,
      'id',       new.id,
      'status',   new.status,
      'direcao',  new.direcao,
      'canal',    new.canal,
      'carteira', new.carteira,   -- slug de vendedor: funcional, não é dado de cliente (§15.5)
      'em',       now()
    ),
    'sinal',      -- event
    'ligacao',    -- topic
    false         -- private => canal público (ver nota acima)
  );
  return null;
exception when others then
  raise warning 'trg_ligacao_notificar falhou (ignorado): %', sqlerrm;
  return null;
end;
$$;

revoke execute on function public.trg_ligacao_notificar() from public, anon, authenticated;

drop trigger if exists ligacao_notificar on chat_ligacao;
create trigger ligacao_notificar
  after insert or update on chat_ligacao
  for each row execute function public.trg_ligacao_notificar();

-- `atualizada_em` sempre honesto, sem depender de a rota lembrar de setar
create or replace function public.trg_ligacao_touch()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.atualizada_em := now();
  return new;
end;
$$;

revoke execute on function public.trg_ligacao_touch() from public, anon, authenticated;

drop trigger if exists ligacao_touch on chat_ligacao;
create trigger ligacao_touch
  before update on chat_ligacao
  for each row execute function public.trg_ligacao_touch();
