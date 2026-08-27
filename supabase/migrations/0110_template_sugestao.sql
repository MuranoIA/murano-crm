-- =============================================================================
-- 0110 · Template sugerido pelo consultor, avaliado pelo administrador.
--
-- Pedido do usuario (27/08/2026): *"a experiencia do consultor deve ser a mesma
-- de criar um template, a diferenca e que ele nao chega a etapa de deixar para
-- a meta analisar mas em semelhanca a isso o template dele fica para o
-- administrador analisar"*.
--
-- ---------------------------------------------------------------------------
-- ⚠️ TABELA PROPRIA, E NAO UMA COLUNA `status` EM `crm_templates`
--
-- Tentador, e errado. `crm_templates.status` guarda o veredito da META
-- (APPROVED / PENDING / REJECTED), reconsultado a cada abertura da tela do
-- admin (§24.3). Uma sugestao com `status='PENDENTE_ADMIN'` seria sobrescrita
-- pela primeira sincronizacao -- ou, pior, um template que a Meta ainda nao
-- conhece apareceria na lista de escolha do envio e falharia com 132001 na
-- cara da cliente.
--
-- Sao dois vereditos diferentes, em sequencia:
--
--     consultor escreve -> ADMIN avalia -> (se aprovar) META avalia -> envio
--     `template_sugestao`                  `crm_templates`
--
-- Aprovar aqui NAO cria nada na Meta. Cria a intencao: o admin aprova, e a
-- criacao continua sendo o gesto dele na tela de Templates, com o formulario
-- ja preenchido. Aprovar e submeter num clique so misturaria a decisao
-- ("este texto presta") com a acao irreversivel (nome bloqueado por 30 dias
-- na Meta se apagado depois, §24.4).
--
-- ---------------------------------------------------------------------------
-- O QUE O CONSULTOR *NAO* ESCOLHE
--
-- `meta_nome` (o identificador aprovado na Meta) e `idioma` ficam de fora de
-- proposito: sao decisao de quem publica, tem regra de formato e nao podem ser
-- corrigidos depois. O consultor escreve o que sabe escrever -- o texto.
-- =============================================================================

create table if not exists template_sugestao (
  id            bigint generated always as identity primary key,
  -- quem sugeriu. `carteira` e o slug do vendedor (a mesma chave do cookie de
  -- sessao e de carteira_config); nulo quando um admin rascunha para si.
  carteira      text,
  autor_email   text,

  nome          text not null,
  corpo         text not null,
  cabecalho_tipo text,                       -- 'texto' | 'imagem' | null
  cabecalho_texto text,
  imagem_path   text,                        -- objeto no bucket wa-midia
  rodape        text,
  justificativa text,                        -- por que este template ajuda a vender

  -- veredito do ADMIN, nao da Meta
  status        text not null default 'pendente'
                check (status in ('pendente','aprovado','recusado')),
  motivo        text,                        -- obrigatorio na recusa (a rota cobra)
  avaliado_por  text,
  avaliado_em   timestamptz,
  -- preenchido quando o admin efetivamente cria na Meta a partir desta sugestao
  publicado_id  bigint references crm_templates(id) on delete set null,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table template_sugestao is
  'Template escrito pelo CONSULTOR, esperando o veredito do ADMIN (0110). Nao e o '
  'cadastro da Meta -- esse continua sendo crm_templates. Aprovar aqui nao publica: '
  'cria a intencao, e a publicacao segue sendo um gesto do admin na tela de Templates.';

comment on column template_sugestao.status is
  'pendente | aprovado | recusado -- veredito do ADMIN. Nao confundir com '
  'crm_templates.status, que e o da META e e reconsultado a cada abertura da tela.';

alter table template_sugestao enable row level security;
-- Sem policy: anon e authenticated nao leem linha nenhuma. O app usa
-- service_role nas rotas e faz o escopo por carteira la, como no resto do chat.

create index if not exists idx_sugestao_pendente
  on template_sugestao (criado_em desc) where status = 'pendente';
create index if not exists idx_sugestao_carteira
  on template_sugestao (carteira, criado_em desc);
