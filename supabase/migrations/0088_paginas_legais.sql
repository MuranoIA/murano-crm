-- =============================================================================
-- 0088 · Páginas legais — política de privacidade e termos de uso
--
-- POR QUE ISTO EXISTE: a Meta exige URL de política de privacidade e de termos
-- para tirar o app do modo Desenvolvimento (§16.6). O texto dessas páginas é
-- estável e revisável — mora no código, versionado. O que MUDA (razão social,
-- CNPJ, endereço, e-mail do encarregado, prazo de retenção) mora aqui, para o
-- admin corrigir sem deploy. Mesma filosofia de `carteira_config`, `chat_linha`
-- e `chat_horario_atendimento` (§14.1).
--
-- A separação não é preciosismo: quem sabe o CNPJ correto é o financeiro, não
-- quem faz deploy. Se o dado exigisse commit, ficaria errado por meses.
--
-- LINHA ÚNICA (id = 1), pelo mesmo motivo da 0085: um insert distraído criaria
-- uma segunda configuração que as páginas nunca leriam (elas filtram id=1), e a
-- pessoa editaria uma tela que não muda nada no site.
--
-- Campos nascem VAZIOS de propósito. Página pública OMITE linha vazia em vez de
-- imprimir "CNPJ: —" para a Meta e para o cliente ler. A cobrança do que falta
-- é feita no /admin, onde só nós vemos.
-- =============================================================================
create table if not exists paginas_legais (
  id                int primary key default 1 check (id = 1),

  -- identificação da empresa
  nome_fantasia     text not null default 'Murano Professional',
  razao_social      text not null default '',
  cnpj              text not null default '',

  -- endereço (o "controlador" precisa ter endereço declarado — LGPD art. 41)
  endereco          text not null default '',
  cidade_uf         text not null default '',
  cep               text not null default '',

  -- canais de contato
  telefone          text not null default '',
  whatsapp          text not null default '',   -- o número do canal de atendimento
  email_contato     text not null default '',

  -- encarregado pelo tratamento de dados (LGPD art. 41) — pode ser pessoa ou setor
  encarregado       text not null default '',
  email_privacidade text not null default '',

  -- por quanto tempo guardamos conversa e histórico depois do último contato
  retencao_meses    int  not null default 60 check (retencao_meses between 1 and 240),

  -- data que aparece como "vigente desde" no rodapé das duas páginas
  vigencia          date not null default current_date,

  atualizado_em     timestamptz not null default now(),
  atualizado_por    text
);

alter table paginas_legais enable row level security;

insert into paginas_legais (id) values (1) on conflict (id) do nothing;

comment on table paginas_legais is
  'Variáveis das páginas públicas /privacidade e /termos (linha única, id=1). O TEXTO '
  'mora no código; aqui ficam só os dados que mudam sem deploy: razão social, CNPJ, '
  'endereço, contatos, encarregado, retenção e data de vigência. Editado em /admin → '
  'aba Páginas legais. Lido pelas páginas com service_role (RLS ligado, sem policy).';
