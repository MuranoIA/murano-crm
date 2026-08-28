-- =============================================================================
-- 0119 · Consulta livre para o assistente de campanha (EXPERIMENTAL).
--
-- Os filtros estruturados da 0118 cobrem as 11 familias do documento de
-- segmentacao. Sobra o caso raro: a pergunta que ninguem previu. Esta migration
-- da ao assistente uma segunda ferramenta -- SQL de leitura -- para esse caso.
--
-- ---------------------------------------------------------------------------
-- A REGRA QUE TORNA ISTO ACEITAVEL: a consulta NAO vira publico.
--
-- Ela produz um CONJUNTO DE codcli, guardado em `crm_conjunto`. Esse conjunto
-- entra no motor (`lib/publicoDisparo.ts`) como mais um filtro, e o publico sai
-- da peneira de sempre -- com anti-repeticao, lixeira, numero que nao recebe,
-- dedup e cota. Sem isso, a consulta livre seria um atalho por fora de todas as
-- travas, no caminho mais caro do sistema.
--
-- ---------------------------------------------------------------------------
-- TRES TRAVAS, E A PRIMEIRA E A QUE VALE
--
-- 1. **Transacao somente-leitura.** `set local transaction_read_only = on`
--    antes do `execute`. Testado: um CREATE TABLE depois disso falha com
--    "cannot execute CREATE TABLE in a read-only transaction". Esta e a
--    garantia de verdade -- as outras duas sao cinto e suspensorio.
-- 2. **Lista branca de objetos.** Todo identificador depois de FROM/JOIN tem de
--    estar em `crm_consulta_objetos` (ou ser um CTE da propria consulta). Lista
--    BRANCA, nao negra: lista negra protege so o que alguem lembrou de listar, e
--    qualquer tabela nova nasceria desprotegida (mesmo argumento da §20.3).
-- 3. **Uma consulta por vez, com teto e cronometro.** Sem `;`, LIMIT imposto por
--    fora, `statement_timeout` de 8s.
--
-- ⚠️ `mensagens` e `clientes` ficam DE FORA da lista branca de proposito. O
-- assistente nao ve nome, telefone nem conteudo de conversa (§ do chat), e
-- abrir essas duas por uma ferramenta de conveniencia desfaria isso.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) O que a consulta livre pode ler
-- ---------------------------------------------------------------------------
create table if not exists crm_consulta_objetos (
  objeto text primary key,
  nota   text
);
alter table crm_consulta_objetos enable row level security;

insert into crm_consulta_objetos (objeto, nota) values
  ('wth_carteira',          'carteira oficial do WinThor: codcli, cpf, nome, telefone, cidade, estado, rca_num, rca_nome'),
  ('wth_endereco',          'cidade, bairro, endereco, cep por codcli'),
  ('wth_itens',             'item a item das notas: codprod, produto, quantidade, vlr_item, departamento, secao, marca'),
  ('wth_faturamento',       'notas: data_fat, valor, tipo (VENDA/DEV), posicao, codfilial'),
  ('wth_vendas_bi',         'pedidos: vlr_atendido, nome_usuario (quem lancou), posicao, data_emissao'),
  ('wth_ciclo',             'motor preditivo: ciclo_medio, pct_ciclo, tendencia, tipo_oportunidade, score_urgencia, ramo. ATENCAO: cobre so ~13% da base'),
  ('wth_catalogo',          'produtos: codprod, produto, marca, secao, preco_tabela'),
  ('wth_descartados',       'lixeira -- quem NAO deve ser abordado'),
  ('wth_vinculo',           'ponte codcli <-> cliente_id do CRM'),
  ('vw_cliente_item',       'o que cada cliente compra por dimensao (secao/departamento/marca/produto)'),
  ('vw_cliente_financeiro', 'ticket, receita liquida, pedidos, recencia e devolucao por cliente'),
  ('vw_cliente_compras',    'historico de compra por contato'),
  ('vw_pedido_bi_card',     'quem comprou em cada janela de periodo'),
  ('vw_venda_card',         'etapa de venda por cliente (pedido emitido / vender novamente)'),
  ('vw_ciclo_card',         'o card do ciclo de compra'),
  ('vw_fila_prospeccao',    'carteira sem atendimento no CRM'),
  ('disparos_template',     'historico de templates disparados pelo CRM'),
  ('carteira_config',       'vendedores: slug, rca_num, time'),
  ('crm_conjunto',          'conjuntos de codcli ja produzidos por consultas anteriores')
on conflict (objeto) do update set nota = excluded.nota;

