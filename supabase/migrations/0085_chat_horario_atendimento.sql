-- =============================================================================
-- 0085 · Chat P2 — mensagem automática fora do horário
-- (JÁ APLICADA no murano-conversas em 16/08/2026)
--
-- Substitui o que o chatbot externo fazia (o "Suri" que tiramos do caminho da
-- linha piloto): avisar a cliente que ninguém vai responder agora, em vez de
-- deixá-la no vácuo de madrugada.
--
-- NASCE DESLIGADA (`ativo = false`) de propósito: isto envia mensagem para
-- cliente real. Ligar é decisão do usuário, não efeito colateral de um deploy.
--
-- Configuração em tabela, não em código — mesma filosofia de `carteira_config`
-- e `chat_linha` (§14.1): mudar horário ou texto é um UPDATE, sem deploy.
--
-- Feriados NÃO são tratados: num feriado o dia da semana é útil, então o aviso
-- não dispara. Se incomodar, acrescentar uma lista de datas depois.
-- =============================================================================
create table if not exists chat_horario_atendimento (
  id             int primary key default 1 check (id = 1),   -- linha única
  ativo          boolean     not null default false,
  inicio         time        not null default '08:00',
  fim            time        not null default '18:00',
  -- dias em que HÁ atendimento. Convenção do Postgres: 0=domingo … 6=sábado
  dias_semana    int[]       not null default '{1,2,3,4,5}',
  mensagem       text        not null default
    'Olá! Recebemos sua mensagem 💜 Nosso atendimento é de segunda a sexta, das 8h às 18h. Assim que abrirmos, um consultor responde por aqui.',
  -- anti-spam: não repete o aviso para o mesmo cliente dentro desta janela
  intervalo_horas int        not null default 12,
  atualizado_em  timestamptz not null default now()
);
alter table chat_horario_atendimento enable row level security;

insert into chat_horario_atendimento (id) values (1) on conflict (id) do nothing;

comment on table chat_horario_atendimento is
  'Configuração da resposta automática fora do horário (linha única, id=1). Nasce '
  'DESLIGADA: ligar envia mensagem a cliente real. Horário em America/Belem. '
  'dias_semana usa a convenção do Postgres: 0=domingo … 6=sábado.';

-- ---------------------------------------------------------------------------
-- A resposta automática é gravada em `mensagens` com tipo = 'auto'.
--
-- POR QUE UM TIPO PRÓPRIO: ela aparece na conversa (o vendedor precisa ver o que
-- foi dito em seu nome), mas NÃO pode contar como resposta dele no indicador de
-- tempo — senão um robô respondendo em 2 segundos de madrugada faria o TME do
-- time parecer excelente, e a métrica criada na 0084 viraria ficção na primeira
-- semana. A view abaixo passa a excluí-la.
-- ---------------------------------------------------------------------------
drop view if exists vw_chat_tempo_resposta;

create view vw_chat_tempo_resposta as
with ordenadas as (
  select
    m.cliente_id,
    m.vendedor_carteira,
    m.enviada_por,
    m.criada_em,
    lag(m.enviada_por) over (partition by m.cliente_id order by m.criada_em) as ant_quem,
    lag(m.criada_em)   over (partition by m.cliente_id order by m.criada_em) as ant_em
  from mensagens m
  where m.tipo not in ('evento_sistema', 'auto')   -- 'auto' = resposta do robô
),
esperas as (
  select
    vendedor_carteira                                          as vendedor,
    (criada_em at time zone 'America/Sao_Paulo')::date          as dia,
    extract(epoch from (criada_em - ant_em)) / 60.0             as espera_min
  from ordenadas
  where enviada_por = 'operator'
    and ant_quem    = 'customer'
    and criada_em - ant_em < interval '24 hours'
)
select
  vendedor,
  dia,
  count(*)                                                                    as respostas,
  count(*) filter (where espera_min <= 5)                                     as ate_5min,
  count(*) filter (where espera_min <= 30)                                    as ate_30min,
  round((percentile_cont(0.5) within group (order by espera_min))::numeric, 1) as mediana_min,
  round(avg(espera_min)::numeric, 1)                                          as media_min,
  round((percentile_cont(0.9) within group (order by espera_min))::numeric, 1) as p90_min
from esperas
group by 1, 2;

comment on view vw_chat_tempo_resposta is
  'Tempo de primeira resposta por vendedor/dia. Espera = par (cliente fala -> operador '
  'responde), uma por rajada. Corte de 24h separa demora de reengajamento por template. '
  'EXCLUI tipo=auto (resposta automática fora do horário): robô não é atendimento. '
  'Traz contagens para o resumo do período; mediana do período NAO se deriva das diárias.';
