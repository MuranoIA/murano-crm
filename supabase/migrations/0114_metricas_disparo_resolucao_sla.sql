-- =============================================================================
-- 0114 — as quatro métricas que faltavam no checklist (§54, itens 1 a 4)
--
--   1. taxa de resposta pós-disparo        -> vw_disparo_desfecho
--   4. entregue/lido/falhou por campanha   -> vw_disparo_desfecho (a mesma)
--   2. tempo médio de resolução            -> chat_resolucao + vw_chat_resolucao
--   3. alerta de estouro de SLA            -> vw_chat_espera
--
-- Os itens 1 e 4 saem da MESMA view de propósito: as duas perguntas são sobre o
-- mesmo evento — um template que saiu. Separá-las criaria duas contagens do
-- mesmo disparo, que divergem no primeiro ajuste de janela e ninguém saberia
-- qual está certa.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1 + 4 — o desfecho de cada template disparado
--
-- Duas coisas acontecem depois de um disparo, e elas NÃO são a mesma:
--
--   entrega   a Meta aceitou? chegou? foi lida? falhou por quê?
--   resposta  a cliente falou depois?
--
-- Um template pode ser entregue e lido e não gerar resposta nenhuma — é
-- exatamente esse par que diz se o texto presta. Hoje o admin aprova sugestão
-- de template (0110) no olho, sem nada que separe "não chegou" de "chegou e
-- não interessou".
--
-- A entrega vem de um join por `id`, e isso só funciona porque o ramo Cloud do
-- send-template grava o MESMO wamid nas duas tabelas (§16.3). No RD os ids
-- também batem quando o painel devolve um; quando não devolve, o disparo cai no
-- fallback e o join não acha — a linha aparece com entrega nula, que é honesto:
-- nós de fato não sabemos.
--
-- O `id` fica exposto porque é ele que distingue o canal: wamid = saiu pelo
-- nosso número. É como a rota recorta o RD sem precisar de coluna nova.
-- ---------------------------------------------------------------------------
create or replace view vw_disparo_desfecho as
select
  d.id,
  d.cliente_id,
  d.template_id,
  d.vendedor,
  d.criada_em,
  (d.criada_em at time zone 'America/Sao_Paulo')::date            as dia,
  -- entrega (item 4)
  m.status                                                        as entrega,
  m.erro                                                          as erro,
  -- resposta (item 1)
  r.criada_em                                                     as respondida_em,
  case when r.criada_em is not null
       then round((extract(epoch from (r.criada_em - d.criada_em)) / 3600.0)::numeric, 2)
  end                                                             as horas_ate_resposta
from disparos_template d
left join mensagens m on m.id = d.id
left join lateral (
  select mm.criada_em
  from mensagens mm
  where mm.cliente_id = d.cliente_id
    and mm.enviada_por = 'customer'
    and mm.tipo <> 'evento_sistema'
    and mm.criada_em > d.criada_em
  order by mm.criada_em
  limit 1
) r on true;

comment on view vw_disparo_desfecho is
  'Uma linha por template disparado: entrega (join por id com mensagens) e primeira '
  'resposta da cliente depois dele. Serve aos itens 1 (taxa de resposta) e 4 '
  '(entregue/lido/falhou) do checklist. id comecando com wamid = saiu pelo nosso numero.';

-- ---------------------------------------------------------------------------
-- 2 — tempo de resolução
--
-- `chat_conversa` guarda o ESTADO, não a história: é upsert por cliente, então
-- reabrir apaga a resolução anterior. Contar sobre ela daria uma média que
-- encolhe sozinha conforme as conversas reabrem — o pior tipo de métrica, a que
-- melhora quando a operação piora.
--
-- Por isso tabela append-only, mesma razão de `chat_transferencia` (§18).
--
-- `aberta_em` é DERIVADO no momento de resolver: a primeira mensagem da cliente
-- depois da resolução anterior (ou a primeira de todas). Não é uma coluna nova
-- em `chat_conversa` porque o webhook reabre com upsert parcial e não teria como
-- decidir, sem uma leitura a mais, se a conversa já estava aberta.
--
-- A métrica começa a acumular AGORA. Em 27/08 havia 11 conversas com status e
-- ZERO resolvidas — não há histórico a recuperar, e a tela precisa dizer isso em
-- vez de mostrar um zero que parece resultado.
-- ---------------------------------------------------------------------------
create table if not exists chat_resolucao (
  id           bigserial primary key,
  cliente_id   text        not null,
  vendedor     text,
  aberta_em    timestamptz,
  resolvida_em timestamptz not null default now(),
  motivo       text,
  por          text
);

