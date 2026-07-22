-- =============================================================================
-- rd-conversas-etl · Schema inicial (Fase 2) — VERSÃO ENXUTA (free tier / 500 MB)
-- Tabelas de ENTIDADE (ids/campos p/ joins) + MENSAGENS (dado perecível).
-- NOTA: a coluna `raw jsonb` (rede de segurança) foi ADIADA para quando migrarmos
-- para um projeto pago — ela é o que mais ocupa espaço. Enquanto isso, se faltar
-- algum campo, re-extraímos da API. Ver migration futura 0002_add_raw.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- VENDEDORES  (fonte: GET /v2/employees + GET /v1/employees/{id})
-- ---------------------------------------------------------------------------
create table if not exists vendedores (
  id              text primary key,           -- employee._id da API
  nome            text,
  email           text,
  role            text,                        -- do /v1/employees/{id}
  departamento    text,                        -- do /v1/employees/{id}
  sincronizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CLIENTES  (fonte: customer de GET /v4/reports; complemento /v2/contacts/{phone}/exists)
-- ---------------------------------------------------------------------------
create table if not exists clientes (
  id              text primary key,           -- customer._id da API
  nome_completo   text,
  telefone        text,
  cpf             text,
  email           text,
  carteira        text,                       -- dono: tag "carteira <nome>" (pode ser null)
  employee_id     text references vendedores(id),  -- vendedor responsável (campo `employee` do contato)
  canal           text,
  tags            jsonb,                       -- tags cruas (pequeno; mantido p/ auditar carteira)
  sincronizado_em timestamptz not null default now()
);
create index if not exists idx_clientes_carteira on clientes (carteira);
create index if not exists idx_clientes_telefone on clientes (telefone);
create index if not exists idx_clientes_employee on clientes (employee_id);

-- ---------------------------------------------------------------------------
-- ATENDIMENTOS  (protocolos; fonte: GET /v4/reports)
-- ---------------------------------------------------------------------------
create table if not exists atendimentos (
  id              text primary key,           -- report.id
  protocolo       text,
  cliente_id      text references clientes(id),
  vendedor_id     text references vendedores(id),  -- quem ATENDEU (pode ≠ dono da carteira)
  canal           text,
  tabulacao       text,                       -- to_tabulation (ex: 'venda_realizada')
  departamento    text,                       -- to_department
  total_enviadas  integer,                    -- total_send_messages
  total_recebidas integer,                    -- total_receive_messages
  aberto          boolean,                    -- opened
  fechado         boolean,                    -- closed
  criado_em       timestamptz,                -- created_at
  aberto_em       timestamptz,                -- opened_at
  fechado_em      timestamptz,                -- closed_at
  iniciado_em     timestamptz,                -- started_at
  finalizado_em   timestamptz,                -- finished_at
  sincronizado_em timestamptz not null default now()
);
create index if not exists idx_atend_cliente   on atendimentos (cliente_id);
create index if not exists idx_atend_vendedor  on atendimentos (vendedor_id);
create index if not exists idx_atend_tabulacao on atendimentos (tabulacao);
create index if not exists idx_atend_criado    on atendimentos (criado_em);

-- ---------------------------------------------------------------------------
-- MENSAGENS  (fonte: GET /v2/messages/history, decriptado)
-- PK = hash determinístico (cliente_id | criada_em | conteudo) => UPSERT idempotente
-- (a API não fornece id de mensagem).
-- ---------------------------------------------------------------------------
create table if not exists mensagens (
  id                text primary key,         -- sha1(cliente_id | created_at | conteudo)
  cliente_id        text references clientes(id),
  vendedor_carteira text,                     -- atribuição pela carteira do cliente (desnormalizado)
  enviada_por       text,                     -- 'operator' | 'customer' | 'bot'
  tipo              text,                     -- 'mensagem' | 'template' | 'evento_sistema'
  conteudo          text,
  is_reply          boolean,
  status            text,                     -- success | read | wait | checked
  criada_em         timestamptz,              -- created_at (UTC)
  sincronizado_em   timestamptz not null default now()
);
create index if not exists idx_msg_cliente  on mensagens (cliente_id);
create index if not exists idx_msg_carteira on mensagens (vendedor_carteira);
create index if not exists idx_msg_tipo     on mensagens (tipo);
create index if not exists idx_msg_criada   on mensagens (criada_em);

-- =============================================================================
-- VIEWS DE MÉTRICAS  (as perguntas viram consulta instantânea)
-- Regras de negócio embutidas: exclui evento de sistema; atribui por carteira;
-- "dia" no fuso de Brasília.
-- =============================================================================

create or replace view vw_contato_diario as
select
  vendedor_carteira                                              as vendedor,
  (criada_em at time zone 'America/Sao_Paulo')::date             as dia,
  count(distinct cliente_id) filter
    (where enviada_por = 'operator' and tipo <> 'evento_sistema') as clientes_contatados,
  count(distinct cliente_id) filter
    (where enviada_por = 'customer')                              as clientes_responderam
from mensagens
group by 1, 2;

create or replace view vw_templates_diario as
select
  vendedor_carteira                                   as vendedor,
  (criada_em at time zone 'America/Sao_Paulo')::date  as dia,
  count(*)                                            as templates_enviados
from mensagens
where tipo = 'template' and enviada_por = 'operator'
group by 1, 2;

create or replace view vw_vendas_diario as
select
  c.carteira                                            as vendedor,
  (a.criado_em at time zone 'America/Sao_Paulo')::date  as dia,
  count(*)                                              as vendas
from atendimentos a
join clientes c on c.id = a.cliente_id
where a.tabulacao = 'venda_realizada'
group by 1, 2;

-- ---------------------------------------------------------------------------
-- VIEW DO FUNIL (Kanban): etapa DERIVADA da conversa (não é estado mutável)
--   pedido_emitido   : tem '*PEDIDO FATURADO*' do operador
--   negociacao       : cliente respondeu
--   tentativa_contato: vendedor mandou msg real, cliente ainda não respondeu
-- ---------------------------------------------------------------------------
-- pedido_emitido (venda ganha) = QUALQUER um dos dois sinais:
--   (a) texto '*PEDIDO FATURADO*' do operador, OU
--   (b) algum atendimento do cliente tabulado como 'venda_realizada'
create or replace view vw_funil as
select
  c.id                          as cliente_id,
  c.nome_completo               as cliente,
  c.carteira                    as vendedor,
  max(m.criada_em) filter (where m.tipo <> 'evento_sistema')                       as ultima_atividade,
  (array_agg(m.conteudo order by m.criada_em desc)
     filter (where m.tipo <> 'evento_sistema'))[1]                                 as ultima_mensagem,
  (array_agg(m.enviada_por order by m.criada_em desc)
     filter (where m.tipo <> 'evento_sistema'))[1]                                 as ultima_enviada_por,
  case
    when bool_or(m.enviada_por = 'operator' and m.conteudo ilike '%*pedido faturado*%')
      or exists (select 1 from atendimentos a
                 where a.cliente_id = c.id and a.tabulacao = 'venda_realizada')
      then 'pedido_emitido'
    when bool_or(m.enviada_por = 'customer')
      then 'negociacao'
    else 'tentativa_contato'
  end                           as etapa
from clientes c
join mensagens m on m.cliente_id = c.id
where exists (
  select 1 from mensagens x
  where x.cliente_id = c.id and x.enviada_por = 'operator' and x.tipo <> 'evento_sistema'
)
group by 1, 2, 3;
