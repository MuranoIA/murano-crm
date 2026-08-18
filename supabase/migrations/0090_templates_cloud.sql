-- =============================================================================
-- 0090 · Criar template do WhatsApp por dentro do sistema
--
-- O QUE FALTAVA: `crm_templates` guardava só `nome` + `rd_template_id` — um
-- PONTEIRO para um template que vive no RD Conversas. O texto nunca esteve
-- conosco, e não havia como criar um: a API do RD não tem endpoint de template
-- (404 em nove variantes, §2), então lá isso só existe no painel deles.
--
-- Com a linha piloto na Cloud API o cadastro é NOSSO: a Meta aceita criar
-- template por API (`POST /<WABA_ID>/message_templates`), com o texto e, se
-- quisermos, uma imagem de cabeçalho. Estas colunas guardam esse cadastro.
--
-- CONVIVÊNCIA, não substituição: as linhas antigas continuam com canal='rd' e
-- seguem funcionando pelo fluxo do RD. As novas nascem canal='cloud'. É a mesma
-- regra dos dois números (§23): o sistema opera os dois ao mesmo tempo, de
-- propósito, até a Fase C.
--
-- POR QUE `status` NASCE NULO: para linha do RD ele é desconhecido — nós nunca
-- soubemos se aquele template está aprovado, pausado ou removido lá. Preencher
-- com 'aprovado' seria inventar. Só a linha da Cloud tem status de verdade,
-- porque vem da Meta.
-- =============================================================================
alter table crm_templates
  add column if not exists canal           text not null default 'rd'
    check (canal in ('rd', 'cloud')),
  -- nome humano continua em `nome`; a Meta exige um identificador próprio,
  -- minúsculo com underline, imutável depois de criado
  add column if not exists meta_nome       text,
  add column if not exists meta_id         text,
  add column if not exists idioma          text not null default 'pt_BR',
  add column if not exists categoria       text not null default 'MARKETING'
    check (categoria in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  -- o texto que faltava
  add column if not exists corpo           text,
  add column if not exists rodape          text,
  -- cabeçalho: 'nenhum' | 'texto' | 'imagem'
  add column if not exists cabecalho_tipo  text not null default 'nenhum'
    check (cabecalho_tipo in ('nenhum', 'texto', 'imagem')),
  add column if not exists cabecalho_texto text,
  -- caminho da imagem no bucket privado `wa-midia` (o mesmo da mídia do chat).
  -- A Meta baixa a imagem NO MOMENTO DO ENVIO, então guardamos o arquivo e
  -- geramos URL assinada a cada disparo — link fixo público seria vazamento.
  add column if not exists imagem_path     text,
  -- se o corpo usa {{1}} (o primeiro nome do cliente). O envio precisa saber:
  -- mandar parâmetro para template sem variável é erro 132000 na Meta, e o
  -- contrário também — por isso é coluna, não adivinhação na hora do envio.
  add column if not exists usa_nome        boolean not null default false,
  add column if not exists status          text,
  add column if not exists motivo_recusa   text,
  add column if not exists criado_por      text,
  add column if not exists atualizado_em   timestamptz not null default now();

comment on column crm_templates.canal is
  'rd = ponteiro para template do RD Conversas (só nome + rd_template_id, texto fora daqui). '
  'cloud = template criado por nós na Meta, com corpo e cabeçalho guardados aqui.';
comment on column crm_templates.status is
  'Status na Meta (PENDING/APPROVED/REJECTED/PAUSED/DISABLED). NULO para canal=rd: nunca '
  'soubemos o status daqueles — preencher seria inventar.';
comment on column crm_templates.imagem_path is
  'Caminho no bucket privado wa-midia. A Meta baixa a imagem no envio, via URL assinada '
  'gerada na hora; nunca por link público fixo.';

-- o nome na Meta é único por conta; aqui evita duas linhas apontando para o mesmo cadastro
create unique index if not exists crm_templates_meta_nome_uq
  on crm_templates (meta_nome) where meta_nome is not null;