create index if not exists idx_chat_resol_cliente on chat_resolucao (cliente_id);
create index if not exists idx_chat_resol_em      on chat_resolucao (resolvida_em);

alter table chat_resolucao enable row level security;   -- sem policy: só service_role

create or replace view vw_chat_resolucao as
select
  vendedor,
  (resolvida_em at time zone 'America/Sao_Paulo')::date  as dia,
  motivo,
  count(*)                                              as resolvidas,
  -- CONTAGENS, não percentuais: somar percentual diário daria peso igual a um
  -- dia de 3 e a um de 300 (§21.1)
  count(*) filter (where aberta_em is not null)         as com_tempo,
  count(*) filter (where aberta_em is not null
                     and resolvida_em - aberta_em <= interval '1 hour')   as ate_1h,
  count(*) filter (where aberta_em is not null
                     and resolvida_em - aberta_em <= interval '24 hours') as ate_24h,
  round((percentile_cont(0.5) within group (
    order by extract(epoch from (resolvida_em - aberta_em)) / 60.0
  ) filter (where aberta_em is not null))::numeric, 1)   as mediana_min,
  round((percentile_cont(0.9) within group (
    order by extract(epoch from (resolvida_em - aberta_em)) / 60.0
  ) filter (where aberta_em is not null))::numeric, 1)   as p90_min
from chat_resolucao
group by 1, 2, 3;

comment on view vw_chat_resolucao is
  'Tempo de resolucao por vendedor/dia/motivo, sobre a tabela append-only. Traz '
  'CONTAGENS para o resumo por periodo ser somavel; a mediana do periodo NAO se '
  'deriva das diarias (mesma regra da vw_chat_tempo_resposta).';

-- ---------------------------------------------------------------------------
-- 3 — quem está esperando AGORA
--
-- Os indicadores (0084) medem o tempo de resposta depois do fato. Isto é o
-- contrário: a fila do momento, para alguém agir antes de a espera virar
-- estatística.
--
-- Três decisões que evitam alarme mentiroso:
--
-- 1. A resposta automática NÃO cala o alarme. `tipo='auto'` é o robô de fora do
--    horário (0085): a cliente recebeu um recado e continua esperando gente. Se
--    ele contasse como resposta, ligar o aviso de ausência zeraria a fila de
--    espera — melhorar o número piorando o atendimento.
-- 2. Corte de 24h, como no tempo de resposta: acima disso a janela do WhatsApp
--    fechou e o caso é reengajamento por template, não demora.
-- 3. Respeita `linhas_visiveis`, igual à `vw_funil_visivel` (0099): com o RD
--    escondido, conversa de lá não acende alarme para ninguém.
-- ---------------------------------------------------------------------------
create or replace view vw_chat_espera as
with sel as (
  select coalesce(
           (select c.linhas_visiveis from crm_config c where c.id = 1),
           (select array_agg(l.phone_number_id) from chat_linha l where l.ativo)
         ) as linhas
),
ult as (
  select distinct on (m.cliente_id)
    m.cliente_id,
    m.vendedor_carteira as vendedor,
    m.enviada_por,
    m.criada_em
  from mensagens m, sel
  where m.tipo not in ('evento_sistema', 'auto')
    and (sel.linhas is null or coalesce(m.linha_id, 'rd') = any (sel.linhas))
  order by m.cliente_id, m.criada_em desc
)
select
  u.cliente_id,
  c.nome_completo                                                as cliente,
  u.vendedor,
  u.criada_em                                                    as esperando_desde,
  round((extract(epoch from (now() - u.criada_em)) / 60.0)::numeric, 1) as minutos
from ult u
left join clientes c on c.id = u.cliente_id
where u.enviada_por = 'customer'
  and now() - u.criada_em < interval '24 hours';

comment on view vw_chat_espera is
  'Conversas esperando resposta AGORA (ultima mensagem e da cliente, dentro da janela '
  'de 24h). Ignora tipo auto: o robo de fora do horario nao encerra a espera. Respeita '
  'crm_config.linhas_visiveis.';

-- limite de espera que acende o alarme; 0 = desligado
alter table crm_config add column if not exists sla_minutos int not null default 0;

comment on column crm_config.sla_minutos is
  'Minutos de espera que acendem o alerta de SLA no chat. 0 = desligado. Nasce em 0 de '
  'proposito: escolher o limite e decisao de quem opera, e um numero chutado no deploy '
  'viraria alarme que todo mundo aprende a ignorar.';
