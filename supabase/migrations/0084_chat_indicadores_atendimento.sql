-- =============================================================================
-- 0084 · Chat P2 — indicadores de atendimento (equivalentes ao TME/TMA do RD)
-- (JÁ APLICADA no murano-conversas em 16/08/2026)
--
-- Os dados já estavam todos em `mensagens`: isto é leitura organizada, sem
-- coluna nova e sem escrita em lugar nenhum.
--
-- DEFINIÇÃO DE "ESPERA": par (mensagem do cliente -> próxima mensagem do
-- operador) na mesma conversa. Só conta quando a ANTERIOR foi do cliente —
-- assim uma rajada de 5 mensagens dele vira UMA espera, não cinco. Sem isso o
-- denominador infla e a métrica vira ficção.
--
-- CORTE DE 24h: acima disso não é demora de atendimento, é reengajamento — a
-- janela do WhatsApp fechou e a conversa só volta por template. Sem o corte, a
-- média explode e a métrica perde sentido operacional.
--
-- CONTAGENS, NÃO PERCENTUAIS: `ate_5min`/`ate_30min` são contagens porque somar
-- percentuais diários daria peso igual a um dia de 3 respostas e a um de 300.
-- A tela calcula sum(ate_5min)/sum(respostas) e acerta.
--
-- A MEDIANA DO PERÍODO NÃO SE DERIVA DAS DIÁRIAS. A tela rotula o resumo como
-- "mediana típica do dia" em vez de fingir precisão que o dado não sustenta.
-- Medido em 16/08/2026 (30 dias): mediana 2,1 min contra média 36,5 min — a
-- média é dominada por poucas esperas muito longas, por isso a tela lidera pela
-- mediana e mostra também p90 e as faixas.
-- =============================================================================
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
  where m.tipo <> 'evento_sistema'
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
  'responde), uma por rajada de mensagens. Corte de 24h separa demora de atendimento de '
  'reengajamento por template. Traz CONTAGENS (ate_5min/ate_30min) para o resumo por '
  'período ser calculado corretamente. Mediana do período NAO se deriva das diárias.';

-- ---------------------------------------------------------------------------
-- Volume por vendedor/dia — o outro lado do indicador
-- ---------------------------------------------------------------------------
create or replace view vw_chat_volume_diario as
select
  vendedor_carteira                                     as vendedor,
  (criada_em at time zone 'America/Sao_Paulo')::date     as dia,
  count(*) filter (where enviada_por = 'customer')       as recebidas,
  count(*) filter (where enviada_por = 'operator')       as enviadas,
  count(distinct cliente_id)                             as conversas
from mensagens
where tipo <> 'evento_sistema'
group by 1, 2;
