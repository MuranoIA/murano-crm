-- =============================================================================
-- 0117 — pedido de atualização cadastral: o recado que o CRM não pode entregar
--
-- Origem (28/08/2026): cliente antiga aparecia como contato novo porque
-- **trocou de número**. O cadastro do WinThor tem o telefone velho; a conversa
-- corre no novo. O vínculo casa por CPF, então nada liga os dois sozinho.
--
-- ⚠️ POR QUE ISTO É UMA FILA E NÃO UMA ESCRITA NO ERP
--
-- A pergunta natural foi "e se o consultor atualizasse o WinThor daqui?".
-- Medido antes de responder: `murano-clientes-v2` **não é o WinThor** — é um
-- espelho reescrito de minuto em minuto. O `sync_log` de lá mostra duas cargas
-- completas dos 8.651 clientes com 72 segundos de diferença, e todo
-- `updated_at` cai numa janela de 3 segundos. Uma escrita nossa ali:
--
--   1. não chegaria ao WinThor (o fluxo é WinThor -> espelho, nunca o inverso);
--   2. seria apagada em ~1 minuto pela carga seguinte;
--   3. e no intervalo mostraria "atualizado" na tela — o pior dos três.
--
-- Então o CRM faz o que alcança (liga o contato ao cliente por CPF) e REGISTRA
-- o que não alcança, em vez de fingir que resolveu. Mesmo princípio da §36: um
-- registro que o sistema não consegue tratar não pode simplesmente sumir.
-- =============================================================================

create table if not exists cadastro_atualizacao (
  id            bigserial primary key,
  cliente_id    text        not null,
  codcli        integer     not null,
  campo         text        not null default 'telefone',
  valor_atual   text,                    -- o que está no WinThor hoje
  valor_novo    text        not null,    -- o que a conversa mostra
  -- 'cpf_confirmado' = a cliente mandou o CPF e ele bateu com o cadastro;
  -- 'consultor'      = alguém clicou em "é a mesma pessoa".
  origem        text        not null,
  por           text,
  criada_em     timestamptz not null default now(),
  -- 'pendente' -> 'aplicado' (alguém digitou no ERP) | 'descartado' (era engano)
  status        text        not null default 'pendente',
  tratado_por   text,
  tratado_em    timestamptz,
  observacao    text,
  constraint cadastro_atualizacao_status_ck
    check (status in ('pendente', 'aplicado', 'descartado')),
  constraint cadastro_atualizacao_origem_ck
    check (origem in ('cpf_confirmado', 'consultor'))
);

-- Um pedido PENDENTE por cliente+campo. Sem isto, cada mensagem da cliente com
-- o CPF geraria uma linha nova, e quem cuida do cadastro receberia a mesma
-- correção dez vezes. Já tratado não bloqueia: se o número mudar outra vez, o
-- pedido novo entra.
create unique index if not exists idx_cad_atualiz_pendente
  on cadastro_atualizacao (cliente_id, campo) where status = 'pendente';

create index if not exists idx_cad_atualiz_status on cadastro_atualizacao (status, criada_em desc);

alter table cadastro_atualizacao enable row level security;  -- sem policy: só service_role

comment on table cadastro_atualizacao is
  'Correcoes de cadastro que o CRM detectou e NAO pode aplicar: o murano-clientes-v2 e '
  'espelho do WinThor, reescrito a cada minuto (0117). A fila e para quem edita o ERP.';
