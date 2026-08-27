-- =============================================================================
-- 0109 · Ficha de cadastro do cliente novo, para depois copiar no WinThor.
--
-- Pedido do usuario (27/08/2026): *"o consultor pede os dados para o cliente no
-- chat, o cliente responde, o consultor copia e cola no formulario de cadastro
-- ao lado e entao salva. entao fica salvo e disponivel para depois salvar no
-- erp winthor"*. Mais: uma resposta rapida que envia a LISTA de dados pedida.
--
-- O que existia ate aqui: o "Salvar contato" gravava nome + CPF + telefone em
-- `clientes`. Servia para o vinculo nascer (§43.3) e nada mais -- na hora de
-- cadastrar no ERP, quem digita nao tem endereco, nao tem inscricao estadual,
-- nao tem nome fantasia. O consultor volta a perguntar, dias depois, coisas que
-- a cliente ja teria respondido se alguem tivesse perguntado de uma vez.
--
-- ---------------------------------------------------------------------------
-- ⚠️ A LISTA DE CAMPOS MORA NO BANCO, NAO NO CODIGO -- e isso e o centro
--
-- **Eu nao sei quais campos o WinThor exige.** O que temos aqui e
-- `wth_carteira`, que e uma PROJECAO de consulta com 8 colunas (codcli, cpf,
-- nome, telefone, cidade, estado, rca) -- nao a tela de cadastro do ERP, que
-- pede endereco completo, IE, fantasia e o resto.
--
-- Chutar essa lista no codigo seria o pior resultado possivel: o consultor
-- pediria a cliente um conjunto errado de dados, ela responderia, e na hora de
-- digitar no WinThor faltaria campo -- ou seja, perguntar duas vezes, que e
-- exatamente o problema que esta migration existe para acabar.
--
-- Entao a lista e configuracao (`crm_config.cadastro_campos`), editavel em
-- /admin por quem cadastra de verdade. Mesmo padrao de `paginas_legais` (§23.3)
-- e do `texto_pausa` (0106): quem sabe o dado certo e o financeiro, nao quem
-- faz deploy -- se exigisse commit, ficaria errado por meses.
--
-- O default abaixo e um chute honesto para cadastro PJ/PF de salao no Brasil.
-- Nasce como ponto de partida, nao como verdade.
--
-- ---------------------------------------------------------------------------
-- A MENSAGEM E O FORMULARIO SAO A MESMA LISTA
--
-- A resposta rapida que pede os dados a cliente e GERADA da lista de campos.
-- Se fossem dois textos independentes, divergiriam no primeiro ajuste -- o
-- consultor pediria 8 coisas e o formulario teria 10, e alguem perguntaria de
-- novo. Uma fonte, dois usos.
--
-- ---------------------------------------------------------------------------
-- POR QUE TABELA PROPRIA, E NAO COLUNAS EM `clientes`
--
-- `clientes` e espelho do que chega pelo ETL e pelo webhook. Colunas de
-- cadastro ali correriam o risco da §10.11, e misturariam "o que sabemos do
-- contato" com "o que a cliente nos ditou para digitar no ERP" -- que sao
-- coisas diferentes: a segunda e rascunho ate alguem digitar.
--
-- `dados` e jsonb pelo mesmo motivo da lista ser configuravel: acrescentar um
-- campo nao pode exigir migration, senao volta a depender de deploy.
-- =============================================================================

create table if not exists cadastro_cliente (
  cliente_id    text primary key references clientes(id) on delete cascade,
  dados         jsonb  not null default '{}'::jsonb,
  observacao    text,
  -- quando alguem efetivamente digitou no WinThor. Ate la a ficha e pendencia.
  copiado_em    timestamptz,
  copiado_por   text,
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table cadastro_cliente is
  'Ficha ditada pela cliente no chat, para o funcionario copiar no WinThor depois (0109). '
  'NAO e cadastro oficial: o cadastro oficial nasce no ERP e volta pelo espelho wth_carteira. '
  'Enquanto `copiado_em` for nulo, a ficha esta esperando alguem digitar.';

comment on column cadastro_cliente.dados is
  'Chave->valor conforme `crm_config.cadastro_campos`. jsonb, e nao colunas, para que '
  'acrescentar um campo seja configuracao e nao deploy.';

alter table cadastro_cliente enable row level security;
-- Sem policy: anon e authenticated nao leem linha nenhuma; service_role e o dono
-- passam porque ignoram RLS. Mesmo padrao das tabelas do §12.5 -- e aqui pesa
-- mais, porque a ficha guarda CPF e endereco de pessoa fisica.

create index if not exists idx_cadastro_pendente
  on cadastro_cliente (atualizado_em desc) where copiado_em is null;

-- ---------------------------------------------------------------------------
-- A lista de campos, como configuracao
--
-- `obrigatorio` marca o que trava o Salvar. Deixei poucos: uma ficha pela
-- metade, salva, vale mais que uma ficha perdida porque a cliente nao soube a
-- inscricao estadual na hora.
-- ---------------------------------------------------------------------------
alter table crm_config
  add column if not exists cadastro_campos jsonb not null default '[
    {"k":"tipo",        "rotulo":"Tipo",                 "ajuda":"CPF (pessoa fisica) ou CNPJ (empresa)"},
    {"k":"cpf_cnpj",    "rotulo":"CPF ou CNPJ",          "obrigatorio":true},
    {"k":"nome",        "rotulo":"Nome completo / Razao social", "obrigatorio":true},
    {"k":"fantasia",    "rotulo":"Nome do salao"},
    {"k":"ie",          "rotulo":"Inscricao estadual",   "ajuda":"ou ISENTO"},
    {"k":"telefone",    "rotulo":"Telefone",             "obrigatorio":true},
    {"k":"email",       "rotulo":"E-mail"},
    {"k":"cep",         "rotulo":"CEP"},
    {"k":"endereco",    "rotulo":"Rua / Avenida"},
    {"k":"numero",      "rotulo":"Numero"},
    {"k":"complemento", "rotulo":"Complemento"},
    {"k":"bairro",      "rotulo":"Bairro"},
    {"k":"cidade",      "rotulo":"Cidade"},
    {"k":"estado",      "rotulo":"Estado (UF)"}
  ]'::jsonb;

comment on column crm_config.cadastro_campos is
  'Campos da ficha de cadastro (0109). Editavel em /admin porque quem sabe o que o WinThor '
  'exige e quem cadastra, nao quem faz deploy. A mensagem que PEDE os dados a cliente e '
  'gerada desta mesma lista -- se fossem dois textos, divergiriam e alguem perguntaria duas vezes.';
