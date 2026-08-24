-- =============================================================================
-- 0097 · Interruptores do CRM — o primeiro deles: o motor de ciclo de compra.
--
-- Contexto (24/08/2026): o mecanismo de ciclo de compra vai passar por revisão.
-- Enquanto isso, ele precisa poder ser DESLIGADO sem deploy e RELIGADO do mesmo
-- jeito — decisão do usuário. Filosofia de sempre (§14.1): configuração em
-- TABELA, não em código; e, principalmente, o caminho de volta é um UPDATE.
--
-- Tabela GENÉRICA de propósito, não `ciclo_config`. Já existem outros dois
-- interruptores no radar (fonte do board: conversas × carteira do ERP; e quais
-- conversas ficam visíveis). Cada um vira UMA COLUNA aqui, não uma tabela nova
-- — mesmo formato de `paginas_legais` (linha única, várias colunas).
--
-- ---------------------------------------------------------------------------
-- NASCE LIGADO (true), e isso é deliberado.
--
-- O ciclo está em uso hoje: aparece no selo do card, no filtro "Ciclo compra"
-- do board, no painel do contato no chat, no ranqueamento do disparo em massa e
-- em colunas do Excel. Nascer desligado faria um DEPLOY mudar a tela de sete
-- pessoas por efeito colateral — exatamente o que a 0095 evita. Desligar é
-- decisão de um admin, na tela do /admin, com nome e hora registrados.
--
-- ---------------------------------------------------------------------------
-- O QUE "DESLIGAR O CICLO" SIGNIFICA — a fronteira é por CAMPO, não por tabela.
--
-- `wth_ciclo` carrega duas coisas muito diferentes na mesma linha:
--
--   MOTOR PREDITIVO (o que está em revisão, e o que este interruptor desliga):
--     tipo_oportunidade · score_urgencia · pct_ciclo · acao_recomendada
--     tendencia · ciclo_medio · ciclo_desvio · n_intervalos
--
--   FATO BRUTO DO ERP (continua valendo com o interruptor desligado):
--     dias_ausente · ultima_compra · ticket_medio · total_pedidos · rec_total · ramo
--
-- Confundir os dois seria caro: o Excel do /api/relatorio tira `ticket_medio` e
-- `total_pedidos` de `wth_ciclo`, e ninguém pediu para desligar ticket médio.
-- Por isso NÃO se desliga "a leitura de wth_ciclo" — desligam-se os campos
-- derivados. O filtro "Tempo parado" do board também sobrevive: ele conta dias
-- de inatividade, não usa o motor.
--
-- Nada é apagado. `wth_ciclo` continua sendo populada pelo `wth-sync-tudo` a
-- cada 10 min — religar mostra o dado atual, não um buraco.
-- =============================================================================

create table if not exists crm_config (
  id             int primary key default 1 check (id = 1),   -- linha única
  ciclo_ativo    boolean not null default true,
  atualizado_por text,
  atualizado_em  timestamptz not null default now()
);

-- RLS ligado sem policy: anon e authenticated não leem linha nenhuma;
-- service_role e o dono passam porque ignoram RLS. Mesmo padrão de `wth_*`,
-- `chat_layout` e das 10 tabelas fechadas em 03/08 (§12.5).
alter table crm_config enable row level security;

insert into crm_config (id) values (1) on conflict (id) do nothing;

grant select on crm_config to service_role;

comment on table crm_config is
  'Interruptores globais do CRM (linha única, id=1). Uma coluna por mecanismo. '
  'Nascem no estado que já valia, para nenhum deploy mudar a tela por efeito colateral.';

comment on column crm_config.ciclo_ativo is
  'Motor de ciclo de compra ligado? false esconde tipo_oportunidade, score_urgencia, '
  'pct_ciclo, acao_recomendada, tendencia e ciclo_medio no board, no chat, no disparo '
  'em massa e no Excel — e poupa a consulta a vw_ciclo_card. Fato bruto do ERP '
  '(dias sem comprar, ticket médio, total de pedidos) NÃO é afetado.';
