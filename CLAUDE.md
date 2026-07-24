# rd-conversas-etl — Brief do Projeto

> Destilado das sessões de exploração (jul/2026). Fonte de verdade portátil entre
> contas/máquinas — mora no git, ao contrário dos transcripts e da memória local.
> Só contém o que foi confirmado contra a conta real da API ou o código do repo.

## 1. Objetivo e estado atual

ETL em **Node.js + TypeScript** para extrair dados da API REST do **RD Station
Conversas (ex-Tallos)** e, na fase seguinte, carregá-los num **Supabase (Postgres)**
para relatórios/BI. A API é **pull** (você faz GET com token) — não é o RD que
empurra dados; portanto o que se constrói é um coletor que *puxa*, não um servidor
que recebe.

**Fases:**
- **Fase 0 — Exploração (CONCLUÍDA).** Descobrir o shape real dos dados antes de
  desenhar schema. Entregou: cliente HTTP autenticado (`src/lib/rdConversasClient.ts`),
  decriptador JWE robusto (`src/lib/decryptMessages.ts`), script de sondagem
  (`src/explore.ts`) que salva JSON bruto em `data/<timestamp>/` (fora do git).
- **Fase 1 — 4 métricas por vendedor (viável, validada ao vivo p/ o Romulo).**
  Ver seção 5. Hoje respondidas por scripts descartáveis `src/_tmp_*.ts` que batem
  na API ao vivo (lento: minutos por pergunta por causa de rate limit + decrypt).
- **Fase 2 — ETL Supabase (CONCLUÍDA e em produção).** Tabelas, job de UPSERT
  idempotente (`src/etl/run.ts`) e agendamento (GitHub Actions, cron 20min)
  rodando. Dashboard web (`web/`) publicado.
- **Fase 3 — Cruzamento com WinThor via `murano-clientes-v2` (CONCLUÍDA e em
  produção).** Ver seção 10 — módulo `wth_`, carteira oficial por CPF,
  `codcli` como chave pra faturamento real.

## 2. API RD Station Conversas (ex-Tallos)

- **Base URL:** `https://api.tallos.com.br` (env `RD_CONVERSAS_BASE_URL`).
- **Auth:** header `Authorization: Bearer <token>` (env `RD_CONVERSAS_TOKEN`).
  Token é um JWT que embute `employee` e `company` (company_id `69bba74471eb4ba5285fc2fb`).
- Token/API key gerado em `app.tallos.com.br` → **Apps e Integrações → API**.

### Endpoints que FUNCIONAM

| Endpoint | Serve para | Params |
|---|---|---|
| `GET /v2/employees` | Lista de vendedores/atendentes (id, nome, email, status) | — |
| `GET /v4/reports` | **Núcleo dos dados.** Protocolos de atendimento (ver campos abaixo) | `start_date`, `end_date`, `employee`, `page`, `limit` (**máx 49**); aceita `type=rejecteds` |
| `GET /v1/analytics/attendances/summary` | Agregado: total de atendimentos, TMA, TME | `start_date`, `end_date`, `timezone` |
| `GET /v1/analytics/attendances/retention` | Retenção + atendimentos por chatbot | `start_date`, `end_date`, `timezone` |
| `GET /v1/analytics/contacts/origin` | Contatos por origem/dia | `start_date`, `end_date`, `timezone` |
| `GET /v2/contacts/{phone}/exists` | Existência do contato + **última mensagem em TEXTO PURO** (`last_message_data`: data + conteúdo). **Não precisa decriptar** — contorna a rotação de chave | telefone na URL |
| `GET /v2/messages/history` | Histórico completo de mensagens; campo `messages` vem **criptografado (JWE)** — ver seção 3 | `customer_id`, `page`, `limit` |
| `GET /v1/campaigns` | Lista de campanhas (disparos de template em massa): `{campaigns[], has_more, total}` | `start_date`, `end_date` |
| `GET /v1/campaigns/{id}` | Detalhe: `template{id,type}`, `stats{success,read,error}`, `total_customers`, `segmentation.filters.wallets`. **⚠️ retorna 500 intermitente** — trate erro por item | id na URL |

**Campos úteis de cada `doc` em `/v4/reports`:** `id`, `protocol`, `customer`
(`{id, full_name, cel_phone, cpf, email, address_* , channel, current_wallet, tags[]}`),
`employee`, `channel`, `to_tabulation`, `to_department`, `total_send_messages`,
`total_receive_messages`, `tme`, `tma`, `closed` (bool), `opened_at`/`closed_at`,
`transferred`, `company_id`. Resposta paginada: `{docs[], pages, ...}`.

### Endpoints que NÃO existem (404 confirmado)

