-- =============================================================================
-- 0147 · Campanha: distribuir em rodízio quem responder ao template
--
-- Caso de uso que gerou o pedido (dono, 29/09/2026): uma carteira ficou vaga,
-- centenas de clientes sem atendimento. Dispara-se um template para eles; à
-- medida que respondem, caem na fila de espera e alguém precisa transferir UM
-- POR UM, à mão, conforme vão chegando.
--
-- O que esta migration cria é o mecanismo que falta: a campanha guarda uma lista
-- ordenada de atendentes e um ponteiro, e cada resposta pega o próximo da lista,
-- dando a volta no fim. O disparo em si continua onde já está (Administração ›
-- Templates), porque ele já existe, já tem prévia, anti-repetição e custo — e o
-- laço de envio precisa rodar na aba aberta, já que a cota do WhatsApp não cabe
-- no tempo de uma rota (§26.2).
--
-- ---------------------------------------------------------------------------
-- TRÊS DECISÕES QUE O CÓDIGO SOZINHO NÃO TOMARIA (registradas no painel)
--
-- 1. NÃO TIRA CONVERSA DE QUEM JÁ É DONO. Distribui só quem está sem dono
--    efetivo, ou cujo dono é uma das carteiras de origem da campanha — que é a
--    carteira vaga do caso de uso. Quem já foi pego por alguém na fila fica com
--    quem pegou, e a linha registra o motivo. Sem isso, a campanha arrancaria
--    conversas da mão de quem estava atendendo, em silêncio.
--
-- 2. JANELA DE RESPOSTA (7 dias, por cliente, contados do envio DELE). Sem
--    prazo, uma mensagem qualquer meses depois seria lida como resposta ao
--    template e mandaria a cliente para outro atendente.
--
-- 3. UMA RESPOSTA SÓ CONTA UMA VEZ. A cliente manda três mensagens seguidas; a
--    primeira distribui, as outras não mexem em nada. É `respondeu_em is null`
--    que garante — e o `for update` abaixo, que serializa duas respostas
--    simultâneas para não darem o mesmo atendente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A campanha
-- ---------------------------------------------------------------------------
create table if not exists campanha (
  id            bigint generated always as identity primary key,
  nome          text not null,
  criada_em     timestamptz not null default now(),
  criada_por    text,

  -- de qual disparo ela nasce. Não é uma FK: `disparos_template` é um log por
  -- cliente, sem id de lote. O recorte é template + janela de tempo, que é
  -- exatamente como a pessoa descreve o disparo ("o de hoje às 14h").
  template_id   text,
  template_nome text,
  disparo_de    timestamptz not null,
  disparo_ate   timestamptz not null,

  -- carteiras de origem: servem ao relatório E à regra 1 acima
  carteiras     text[] not null default '{}',

  -- a fila do rodízio, EM ORDEM. Slug de carteira ou `u:<email>` — os mesmos
  -- dois tipos de endereço que a transferência aceita (§chatEscopo).
  atendentes    text[] not null,
  -- o ponteiro. Guardado na linha, e não calculado por `count(distribuídos) %
  -- n`: com o cálculo, apagar uma linha da tabela mudaria a vez de todo mundo.
  proximo       int not null default 0,

  janela_dias   int not null default 7,
  ativa         boolean not null default true,
  encerrada_em  timestamptz,

  constraint campanha_atendentes_nao_vazio check (cardinality(atendentes) > 0),
  constraint campanha_janela_valida check (janela_dias between 1 and 90)
);

comment on table campanha is
  'Distribuicao em rodizio de quem responde a um disparo de template. O disparo '
  'em si vive em disparos_template; a campanha e a lista ordenada de atendentes '
  'e o ponteiro que gira a cada resposta.';

-- ---------------------------------------------------------------------------
-- Os alvos — e é esta tabela que vira a planilha que o dono pediu
-- ---------------------------------------------------------------------------
create table if not exists campanha_alvo (
  campanha_id     bigint not null references campanha(id) on delete cascade,
  cliente_id      text   not null,

  -- foto do cadastro NO MOMENTO da campanha. Guardada, e não lida por join na
  -- hora de mostrar: a graça da planilha é dizer "de quem ERA", e a carteira do
  -- cliente muda — inclusive por causa desta campanha.
  nome            text,
  codcli          integer,
  rca             integer,
  carteira_origem text,

  enviado_em      timestamptz,
  respondeu_em    timestamptz,
  atendente       text,
  distribuido_em  timestamptz,
  -- por que NÃO foi distribuído, quando não foi (ex.: já tinha dono)
  motivo          text,

  primary key (campanha_id, cliente_id)
);

