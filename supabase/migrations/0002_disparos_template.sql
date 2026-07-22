-- =============================================================================
-- Log próprio dos disparos de template via API (botão "Recontactar" / automático).
-- Necessário porque o endpoint /v3/messages/template/send NÃO cria atendimento
-- e NÃO aparece no histórico — então contamos por clique/registro nosso.
-- =============================================================================
create table if not exists disparos_template (
  id            text primary key,          -- data.id retornado pela API RD
  cliente_id    text,
  telefone      text,
  vendedor      text,                       -- carteira (dono do card)
  operator_id   text,
  template_id   text,
  status        text,
  criada_em     timestamptz not null default now()
);
create index if not exists idx_disp_vendedor on disparos_template (vendedor);
create index if not exists idx_disp_criada   on disparos_template (criada_em);

-- templates automáticos disparados por vendedor por dia (fuso Brasília)
create or replace view vw_templates_auto_diario as
select
  vendedor,
  (criada_em at time zone 'America/Sao_Paulo')::date as dia,
  count(*) as templates_automaticos
from disparos_template
group by 1, 2;

-- acesso do backend (service_role) — necessário pois desativamos "expose new tables"
grant all privileges on table disparos_template to service_role;
grant select on vw_templates_auto_diario to service_role;