- **Templates:** `/v2/templates`, `/v4/templates`, `/v1/analytics/templates`,
  `/v1/analytics/messages/templates`, `/v2/messages/templates`,
  `/v2/messages/templates/sent`, `/v2/whatsapp/templates`, `/v4/reports/templates`.
- **Mensagens ativas / HSM:** `/v2/active-messages`, `/v2/active_messages`,
  `/v4/active-messages`, `/v2/messages/active`.
- **Analytics de mensagens:** `/v1/analytics/messages`,
  `/v1/analytics/messages/summary`, `/v1/analytics/attendances/messages`.
- **Sub-recursos de campanha:** `/v1/campaigns/{id}/stats|contacts|links|details|statistics`
  (os stats já vêm **dentro** de `/v1/campaigns/{id}`).
- **Campanhas em outras versões:** `/v2/campaigns`, `/v4/campaigns`, `/v1/analytics/campaigns`.
- **Contatos / carteiras:** `/v2/contacts` (lista), `/v4/contacts`, `/v2/contacts/{id}`,
  `/v1/wallets`, `/v2/wallets/{nome}`, `/v2/wallets/{nome}/contacts`,
  `/v2/employees/{id}/contacts`, `/v2/employees/{id}/wallet`, `/v1/segmentation/contacts`.
  → **Não existe endpoint para listar contatos por tag/carteira.**
- `/v1/analytics/attendances/reviews-average` — path da doc está incorreto; o
  `explore.ts` chama mas não gera arquivo (falha silenciosa). Não confirmado.
- **Webhooks: API não oferece (confirmado jul/2026).** Testado ao vivo contra a
  conta real: `/v1|v2|v4/webhooks`, `/webhook`, `/integrations/webhooks`,
  `/hooks`, `/callbacks`, `/events/subscriptions`, `/notifications/webhooks` —
  todos 404. O índice de docs do RD Station Developers (`developers.rdstation.com/llms.txt`)
  também confirma: webhooks só existem para RD Station Marketing/CRM (produto
  diferente, API em `api.rd.services`), não para Conversas. **Decisão de
  arquitetura:** o ETL tem que continuar pull agendado — não existe caminho
  para push em tempo real com esta API.

**Consequência estrutural:** a API só tem duas âncoras — `customer_id` (para puxar
histórico) e `employee` (só dentro de `/v4/reports`). Não há "buscar mensagens por
remetente/vendedor" nem "listar carteira de X". Para um cliente que não abriu
atendimento novo hoje, a única forma de achar as mensagens é já ter o `customer_id`
ou telefone. Isso é o argumento central para construir a base própria (Fase 2).

## 3. Criptografia das mensagens (JWE) e rotação de chave

- `/v2/messages/history` responde 200, mas `messages` é uma **string JWE
  RSA-OAEP-256** (`use: enc`). Recurso **exclusivo do plano Professional**.
- **Decriptação** (`src/lib/decryptMessages.ts`, lib `node-jose`) tem 3 armadilhas
  já resolvidas:
  1. Payload vem em **Latin-1 (ISO-8859-1)**, não UTF-8 (senão acentos viram U+FFFD).
  2. **JSON aninhado**: uma string que contém o JSON real — desembrulhar em loop
     até virar objeto/array.
  3. **JSON malformado**: mensagens de sistema trazem bytes de controle ASCII crus
     e templates usam aspas retas de conteúdo não escapadas — sanitizar antes do parse.
- **Campos de cada mensagem decriptada:** `sent_by` (`operator` / `customer` /
  `bot`), `content`, `created_at`, `status` (`success`/`wait`/`read`/`checked`),
  `is_template_message` (bool), `is_reply` (bool). **NÃO existe id do operador**
  (só "operator") nem id de mensagem individual — a atribuição por vendedor **não**
  sai da mensagem (ver seção 4).

### Rotação de chave (armadilha recorrente — regra de negócio)

- Cada mensagem carrega um `kid` (id da chave). Quando alguém clica **"Gerar Chave"**
  em Apps e Integrações → API, a chave **rotaciona (não acumula)** e a **privada é
  mostrada uma única vez**. Toda mensagem cifrada com a chave anterior fica
  **permanentemente ilegível** se a privada antiga não foi salva.
- Histórico de `kid` observado: `yrG-mJ7wW10g...` (antiga, privada perdida →
  ~217 conversas ilegíveis) → `ps3VO-fBc2Pa...` → `KBvX61L44r2U...` →
  `J8n2pHNryvSP...` (atual funcional em jul/2026).
- **Correção quando quebra:** peça a nova privada (JWK) e atualize
  **`RD_CONVERSAS_PRIVATE_JWK`** no `.env`. Confirme batendo o `kid` da chave nova
  com o `kid` das mensagens do dia.