-- ---------------------------------------------------------------------------
-- 2) Onde o resultado de uma consulta vira publico
--
-- Guardar o conjunto aqui, em vez de devolver a lista de codcli para o modelo,
-- e o que impede a conversa de estourar: uma consulta pode devolver milhares de
-- clientes, e mandar isso de volta pelo historico a cada turno custa contexto e
-- perde precisao. O modelo recebe o ID e a contagem.
-- ---------------------------------------------------------------------------
create table if not exists crm_conjunto (
  id         text primary key,
  criado_em  timestamptz not null default now(),
  criado_por text,
  consulta   text,
  codclis    integer[] not null
);
alter table crm_conjunto enable row level security;
create index if not exists idx_crm_conjunto_criado on crm_conjunto (criado_em desc);

comment on table crm_conjunto is
  'Conjuntos de codcli vindos da consulta livre do assistente (0119). Descartaveis: '
  'servem so entre a pergunta e o disparo. Limpar o que passar de 7 dias e seguro.';

-- ---------------------------------------------------------------------------
-- 3) A funcao
-- ---------------------------------------------------------------------------
create or replace function crm_consulta_leitura(p_sql text, p_limite integer default 500)
returns jsonb
language plpgsql
security invoker
set statement_timeout = '8s'
as $fn$
declare
  q      text;
  norm   text;
  alvo   text;
  ctes   text[] := array[]::text[];
  m      text[];
  saida  jsonb;
begin
  q := btrim(coalesce(p_sql, ''));
  q := regexp_replace(q, ';\s*$', '');

  if q = '' then raise exception 'consulta vazia'; end if;
  if q ~ ';' then raise exception 'uma consulta por vez (sem ponto e virgula no meio)'; end if;

  -- ⚠️ NORMALIZAR ANTES DE CHECAR. A primeira versao extraia o identificador do
  -- texto cru, e por isso `from "mensagens"` e `from /*x*/ mensagens` NAO
  -- casavam com o regex -- e o que nao casa nao era checado. Falha ABERTA:
  -- medido em 28/08, as duas devolveram linhas de `mensagens`.
  norm := regexp_replace(q,   '/\*.*?\*/', ' ', 'gs');   -- comentario de bloco
  norm := regexp_replace(norm, '--[^' || chr(10) || ']*', ' ', 'g');   -- comentario de linha
  norm := replace(norm, '"', '');                          -- identificador entre aspas
  norm := regexp_replace(norm, '\s+', ' ', 'g');

  if norm !~* '^\s*(select|with)\s' then
    raise exception 'so SELECT: a consulta precisa comecar com SELECT ou WITH';
  end if;

  select array_agg(lower(x[1])) into ctes
  from regexp_matches(norm, '(?:with|,)\s+([a-z_][a-z0-9_]*)\s+as\s*\(', 'gi') x;
  ctes := coalesce(ctes, array[]::text[]);

  -- O walk e FECHADO: cada FROM/JOIN precisa ser seguido de "(" (subquery, cujo
  -- interior este mesmo laco tambem visita) ou de um identificador liberado.
  -- Qualquer outra coisa e recusada, em vez de ignorada.
  --
  -- ⚠️ FLAG `i` OBRIGATORIA. Sem ela, `SELECT * FROM MENSAGENS` em maiusculas
  -- nao casava com \mfrom\M e passava batido -- medido em 28/08.
  for m in
    select x from regexp_matches(
      norm,
      '(?:\mfrom\M|\mjoin\M)\s*(?:\mlateral\M\s*|\monly\M\s*)?(\(|[a-zA-Z_][a-zA-Z0-9_.]*|\S)',
      'gi'
    ) x
  loop
    alvo := m[1];
    continue when alvo = '(';
    if alvo !~ '^[a-zA-Z_][a-zA-Z0-9_.]*$' then
      raise exception 'nao entendi o que vem depois de FROM/JOIN ("%") -- reescreva a consulta de forma simples', alvo;
    end if;
    alvo := lower(alvo);
    if position('.' in alvo) > 0 then
      alvo := split_part(alvo, '.', array_length(string_to_array(alvo, '.'), 1));
    end if;
    if not (alvo = any(ctes)) and not exists (select 1 from crm_consulta_objetos o where o.objeto = alvo) then
      raise exception 'objeto "%" nao esta liberado para consulta. Use: %',
        alvo, (select string_agg(objeto, ', ' order by objeto) from crm_consulta_objetos);
    end if;
  end loop;

  -- A trava que vale: depois desta linha nada escreve, aconteca o que acontecer
  -- com as checagens de texto acima. Testado: CREATE TABLE aqui falha com
  -- "cannot execute CREATE TABLE in a read-only transaction".
  set local transaction_read_only = on;

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) _q limit %s) t',
    q, greatest(1, least(coalesce(p_limite, 500), 5000))
  ) into saida;

  return saida;
end
$fn$;

comment on function crm_consulta_leitura(text, integer) is
  'SELECT de leitura sobre a lista branca crm_consulta_objetos, em transacao read-only (0119). '
  'Usada pelo assistente de campanha; o resultado nao vira publico sozinho -- vira conjunto de codcli '
  'que ainda passa pela peneira do disparo.';

revoke all on function crm_consulta_leitura(text, integer) from public, anon, authenticated;