comment on table campanha_alvo is
  'Uma linha por cliente do disparo. E a planilha da campanha: nome, codigo, '
  'rca, carteira de origem, envio, resposta e para quem foi distribuido.';

-- A pergunta quente do webhook: "este cliente é alvo pendente de alguma
-- campanha ativa?". Parcial porque a esmagadora maioria das linhas já respondeu
-- ou nunca vai responder.
create index if not exists idx_campanha_alvo_pendente
  on campanha_alvo (cliente_id)
  where respondeu_em is null;

create index if not exists idx_campanha_alvo_campanha
  on campanha_alvo (campanha_id, distribuido_em desc);

alter table campanha        enable row level security;
alter table campanha_alvo   enable row level security;

-- ---------------------------------------------------------------------------
-- A distribuição
--
-- Roda como uma coisa só, chamada pelo webhook. Em SQL, e não em TypeScript,
-- por causa do `for update`: duas clientes respondendo no mesmo segundo
-- receberiam o MESMO atendente se o ponteiro fosse lido e escrito em duas idas
-- ao banco. É o tipo de erro que aparece como "por que a Tatiana levou três
-- seguidas?" e não deixa rastro nenhum.
--
-- Devolve NULL quando não há nada a fazer — que é o caso da esmagadora maioria
-- das mensagens que entram.
-- ---------------------------------------------------------------------------
create or replace function campanha_distribuir(p_cliente_id text)
returns table (campanha_id bigint, atendente text, nome_campanha text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_camp    campanha%rowtype;
  v_alvo    campanha_alvo%rowtype;
  v_dono    text;
  v_quem    text;
  v_n       int;
begin
  -- o alvo pendente mais ANTIGO: se o cliente entrou em duas campanhas, a
  -- primeira tem a vez. Ordem determinística evita que duas execuções
  -- simultâneas escolham campanhas diferentes para o mesmo cliente.
  select a.* into v_alvo
    from campanha_alvo a
    join campanha c on c.id = a.campanha_id
   where a.cliente_id = p_cliente_id
     and a.respondeu_em is null
     and c.ativa
     and a.enviado_em is not null
     and now() <= a.enviado_em + make_interval(days => c.janela_dias)
   order by a.campanha_id
   limit 1;

  if not found then
    return;
  end if;

  -- ⚠️ TRAVA A CAMPANHA ANTES de ler o ponteiro. Sem isto o rodízio repete.
  select * into v_camp from campanha where id = v_alvo.campanha_id for update;
  if not found or not v_camp.ativa then
    return;
  end if;

  -- Regra 1: não tirar conversa de quem já é dono. O dono efetivo é a última
  -- transferência; sem transferência, a carteira do cliente.
  select coalesce(
           (select t.para_carteira from chat_transferencia t
             where t.cliente_id = p_cliente_id
             order by t.criada_em desc, t.id desc limit 1),
           (select cl.carteira from clientes cl where cl.id = p_cliente_id))
    into v_dono;

  if v_dono is not null and not (v_dono = any (v_camp.carteiras)) then
    -- marca como respondida para não ficar pendente para sempre, e diz por quê
    update campanha_alvo
       set respondeu_em = now(),
           motivo = 'já tinha dono (' || v_dono || ') — não foi distribuído'
     where campanha_id = v_alvo.campanha_id and cliente_id = p_cliente_id;
    return;
  end if;

  v_n := cardinality(v_camp.atendentes);
  v_quem := v_camp.atendentes[v_camp.proximo + 1];

  update campanha set proximo = (v_camp.proximo + 1) % v_n where id = v_camp.id;

  update campanha_alvo
     set respondeu_em = now(), atendente = v_quem, distribuido_em = now(), motivo = null
   where campanha_id = v_alvo.campanha_id and cliente_id = p_cliente_id;

  -- A atribuição é uma linha em `chat_transferencia`, como qualquer outra:
  -- append-only, e o dono efetivo passa a ser a última linha (§18). Assim o
  -- histórico mostra que foi a campanha que passou, e não uma pessoa.
  insert into chat_transferencia (cliente_id, de_carteira, para_carteira, por, observacao)
  values (p_cliente_id, v_dono, v_quem, 'campanha',
          'distribuição automática — campanha "' || v_camp.nome || '"');

  campanha_id := v_camp.id;
  atendente := v_quem;
  nome_campanha := v_camp.nome;
  return next;
end;
$$;

comment on function campanha_distribuir(text) is
  'Chamada pelo webhook quando uma mensagem da cliente entra. Se ela for alvo '
  'pendente de campanha ativa dentro da janela, pega o proximo atendente do '
  'rodizio e grava a transferencia. Devolve vazio quando nao ha o que fazer.';