- **REGRA DE NEGÓCIO:** combinar com o time para **ninguém mais clicar em "Gerar
  Chave"** — cada rotação destrói acesso ao histórico anterior.

## 4. Atribuição por vendedor (carteira)

- **A carteira do cliente vem numa tag `carteira <nome>`** dentro de `customer.tags`
  (ex.: `carteira romulo`, `carteira kamilly`) — **NÃO** no `report.employee`.
- `employee` no `/v4/reports` é só "quem atendeu aquele protocolo", que pode não ser
  o dono da carteira. Filtrar por `employee` **contamina**: p/ o Romulo, dos 423
  clientes retornados sob `employee=Romulo`, só **164** tinham `carteira romulo`; 107
  eram de outras carteiras e 152 sem tag de carteira.
- **Regra correta:** "trabalho do vendedor X" = clientes com a tag `carteira <x>`.
- Carteiras/vendedores conhecidos (via `GET /v2/wallets`): **Anne Cunto, Thamires
  Bastos, Thiago Melo, Henry Bouez, Milene Pamplona, Luana, Kamilly, Romulo**
  (Romulo `employee.id` = `6a3a97bbb94e6ad472ee9d02`).
- Há também `customer.current_wallet` (pode vir `null` ou nome). Para o schema,
  "carteira" (dono) e "quem atendeu" são colunas distintas — provavelmente ambas.

## 5. As 4 métricas por vendedor

Filtrar sempre pela **carteira (tag)**, não por `employee`. "Hoje" = fuso de
**Brasília (BRT, UTC-3)**, não UTC.

| # | Métrica | Como calcular | Custo |
|---|---|---|---|
| 1 | **Contactados** | clientes distintos com `total_send_messages > 0` em `/v4/reports` (equivale a msg `sent_by=operator`) | barato (1 varredura de reports) |
| 2 | **Responderam** | clientes distintos com `total_receive_messages > 0` (equivale a msg `sent_by=customer`) | barato |
| 3 | **Vendas** | `to_tabulation == 'venda_realizada'` em `/v4/reports` | barato |
| 4 | **Templates enviados** | msgs com `sent_by=operator` **e** `is_template_message=true`, nos clientes da carteira | **caro**: baixar+decriptar histórico de cada cliente, com pausa por rate limit (minutos) |

Templates também existem no **nível de campanha** (`/v1/campaigns/{id}.stats.success`),
mas campanhas são **broadcasts da conta, sem atribuição a vendedor** (só segmentação
por tag/carteira) — não servem para "templates enviados por X".

## 6. Tabulações

Categoria que o atendente escolhe **ao encerrar** o atendimento (motivo/resultado).
Configurável em **Configurações da Empresa → Tabulação** (RD Conversas web). Chega na
API no campo `to_tabulation` de `/v4/reports`.

**Valores observados:** `venda_realizada` (= venda fechada), `tentativa_de_ctt`,
`follow_up`, `erro`, `teste`.

- Historicamente vinha **vazio** (equipe não preenchia) — por isso boa parte das
  análises de venda exigiu *ler* a conversa. Alguns vendedores já começaram a usar.
- **Maior alavanca do projeto:** se a equipe preencher, "quantas vendas hoje" vira
  `COUNT(*) WHERE to_tabulation='venda_realizada'` — confiável, sem decriptar nem
  inferir por IA. Tabulação diz *que* fechou, não *o quê* nem *por quanto*.

## 7. Rate limiting (429)

- Rate limit **agressivo**. Chamadas de histórico têm de ser **sequenciais**, não
  paralelas.
- Padrão usado nos scripts: **~300 ms de pausa** entre chamadas + **retry com
  backoff** em 429 (`3000 * (tentativa+1)` ms, até ~8 tentativas). Alguns clientes
  ainda falham em lote grande (429 transitório) — os totais decriptados são um
  **piso**, re-checar os que falharam para cravar.
- `/v1/campaigns/{id}` pode dar **500 intermitente**: tolere erro por item, não
  derrube o loop inteiro.

## 8. Arquitetura pretendida do ETL (Fase 2) e decisões

- **Stack:** Node 18+ / TS, `@supabase/supabase-js`, `fetch` nativo, `dotenv`.
  Supabase gera REST automático sobre as tabelas.
- **Agendamento:** **GitHub Actions com cron** (preferido — grátis, roda `npm run`
  igual local, guarda secrets, dá logs; alinhado à preferência de evitar serviços
  24/7). Alternativa: Supabase Edge Functions + pg_cron (roda em Deno, mais atrito).
- **Padrão:** extract (pull, paginado) → transform → **load com UPSERT idempotente**
  (`onConflict` por `protocol`/`id`), rodável repetidamente sem duplicar.

**Decisões de modelagem a fechar ANTES de escrever schema:**
1. **Grão da tabela principal = MENSAGEM, não atendimento.** Cada mensagem vira uma
   linha com seu `created_at` → "hoje" é filtro de data direto, elimina a
   ambiguidade abertura vs. atividade.
2. **Sync por ATIVIDADE, não por abertura.** `/v4/reports` filtra por `created_at`
   (abertura) — uma conversa aberta há 10 dias e **fechada hoje** não aparece no
   filtro "hoje". Solução recomendada: **rastrear no Supabase os protocolos
   `closed:false` e re-checar só esses até fecharem** + incremental dos novos
   (alternativa mais cara: janela deslizante de 30–45 dias). Após fechar, o histórico
   não muda → nunca mais re-baixar.
3. **"Carteira" (dono) ≠ "quem atendeu" (employee)** — colunas separadas.
4. **`to_tabulation` vem vazio na prática** → decidir se "venda" será campo da
   tabulação, inferência por regra, ou classificação por LLM (ver abaixo).
5. **PII real** (cpf, telefone, endereço, email) — decidir acesso/criptografia das
   colunas agora.
6. **Flag `is_test`** (nossa, não vem da API) para filtrar contatos internos tipo
   "Rômulo Albuquerque | Murano Professional".

**Vendas fechadas — parte semântica:** SQL cru não sabe ler "Fechado, agradecemos
pela parceria" como venda. Se a tabulação não for adotada, o plano B é uma **passada
de classificação por LLM no job noturno** (grava `status`/`produto`/`valor`/
`mensagens_ate_fechar` como colunas), com **tela de correção manual**. Regra de
negócio afirmada pelo usuário: uma venda fechada envolve informar **produtos +
valores + valor total** e combinar entrega/pagamento.

**Pendências / TODOs:**
- Escrever o schema e o job de UPSERT (a Fase 2 em si).
- Confirmar formato de `is_template_message=true` num exemplo salvo (todos os
  exemplos gravados até agora eram `false`).
- Recuperar (se possível) chaves privadas antigas para o histórico já cifrado — ou
  aceitar a perda.

## 9. Convenções do repositório

- **Estrutura:** `src/lib/rdConversasClient.ts` (GET com Bearer, `RdConversasApiError`),
  `src/lib/decryptMessages.ts` (JWE + sanitização + Latin-1), `src/explore.ts`
  (Fase 0). Scripts `src/_tmp_*.ts` são **descartáveis** (análises ad-hoc), não fazem
  parte do produto. `data/` (respostas brutas por timestamp) é **ignorado pelo git**.
- **.env** (nunca commitado): `RD_CONVERSAS_TOKEN`, `RD_CONVERSAS_BASE_URL`
  (`https://api.tallos.com.br`), `RD_CONVERSAS_PRIVATE_JWK`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- **Scripts npm:** `npm run explore` (Fase 0), `npm run build` (tsc), `npm start`
  (`node dist/etl.js` — ainda não existe). Rodar `_tmp_*` via `npx ts-node src/...`.
- **Padrão "filtro barato antes da operação cara":** usar `last_message_data` (texto
  puro de `/v2/contacts/{phone}/exists`) para decidir se vale decriptar o histórico
  completo (caro, e pode falhar por chave antiga). Não usar como única fonte de
  verdade — auditar com a checagem completa de tempos em tempos.

## 10. Módulo WinThor (`wth_`) — cruzamento com murano-clientes-v2

> Handoff de outra sessão Claude (conta oficial Murano, com acesso direto ao
> `murano-clientes-v2`). Verificado ao vivo contra o `murano-conversas` em
> 23/07/2026 antes de entrar aqui — todos os objetos e números abaixo foram
> confirmados por consulta direta (`wth_carteira`, `wth_vinculo`, `wth_sync_log`,
> `vw_fila_prospeccao`, `vw_divergencia_carteira` existem e o `pg_cron` está
> rodando de fato, não é plano).

### 10.1 Regra permanente

O banco **`murano-clientes-v2` (`jjvbmqycgjgkwidgcmif`) é SOMENTE LEITURA.**
Nunca aplicar migration, DDL, insert, update ou delete nele. Nenhuma exceção.
Objetos novos vão sempre no **`murano-conversas` (`wtunzezigncwjpcqsfzk`)** —
o mesmo projeto Supabase que este repositório já usa (`SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY` no `.env`).

Nada foi alterado na v2 em nenhum momento — apenas `SELECT` e `EXPLAIN`.

### 10.2 Os dois bancos

| Projeto | Ref | Papel | Permissão |
|---|---|---|---|
| `murano-conversas` | `wtunzezigncwjpcqsfzk` | Destino do ETL do RD Conversas | leitura e escrita |
| `murano-clientes-v2` | `jjvbmqycgjgkwidgcmif` | ERP WinThor | **somente leitura** |

São projetos Supabase separados — não existe JOIN direto entre eles. A ponte é o módulo `wth_`.

### 10.3 Como identificar o vendedor de um contato

Campo canônico: **`clientes.carteira`** — slug minúsculo. Hoje: `kamilly`, `luana`, `romulo`.

Mesmo conceito, nome diferente por tabela:

| tabela | campo | formato |
|---|---|---|
| `clientes` | `carteira` | slug |
| `mensagens` | `vendedor_carteira` | slug |
| `disparos_template` | `vendedor` | slug |
| `atendimentos` | `vendedor_id` | ID → FK `vendedores.id` |

#### Armadilha 1 — `clientes.employee_id`

Parece a FK certa (1.626 de 1.627 casam com `vendedores.id`), **mas não é o dono da carteira.**
É o operador atribuído ou o último que mexeu no contato no painel. Concorda com a `carteira`
em apenas **58,9%** dos casos. Confirma e generaliza o que já tínhamos visto isolado no caso
do cliente Cleuson Madson (seção anterior desta sessão): `employee`/`employee_id` não é
confiável pra atribuição, `carteira` é.

Sintoma: Henry (departamento "Clientes Inativos") aparece como `employee_id` de 416 clientes
espalhados pelas três carteiras — cara de triagem ou automação. Agrupar por `employee_id` faz
a produtividade do ISR vazar para dentro dele.

O campo não está quebrado — significa outra coisa. **Não sobrescrever.**

#### Armadilha 2 — join por nome

`LEFT JOIN vendedores ON lower(v.nome) = c.carteira` **não escala.** Os nomes em `vendedores`
estão inconsistentes: `Atendente: Thamires Farias`, `Atendente -  Milene Pamplona` (espaço duplo),
`Atendente  Lais`. E primeiro nome colide — já existe um `Thiago`, e o RCA 29 é Thiago Melo,
cuja string no WinThor tem espaço sobrando no fim (`'29 - THIAGO MELO '`).

**Usar sempre `rca_num` (inteiro) como chave de vendedor.**

#### Armadilha 3 — atribuição de venda

`atendimentos.vendedor_id` e `clientes.carteira` divergem em **10,6%** dos atendimentos.
São conceitos diferentes: quem atendeu o ticket vs. de quem é a carteira. A `vw_vendas_diario`
atribui pela carteira. Se a régua de comissão for "quem fechou", precisa mudar para `a.vendedor_id`.

#### Armadilha 4 — `sincronizado_em` não é heartbeat

O ETL é incremental: só grava linha nova ou alterada. `max(sincronizado_em)` indica a última vez
que **algum registro mudou**, não a última vez que o job rodou. Intervalo grande ≠ ETL parado.

### 10.4 Escopo da tabela `clientes`

Contém **apenas contatos que tiveram atendimento**. Verificado: 1.627 de 1.627 têm ao menos um
atendimento vinculado, zero atendimentos órfãos.

Não é espelho da carteira. Cliente que nunca foi abordado não aparece — e isso está correto.
As RCAs 45/46/51 somam 2.611 clientes no WinThor contra ~1.630 contatos aqui. A diferença é
**fila de prospecção**, não buraco de dados. **Isso explica o caso da cliente Emanuelle de
Almeida** investigado nesta sessão: ela pode simplesmente nunca ter tido um atendimento com
protocolo gerado ainda — vale checar `vw_fila_prospeccao` antes de assumir bug do ETL.

### 10.5 Módulo `wth_` — aplicado e rodando

Objetos criados no `murano-conversas`:

| Objeto | Tipo | RLS |
|---|---|---|
| `wth_carteira` | tabela | ✅ |
| `wth_vinculo` | tabela | ✅ |
| `wth_sync_log` | tabela | ✅ |
| `wth_config` | tabela | ✅ |
| `wth_reconciliar_vinculos()` | função | — |
| `wth_sync_carteira_http()` | função | — |
| `vw_cliente_rca` | view | — |
| `vw_fila_prospeccao` | view | — |
| `vw_divergencia_carteira` | view | — |

Extensões: `postgres_fdw`, `http`, `pg_cron`.

#### Como a carga funciona

`wth_sync_carteira_http()` chama a **API REST da v2** com a service_role key guardada em
`wth_config`, pagina de mil em mil, e faz upsert em `wth_carteira`. Depois roda
`wth_reconciliar_vinculos()`, que casa CPF e preenche `wth_vinculo`.

Agendado no `pg_cron` a cada 30 minutos (`wth-sync-carteira`).

Primeira execução manual: **8.487 linhas, 1.433 vínculos, 959 ms.**
Primeira execução automática (23/07 22:30 Belém): **succeeded, 1,49 s.**

#### O job agendado — o que é e o que não é

`pg_cron` é um agendador que roda dentro do próprio Postgres. Não depende de máquina ligada
nem de servidor externo. A cada 30 minutos ele executa uma linha: `select wth_sync_carteira_http();`

Efeito prático: CPF cadastrado no painel vira vínculo com `codcli` e RCA oficial em até 30 min,
sem intervenção.

**Este job NÃO é o ETL do RD Conversas.** São coisas distintas e é fácil confundir:

| | o que traz | onde mora |
|---|---|---|
| `wth-sync-carteira` | carteira do WinThor → `wth_carteira` | dentro do banco (pg_cron) |
| ETL rd-conversas | contatos e conversas → `clientes` | repositório local |

Contato novo aparecer depende do **ETL**, não deste job. Este só enriquece quem já está no espelho.

#### Riscos conhecidos deste job

1. **Falha silenciosa.** Se a service_role key for rotacionada ou revogada, o job passa a falhar
   e ninguém é avisado — grava `status='erro'` em `wth_sync_log` e segue tentando. Os números
   param de atualizar sem aviso. Conferir `cron.job_run_details` periodicamente, ou montar alerta.
2. **Cliente apagado na v2 não some daqui.** A carga é upsert: atualiza e insere, nunca remove.
   Cliente excluído no WinThor fica parado em `wth_carteira` com `sincronizado_em` antigo.
3. **Logs crescem.** 48 execuções/dia, ~17 mil linhas/ano em `wth_sync_log` e em
   `cron.job_run_details`. Pouco, mas em algum momento vale limpar.

Trinta minutos é generoso para este job — a carteira do WinThor muda devagar. Uma vez por dia
resolveria. Para mudar:

```sql
select cron.unschedule('wth-sync-carteira');
select cron.schedule('wth-sync-carteira','0 6 * * *', $$ select wth_sync_carteira_http(); $$);
```

#### Caminho alternativo (FDW) — montado mas inativo

`postgres_fdw`, server `v2_winthor`, schema `v2`, foreign table `v2.clientes` e a função
`wth_sync_carteira()` existem e estão intactos. Falta só o **user mapping**, que precisa da
senha do banco da v2 (não a senha da conta Supabase — a senha do Postgres, que só aparece
em connection string e não é visível no dashboard).

Quando a senha aparecer num `.env`, basta:

```sql
drop user mapping if exists for postgres server v2_winthor;
create user mapping for postgres server v2_winthor
  options (user 'postgres', password 'SENHA');
select cron.unschedule('wth-sync-carteira');
select cron.schedule('wth-sync-carteira','*/30 * * * *', $$ select wth_sync_carteira(); $$);
```

Os dois escrevem na mesma `wth_carteira` por upsert. **Usar um OU outro no cron, nunca os dois.**

#### Chave de cruzamento: CPF

Testado em amostra de 300: **100% de match** por CPF entre os dois bancos.

Não usar telefone como chave primária de match — no `murano-conversas` ele vem com 12 dígitos,
sem o nono (`559181959789`). Telefone só serve como fallback (ver abaixo).

#### Concordância carteira × RCA oficial

Na amostra de 300, a `carteira` bate com o `rca_vendedor` do WinThor em **99%** dos casos.
A `carteira` já estava certa desde o início. Quem estava errado era o `employee_id`.

### 10.6 Estado dos dados (23/07/2026)

| | |
|---|---|
| carteira WinThor carregada | 8.487 |
| contatos no RD Conversas | 1.633 |
| com RCA oficial vinculado | 1.433 |
| sem CPF (não vinculam) | 199 |
| fila de prospecção | 1.197 |
| divergências de carteira | 23 |

Fila por RCA: Romulo 592 · Luana 364 · Kamilly 241.

### 10.7 Pendências

**1. Divergências de carteira (23 casos).** Planilha `divergencias_carteira.xlsx` gerada
para tratar com o time (abas: Divergencias, Como ler). **10 dos 23 são do RCA 53 (Jorge),
quase todos em Castanhal** — tem cara de mudança de território, não de transferências
avulsas. Confirmar com a supervisão resolve 10 de uma vez. Os outros 13 são pulverizados:
Henry (4), Luana (3), e um caso cada de Francisco, Jennifer, Anne, Maiara, Alexandre e
Administrativo Venus. Lista sempre atual: `select * from vw_divergencia_carteira;`

**2. Contatos sem CPF (199).** Planilha `contatos_sem_cpf.xlsx` (abas: Sem CPF, Resumo e
instrucoes). **186 tiveram o CPF recuperado automaticamente** cruzando os 8 últimos dígitos
do telefone contra o WinThor:

| classificação | qtd | ação |
|---|---|---|
| ALTA — telefone e nome batem | 184 | aplicar direto |
| REVISAR — telefone bate, nome difere | 2 | conferir antes |
| AMBÍGUO — telefone bate com mais de um | 1 | confirmar com o cliente |
| SEM MATCH — telefone não existe no WinThor | 12 | pedir CPF na conversa |

Usamos 8 dígitos porque o telefone no painel vem sem o nono em boa parte dos casos.
Depois de aplicar no painel, o vínculo se cria sozinho no próximo sync.

**3. Cadência do job de `clientes` no ETL.** Meta: 30 minutos. Precisa olhar o repositório
para saber se o passo de `clientes` roda em toda execução ou tem agendamento próprio mais
lento. Os timestamps não respondem isso porque são deltas (ver Armadilha 4). **Resposta já
disponível nesta sessão:** roda dentro do incremental normal do `src/etl/run.ts`, cadência
real é a do cron do GitHub Actions (hoje ~20min, sujeito a atraso — ver seção sobre o
disparo manual/scheduling desta sessão).

**4. Token do RD Conversas em texto puro.** Está guardado como memória de conversa, não em
cofre. Mover para os secrets do Supabase ou para um gerenciador de senhas.

**5. Service_role key da v2 em `wth_config`.** Irrestrita — dá leitura e escrita na v2
inteira, embora a função só faça `GET`. Considerar um role read-only na v2 com
`GRANT SELECT ON clientes` e uma chave só para ele. (Isso seria alteração na v2 — decisão
explícita do usuário, não fazer sem intenção clara.)

**6. Senha do banco da v2.** Não localizada. Procurar em `.env` de qualquer projeto que
conecte na v2 por connection string. Resetar derruba tudo que usa a senha antiga, incluindo
possivelmente o sync do WinThor.

### 10.8 Regras de leitura do murano-clientes-v2

```sql
-- vendas
tipo = 'VENDA' AND posicao = 'F - Faturado'
-- devoluções
tipo = 'DEV'   AND posicao = 'DEV - Devolucao'
```

- Período sempre por `data_fat`
- Faturamento sempre **líquido** (vendas − devoluções)
- `itens` liga por `itens.cod_pedido = faturamento.pedido`
- Carteira do cliente é `clientes.rca_vendedor`, não `faturamento.nome_usuario`
- WinThor é fonte da verdade quando houver divergência de sync

### 10.9 Times de venda

| Sigla | Time | RCAs |
|---|---|---|
| **IS** | Vendas internas | Thamires 10, Anne 27, Milene 28, Thiago 29 |
| **GC** | Grandes contas | Maiara 9, Henry 30, Jennifer 31, Natália 47, Jorge 53 |
| **ISR** | Reativação | Romulo 45, Luana 46, Kamilly 51 |

Só o ISR está sincronizado no `murano-conversas`.

Ao acrescentar IS ou GC, atualizar **dois lugares**:
1. Lista de RCAs em `vw_fila_prospeccao`
2. Mapa carteira→RCA em `vw_divergencia_carteira`

### 10.10 Consultas úteis

```sql
-- Últimas execuções do sync
select * from wth_sync_log order by id desc limit 5;

-- Histórico do cron (a coluna jobname NÃO existe em job_run_details — precisa do JOIN)
select d.status,
       d.start_time at time zone 'America/Belem' as inicio_belem,
       d.end_time - d.start_time as duracao,
       d.return_message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname = 'wth-sync-carteira'
order by d.start_time desc limit 10;

-- Fila de prospecção por RCA
select rca_nome, count(*) from vw_fila_prospeccao group by 1 order by 2 desc;

-- Divergências
select * from vw_divergencia_carteira;

-- Cobertura de vínculo
select count(*) as contatos,
       count(*) filter (where rca_num is not null) as com_rca
from vw_cliente_rca;

-- Forçar sync manual
select wth_sync_carteira_http();
```

### 10.11 Por que a tabela `clientes` não foi alterada

Ela é espelho do RD Conversas, escrita pelo ETL. Colunas extras ali correriam risco de serem
apagadas no próximo upsert. O enriquecimento mora em `wth_vinculo`, com FK para `clientes(id)`
e `on delete cascade` — o espelho continua idêntico à origem e o vínculo se limpa sozinho.

Isso também respeita a regra do `murano-system-os`: novo módulo, novo prefixo, tabelas core
intocadas.

## 11. Dashboard / funil (`web/`) — etapas e regras de negócio

App **Next.js** em `web/`, publicado na **Vercel** como `funil-murano` (`funil-murano.vercel.app`).
Kanban de negociações lido da view **`vw_funil`** (Supabase `murano-conversas`), por carteira.
Login admin (cookie `crm_sessao`); vendedor por Google Auth ainda é TODO.

### 11.1 As 4 etapas (colunas), da esquerda p/ direita

A etapa é **derivada em tempo real** na `vw_funil` (não é estado mutável gravado). Cada cliente
tem **exatamente 1 linha** (join lateral por `cliente_id`) — o card **se move** entre colunas,
nunca duplica. Migrations que definem: `0001` (original), `0003` (recência), `0004` (ociosos).

| Etapa | Quando |
|---|---|
| **ociosos** | (a) cliente falou por último e passou de **24h** sem template novo (janela do WhatsApp fechou, só template reabre); (b) venda de mês anterior (expirou) sem nada depois; (c) cliente da carteira que **nunca teve atendimento** no RD Conversas (fila de prospecção) |
| **tentativa_contato** | última mensagem real é do operador **e é template** (aguardando a 1ª resposta a esse disparo) |
| **negociacao** | catch-all: troca ativa dentro da janela (cliente falou por último há <24h, ou operador falou fora de template) |
| **pedido_emitido** | venda no **mês corrente** (fuso BRT): texto `*pedido faturado*`/`*pedido finalizado*` OU tabulação `venda_realizada`. **Expira sozinho no dia 1º** (a view compara com o mês corrente) → cai pra ociosos/negociação |

**Regra de recência (fix da migration 0003):** a etapa olha a **última mensagem real** (ignora
`tipo='evento_sistema'`), **não** "o cliente já respondeu alguma vez" — senão um card ficava preso
em `negociacao` pra sempre depois da 1ª resposta, mesmo após reengajamento por template semanas
depois (caso Maria Bernadete).

**Venda — duas frases (fix 0003):** a equipe usa **`*pedido faturado*` E `*pedido finalizado*`**
(as duas convivem no banco). Reconhecer só a 1ª deixava vendas presas na etapa errada (caso Samara
Soares Brito). **Futuro ideal:** puxar a venda **de verdade** do `murano-clientes-v2` (via
`wth_vinculo.codcli` → faturamento), porque a equipe **não tem o hábito de fechar o atendimento**
depois da venda — então tabulação sozinha é insuficiente, por isso o texto continua sendo sinal.

### 11.2 Cards de prospecção (nunca contatados)

Vêm de **`vw_fila_prospeccao`** (clientes da carteira RCA oficial 45/46/51 sem atendimento no RD).
Não têm `cliente_id` do RD Conversas → id sintético **`winthor:<codcli>`**, `ultima_atividade` NULL,
só `nome`/`telefone`/`cidade`. No front, o clique **abre WhatsApp direto** (`wa.me/<telefone>`), não
o RD Conversas. Dedup por telefone (últimos 8 dígitos) evita duplicar quem já está em `clientes`.

- **~1.003 desses cards hoje.** Como têm data NULL, **só aparecem no filtro de período "todos"**
  (o padrão) — some ao filtrar por hoje/semana/quinzena/mês (não têm atividade pra cair na janela).
- **~67 estão sem telefone** no WinThor → aparecem como "sem telefone", clique não faz nada.

### 11.3 Filtro por período no cabeçalho de cada coluna

Cada coluna tem chips **hoje / semana / quinzena / mês** (janelas móveis cumulativas sobre
`ultima_atividade`, BRT) com a contagem de cada período. Clicar filtra **aquela** coluna; clicar no
ativo desliga (volta pra "todos"). Um **dropdown global** aplica um período a **todas** de uma vez.
Não há mais o número total ao lado do nome da etapa (removido a pedido do usuário).

### 11.4 Detalhes de implementação do front

- **Paginação obrigatória em `/api/funil`:** o PostgREST/Supabase corta resposta em **1000 linhas**;
  a `vw_funil` tem ~2.5k (com prospecção). A rota **pagina de 1000 em 1000** — sem isso, os cards de
  prospecção (ordenados por último, data NULL) sumiam.
- **Scroll infinito por coluna** (100 cards/lote, +100 ao chegar perto do fim) — sem lib.
- **Botão "Sincronizar agora"** (só admin): dispara o **mesmo** ETL incremental do cron via
  `workflow_dispatch` (`/api/sync-etl`, PAT `GITHUB_ETL_TOKEN` com Actions:write). Legenda mostra o
  que sincroniza + cronômetro ao vivo. **Não** dispara o sync do WinThor (`wth_`, pg_cron separado).
- **Botão TEMPLATE / disparos** (`/api/send-template`, `disparos_template`) — ver migration `0002`.
