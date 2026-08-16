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
6. **Flag `is_test`** (nossa, não vem da API) para filtrar contatos internos, que
   seguem o padrão `"<Nome da pessoa> | Murano Professional"` no `full_name`.

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
do cliente **C.M.** (seção anterior desta sessão): `employee`/`employee_id` não é
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
**fila de prospecção**, não buraco de dados. **Isso explica o caso da cliente E.A.**
investigado nesta sessão: ela pode simplesmente nunca ter tido um atendimento com
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
→ **PENDENTE, prioridade alta.** Detalhamento e estado verificado em **19.1** — inclui a
`RD_CONVERSAS_PRIVATE_JWK`, cujo risco é maior que o do token (perdê-la torna o histórico
cifrado ilegível para sempre).

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
depois (caso M.B.).

**Venda — duas frases (fix 0003):** a equipe usa **`*pedido faturado*` E `*pedido finalizado*`**
(as duas convivem no banco). Reconhecer só a 1ª deixava vendas presas na etapa errada (caso S.S.B.). **Futuro ideal:** puxar a venda **de verdade** do `murano-clientes-v2` (via
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

### 11.5 Menu Visões (`/visoes`) e temas visuais

**Visões** (item do menu, todos os papéis; vendedor vê só a própria carteira — filtro no servidor):
hub com 5 visões, cada uma abre um board filtrado. Dados da **`vw_visoes_cliente`**
(migration `0074`): agregados de compra por `codcli` do `wth_faturamento` (líquido, regras
VENDA/DEV da seção 10.8) + `wth_carteira` + slug via `carteira_config`. As **regras de cada
visão moram em `/api/visoes`** (TS, não na view — ajustar regra não pede migration):

| Visão | Regra |
|---|---|
| 30 Melhores | rank F/M (meses c/ compra em 12m + líquido 12m, pesos iguais), top 30; ativo = compra ≤ **120 dias** |
| Frequência | frequente = **3+ meses seguidos** de compra (mês corrente em aberto não quebra a sequência) |
| Fidelização | novos com 1–2 meses de compra; ao fechar 3 meses viram "fidelizados" e passam pra Frequência |
| Compras do mês | `comprou_mes` (desde o dia 1º, BRT), ordenado por valor |
| Desativados | `wth_descartados` + coluna `observacao` (0074); dropdown de motivo + observação editáveis (PATCH `/api/descartados`); restaurar = DELETE |

Desativados somem das visões 1–4 (mesma regra do board). A view tem ~5.9k linhas → a rota
pagina de 1000 em 1000 (~0,4s por página).

**Temas:** `web/lib/tema.ts` — paletas `padrao` (RD de sempre) e `murano` (**Tema 1**,
identidade Murano Professional: vinho `#621244`, laranja `#dd4222` como ação, fundo `#f5edf4`).
Botão 🎨 na top bar (e no menu mobile) alterna e persiste em `localStorage` (`crm_tema`).
No board o objeto `RD` é mutável de propósito: `Object.assign(RD, TEMAS[tema])` no início do
`Page()` + re-render troca tudo sem refatorar os estilos inline. As telas de visões leem o
mesmo `localStorage`.

### 11.6 Chat (`/chat`) — ambiente de conversa estilo RD Conversas

Botão **💬 Chat** no menu (desktop e mobile, todos os papéis). Layout WhatsApp Web
(sidebar de conversas + thread), identidade Murano com regras do usuário: **púrpura
`#7b2d8b` nos botões** (não laranja), **azul `#1a5fa8`** nos ticks de lida/links,
**laranja só em avisos** (fora da janela 24h, falha de envio).

- **Lista** = `GET /api/chat`: `vw_funil` com `ultima_atividade` não nula (corta
  prospecção e ids sintéticos), escopo por carteira no servidor.
- **Thread** = `GET /api/chat/thread?cliente_id=`: últimas 200 mensagens com
  `id/status/tipo` (ticks ✓/✓✓/✓✓azul = wait/success/read, mapeados do RD e do
  webhook Cloud). Não escopa por carteira (mesma razão do `/api/mensagens`).
- **Envio** reusa `POST /api/send-message` (roteia RD × Cloud API pela regra da
  seção 16.3; otimista no front; 422 `foraDaJanela` vira aviso pra mandar template
  pelo board).
- **Atualização** = mesmo Realtime do board (canal `board`, evento `mudou`) +
  poll de 60s como rede de proteção + guarda de in-flight. Nenhuma chamada à API
  do RD a partir do chat — só Supabase (cota preservada, seção 15).

## 12. Faturamento / vendas reais (nota fiscal WinThor)

> Handoff de outra sessão Claude (conta oficial Murano). **Verificado ao vivo em 24/07/2026**:
> `vw_pedido_emitido` = 5.889 linhas, `wth_faturamento` = 46.368; contadores do mês bateram
> exatamente com o doc (romulo 43 · kamilly 45 · luana 56). **Nota:** ao conferir, cuidado com
> o teto de 1000 linhas do PostgREST — contar com `select('*',{count:'exact',head:true})` filtrado,
> não somando linhas de um SELECT (isso me deu um falso "só 21 no mês" antes de paginar).

### 12.1 O que foi criado

| Objeto | Tipo | O que é |
|---|---|---|
| `wth_faturamento` | tabela | 46.368 notas do WinThor (43.506 vendas + 2.862 devoluções) |
| `wth_sync_faturamento_http(p_dias)` | função | Carga via REST. `NULL` = histórico completo |
| `wth_sync_tudo()` | função | Roda carteira + faturamento. É o que o cron chama agora |
| `vw_pedido_emitido` | view | **Fonte da coluna PEDIDO EMITIDO do CRM** (1 linha por nota) |
| `vw_cliente_compras` | view | Histórico de compra por contato (`total_liquido` já subtrai devolução) |
| `vw_conversa_e_compra` | view | Atendimento × primeira compra posterior (conversão ~7,1%) |

**Cron mudou:** `wth-sync-carteira` foi removido e substituído por **`wth-sync-tudo`** (a cada 30min),
que atualiza carteira **e** faturamento juntos (janela móvel de 45 dias). Ver seção 10.10, trocando
o jobname por `wth-sync-tudo`.

### 12.2 RLS — o app usa service_role, então lê tudo

As tabelas `wth_*` têm **RLS ligado sem policy** → a chave **anon não lê nenhuma linha delas**
(views funcionam porque rodam como dono). **Mas o nosso app usa `SUPABASE_SERVICE_ROLE_KEY`
server-side** (nas rotas `/api/*`), que **ignora RLS** — então lê `wth_*` e as views normalmente,
e o browser nunca recebe chave nenhuma. Para view nova que precise ser lida por anon:
`grant select on nome_da_view to anon, authenticated;` (não é o nosso caso).

### 12.3 `vw_pedido_emitido` — colunas úteis

1 linha por **nota fiscal** (cliente que comprou 3x aparece 3x → o CRM agrupa por `cliente_id`).
Chaves: `cliente_id` (liga ao RD Conversas), `codcli`, `carteira`, `rca_num`. Dados: `valor`,
`data_fat`, `num_nota`, `pedido`, `filial`/`codfilial` (Venus=1, MK Cosméticos=3), `lancado_por`
(quem digitou — **não** é o dono da carteira). Buckets prontos: `hoje`/`semana`/`quinzena`/`mes`
(bool, `mes` = desde o dia 1º). Enriquecimento: `ultimo_contato_antes`, `dias_do_contato_ate_compra`.

### 12.4 Consumido pelo CRM (feito nesta sessão — migration 0006)

A `vw_funil` passou a marcar **pedido_emitido pela nota fiscal** (`vw_pedido_emitido.mes`), não mais
só palavra-chave/tabulação — saltou de **5 → 86 clientes**. Palavra-chave `*pedido faturado/finalizado*`
fica como **sinal secundário** (fechou no chat, nota ainda não faturou). Cliente que fala **depois** de
comprar volta pra negociação/tentativa. O card mostra o **valor R$** faturado no mês (`venda_valor`).
Isso resolve o TODO "ajustar o app para ler `vw_pedido_emitido`" do handoff.

### 12.5 Achado de segurança — anon com escrita (RESOLVIDO em 03/08/2026)

**Era:** `clientes`, `atendimentos`, `mensagens`, `vendedores`, `disparos_template` (e mais 5) estavam
com **RLS desligado e anon/authenticated com SELECT/INSERT/UPDATE/DELETE**. Comprovado ao vivo assumindo
o papel: `set local role anon` lia **59.586 mensagens e 4.752 clientes**. Qualquer pessoa que abrisse o
DevTools num app da Murano pegava a chave pública e apagava a base com um `curl`.

**Conserto aplicado** (migration `rls_fechar_tabelas_expostas_anon`): RLS ligado **sem policy** nas 10
tabelas. Sem policy, anon e authenticated não enxergam linha nenhuma; `service_role` e o dono continuam
passando, porque ignoram RLS. É o mesmo padrão que `wth_*` e `tickets` já usavam neste banco.

```sql
alter table clientes enable row level security;   -- + atendimentos, mensagens, vendedores,
                                                  --   disparos_template, acesso, carteira_config,
                                                  --   crm_templates, bi_meta_vendedor, wth_descartados
```

Verificado depois: anon e authenticated leem **0** linhas; o dono lê as 59.586; `vw_funil` (4.667),
`vw_pedido_emitido` (29.033) e `vw_fila_prospeccao` (720) continuam servindo.

**Por que não quebrou nada** — as três checagens feitas antes de aplicar:
1. Nenhum código no navegador lê tabela com a chave anon. O único uso da anon no browser
   (`web/app/page.tsx`) é `signInWithOAuth`. `supa.from`, `supabase.from` e `/rest/v1`: zero ocorrências.
2. ETL, rotas `/api/*`, `tools/persona.py` e as funções do `pg_cron` usam `service_role` ou rodam como dono.
3. As 13 views que leem essas tabelas têm `security_invoker = false` — rodam como dono e atravessam o RLS
   das tabelas-base. **Se algum dia uma view dessas virar `security_invoker = on`, ela para de retornar
   linha.** É a única forma conhecida de quebrar isso depois.

**Rollback**, se um consumidor externo desconhecido começar a receber lista vazia (PostgREST devolve `[]`,
não erro — falha em silêncio): `alter table <nome> disable row level security;`

**O que ficou de fora:** o `revoke` dos privilégios não foi aplicado. O RLS já bloqueia, e revogar GRANT
tem mais chance de quebrar algo sem ganho adicional.

### 12.6 Pendências desta fase

- View de conversão com **janela fechada** (7/15 dias) + exigência de inatividade prévia (a atual mede
  correlação, não causa — liga o atendimento à 1ª compra posterior sem limite de prazo).
- Decidir se `vw_vendas_diario` (baseada em `tabulacao`, quase vazia) é aposentada.
- Decidir se as duas filiais (Venus/MK) contam juntas ou separadas nos relatórios.
- Revogar escrita da anon (12.5).
- **Performance:** o join de `vw_pedido_emitido` na `vw_funil` deixou `/api/funil` em ~3,4s local (com
  paginação 3×1000). Ok pra 1 admin hoje; se pesar, materializar o agregado de nota por cliente.

## 13. Sincronização — escala e cadência (jul/2026)

**Três sincronizadores distintos (não confundir):**

| Sync | O quê | Onde | Cadência | Escala com nº de vendedores? |
|---|---|---|---|---|
| ETL RD Conversas | conversas, mensagens, etapas | GitHub Actions (repo público → grátis) | **10 min** | **SIM** (1 chamada/conversa, rate-limited) |
| `wth-sync-tudo` | carteira + faturamento WinThor → Pedido Emitido | pg_cron (Supabase) | 10 min | **NÃO** (já puxa a empresa inteira; ~1-4s constante) |
| views (`vw_funil` etc.) | etapa/valor calculados ao vivo | — | instantâneo na consulta | — |

**ETL RD Conversas (Opção 2, implementada):** varre só conversas ATIVAS na janela (`ETL_SCAN_DAYS=3`,
no `.github/workflows/etl.yml`) via checagem barata `/v2/contacts/{phone}/exists` (última msg em texto
puro, sem decrypt) e só baixa+decripta o histórico das que mudaram. Medido: 318 conversas em ~6,6 min.

**A trava real é o RATE LIMIT da API (~1,2s/chamada, sequencial)** — não os minutos do Actions. Por
isso a janela é 3 dias, não 30 (30d = 1.560 conversas = 33 min). Com 3x o volume (7 mil clientes,
7 vendedores) a mesma janela vira ~19 min → estoura os 10.

**Caminho de escala (a solução certa, não "mais frequência"):** **fechar conversas.** Reativação de
conversa fechada vira **protocolo novo**, pego pelo `/v4/reports` — que é consulta PAGINADA, não 1
chamada/conversa → escala barato. **Confirmado (jul/2026): o RD Conversas TEM fechamento automático,
mas só pelo PAINEL, não via API.** Então é config operacional (fechar após ~5 dias ociosos), não código.

**wth-sync-tudo:** cadência é 1 linha no SQL Editor (não dá via REST):
`select cron.unschedule('wth-sync-tudo'); select cron.schedule('wth-sync-tudo','*/10 * * * *', $$ select wth_sync_tudo(); $$);`
Custo constante (~1-4s), não escala com vendedores → 10 min ok pra sempre.

## 14. Estado em 26/07/2026 — o que mudou depois da seção 13

> A seção 13 ficou defasada (falava de 3 carteiras, `ETL_SCAN_DAYS=3`, um único workflow).
> Esta seção reflete o estado real. Migrations foram de 0014 → 0041.

### 14.1 Vendedores agora são CONFIGURAÇÃO, não código (`carteira_config`)

Tabela **`carteira_config`** (migration 0016) é a fonte única: `slug`, `rca_num`, `employee_id`,
`cor`, `ativo`, `time`. O ETL a carrega no início (`loadCarteiraConfig`) e as rotas do app
(`send-template`, `send-message`) leem o `employee_id` de lá. **Adicionar vendedor = 1 linha no
banco**, sem deploy. Hoje são **7**: ISR (romulo 45, luana 46, kamilly 51) e IS (milene 28,
anne 27, thiago 29, thamires 10).

### 14.2 Dois workflows de ETL

| Workflow | Cadência | O que faz |
|---|---|---|
| `etl.yml` | `*/10` + full às 06:05 | incremental: reports → scan barato (`ETL_SCAN_DAYS=5`) → disparos → fetch |
| `etl-fast.yml` | `*/15`, loop de ~13 min | sweep do "conjunto quente" (`ETL_FAST_HORAS=12`), quase tempo real |

`ETL_FAST_CONC=2`: **conc=4 no fast satura o RD e gera 429 no envio de template do board.**
A cota é compartilhada entre ETL e ações do usuário — por isso existem os botões Pausar/Retomar.

### 14.3 Performance do incremental — diagnóstico e fix (26/07)

**Sintoma:** runs de 13 a 62 min com cron de 10 min → o `concurrency: group: etl` cancelava os
seguintes, e o sync efetivo caía pra ~1x/hora.

**Diagnóstico (run 30199589716, 36 min):** o scan barato varria 957 conversas (~19 min, conc=1) e
achava só 15 com msg nova — mas o bloco `[disparos]` mandava **761 clientes** pro fetch caro
(histórico + decrypt). Medido: **544 clientes distintos com template ≤5d, todos re-baixados a cada
run**, ~27 min só nisso. A causa foi o disparo em massa: centenas de templates → centenas de
re-fetches cegos por 5 dias.

**Premissa que destravou o fix (verificada ao vivo):** template enviado pela API **não aparece no
`last_message_data` do `/exists`**. Então a checagem barata não dá falso positivo por causa do
próprio template — ela distingue quem **respondeu** de quem só recebeu.

**Fix:** `clientesComDisparoRecente` passou a separar **frescos** (`ETL_DISPARO_FRESCO_H=6h` →
fetch direto, garante o template em `mensagens`) de **antigos** (→ checagem barata). Mais dedup
(não re-checa o que o scan já checou) e `ETL_SCAN_CONC=3` no scan.

**Bench de concorrência do `/exists` (26/07, isolado):** conc=1 →280ms/chamada · conc=4 →79ms ·
conc=8 →50ms (0 erros) · **conc=12 → 429 em 90%**. Default 3 = ~3x mais rápido com folga pros envios.

### 14.4 Por que NÃO trocamos o gatilho pelo pg_cron do Supabase

Hipótese levantada e **descartada com medição**: os runs duravam mais que o intervalo do cron, então
o problema era **duração**, não disparo — trocar o gatilho só criaria mais runs pra serem cancelados
pelo mesmo `concurrency group`.

**E migrar o ETL de mensagens pro Supabase esbarra em 2 bloqueios:** (a) a decriptação usa
`node-jose` (Node); Edge Function é Deno → exigiria reescrever com `jose`/WebCrypto e reimplementar
as 3 armadilhas da seção 3 (Latin-1, JSON aninhado, bytes de controle); (b) Edge Function tem
timeout de 150s (400s background no Pro) contra os 55 min do Actions.

**O que faria sentido no futuro:** mover **só o sweep** (`/exists`, que **não** precisa de decrypt)
pro Supabase, deixando o fetch+decrypt no Actions. Separação por natureza do trabalho, não por sync.

### 14.5 O TETO REAL: ~48 chamadas/min na API do RD (medido 26/07)

**Esta é a restrição que governa todo o desenho do ETL.** A API sustenta ~48 requisições
por minuto e **concorrência NÃO fura esse teto**.

Comprovado no run `30201466856`, três fases independentes do mesmo run, com `conc=3`:

| Fase | Chamadas | Tempo | Taxa |
|---|---|---|---|
| scan `/exists` | 919 | 18,5 min | 1,20 s/chamada |
| disparos `/exists` | 417 | 8,2 min | 1,18 s/chamada |
| fetch `/messages/history` | 310 | 7,4 min | 1,43 s/chamada |

Antes (run `30199589716`): 1.718 chamadas / 36 min = **47,7/min**.
Depois: 1.646 chamadas / 34 min = **48,4/min**. Mesma taxa.

**Armadilha de medição (erro cometido e corrigido):** um bench isolado deu conc=1 →280ms,
conc=4 →79ms, conc=8 →50ms/chamada, sugerindo 5x de ganho. **Era rajada de 30 chamadas —
o crédito acumulado do token bucket, não vazão sustentada.** Em produção a taxa volta a
~1,2s/chamada. **Sempre medir vazão sustentada (centenas de chamadas), nunca rajada curta.**

**Corolário que invalida a intuição óbvia:** trocar fetch caro por checagem barata
(`/exists`) **quase não acelera** — as duas custam **1 chamada**, e a cota é o gargalo.
A checagem é barata em CPU (sem decrypt), não em cota. Um fix assim rendeu só 4%.

**O que realmente acelera é reduzir o NÚMERO de chamadas:**
1. Diff dos contadores do `/v4/reports` (`total_send/receive_messages` vs `atendimentos`)
   — detecta quem mudou **sem gastar chamada**, porque o dado já veio no reports.
2. `ETL_CALL_BUDGET` + rodízio determinístico (`fatiaRotativa`) — trabalho limitado por run.
3. **Fechar conversas** (painel): reativação vira protocolo novo, pego por 1 chamada
   paginada em vez de 1 por conversa. Única alavanca que muda a ordem de grandeza.

**Regra de dimensionamento:** run de N minutos ≈ N × 48 chamadas. Para 10 min, ~480 —
e é preciso descontar o `etl-fast` (~23%) e os envios de template do board, que dividem
a mesma cota (por isso existem os botões Pausar/Retomar).

### 14.6 Resultado verificado (26/07/2026) — gatilho no pg_cron + orçamento

**Antes:** runs de 34-50 min com cron `*/10` → o `concurrency group` cancelava os seguintes
e o sync efetivo caía pra ~1x/hora.

**Depois:**

| Horário | Duração | Observação |
|---|---|---|
| 12:08 | 49 min | antes das correções |
| 12:41 | 50 min | antes das correções |
| **14:40** | **7 min** | orçamento rotativo + diff do reports |
| **14:50** | disparado no horário | sem fila, sem cancelamento |

**Disparos do `pg_cron` (`etl_trigger_log`):** 14:30:00 · 14:40:00 · 14:50:00 — pontualidade
exata, contra ~1x/hora do agendador do GitHub.

**Quebra do run de 7 min** (`30203800672`, com todas as correções):

```
[reports]  234 ativos -> 0 c/ contador alterado (234 fetches evitados)  <- diff
[scan]     580 na janela 3d -> 210 checadas (fatia 1/3, cobertura em 30 min)
[disparos] 28 frescos + 90 antigos checados -> 4 c/ resposta
[fetch]    37 clientes, 224 msgs
total ~361 chamadas em 6,5 min
```

**O cron `*/10` do GitHub foi mantido** como redundância (dispara ~1x/hora; o
`concurrency group` impede sobreposição). Se o `pg_cron` falhar, ainda há um fallback.

**Monitorar:** `select * from etl_trigger_log order by id desc limit 10;` — status **204**
é sucesso. A função nunca lança exceção: qualquer falha vira linha no log (o risco clássico
desse tipo de job é falhar em silêncio). Token em `wth_config.gh_etl_token`.

## 15. Estado em 03/08/2026 — o navegador era o maior consumidor da cota do RD

> Esta seção **corrige** partes das seções 13 e 14. Onde houver conflito, vale esta.
> Migrations 0069, 0070, 0071.

### 15.1 O achado

O teto da API do RD é **~48 chamadas/min** (seção 14.5) e governa todo o desenho. Mas a
contabilidade dessa cota só considerava o ETL. Faltava o navegador:

`web/app/page.tsx` tinha um `setInterval` de 10s chamando `/api/negociacao-sync` com até
10 `cliente_ids`, e **cada id fazia um fetch completo de `/v2/messages/history` + decrypt**.
São até **60 chamadas/min POR ABA ABERTA**, contra 48/min disponíveis no sistema inteiro.
Com 7 vendedores logados, a demanda chegava a ~420/min.

Pior: era **incondicional**. O ETL é cuidadoso (checagem barata via `/exists`, diff dos
contadores do `/v4/reports`, orçamento rotativo); o loop do navegador re-baixava os mesmos
cards a cada 10s tivesse mudado algo ou não. E o `fastSweep` já colocava todos os cards de
negociação no tier A de todo sweep — o mesmo trabalho, duplicado.

**Isso explica sintomas que estavam sendo tratados como causa:** os 429 no envio de
template, a necessidade dos botões Pausar/Retomar, e o throttle do ETL (`ETL_SCAN_SLEEP=700`,
`conc=1`, ~30 req/min "para deixar folga"). O ETL foi estrangulado para abrir espaço a um
consumidor que não tinha teto — escalava com o número de abas abertas, não com o trabalho real.

### 15.2 A distinção que resolve

| Trecho | Precisa de pull? |
|---|---|
| RD Conversas → Supabase (ingestão) | **Sim, sempre.** A API do RD não tem webhook (404 confirmado, seção 2). O ETL está certo. |
| Supabase → navegadores (distribuição) | **Não.** O Postgres avisa; o Realtime entrega. |

Todo o polling do front existia porque essa segunda peça estava faltando.

### 15.3 O que mudou

| Antes | Depois |
|---|---|
| `setInterval(load, 5000)` por aba (~84 reconstruções do funil/min com 7 abas) | Realtime broadcast (migration 0069) + poll de **60s** só como rede de proteção |
| `setInterval` de 10s consumindo até 60 req/min do RD por aba | **Removido.** Frescor vem do `fastSweep` + Realtime; urgência pontual pelo ↻ (`/api/sync-cliente`) |
| `load()` sem trava, requisições se sobrepondo | guarda de in-flight com coalescência (nunca empilha, nunca perde evento) |
| ETL throttlado a ~30 req/min | `ETL_CALL_BUDGET=300`, `SCAN_CONC=2`, `SCAN_SLEEP=250` (~40 req/min, ~8 de folga) |
| `etl-fast` no scheduler do GitHub (~1x/hora) | `pg_cron` job `etl-disparar-fast` a cada 15 min (migration 0070) |
| PAT do GitHub em texto puro em `wth_config` | `public.segredo_de()` lê do Vault com fallback (migration 0071) |

**Bug corrigido de quebra:** `etl_disparar_workflow` mandava sempre
`inputs:{"mode":"incremental"}`, mas `etl-fast.yml` declara `workflow_dispatch:` **sem
inputs** — o GitHub responde 422 a input não declarado. O corpo agora é montado conforme
o workflow. Sem isso, o item anterior não funcionaria.

**Nome do repo:** `wth_config.gh_etl_repo` e o default da função foram para
`MuranoIA/murano-crm`. Antes o default era o nome antigo, dependendo do redirect do GitHub.

### 15.4 Como o board atualiza agora

Trigger de **statement** (não de linha — o ETL faz upsert em lotes de 500) em `mensagens`
e `disparos_template` chama `realtime.send()` no tópico `board`, evento `mudou`, payload
`{carteira, em}`. O front assina, filtra pela própria carteira (admin/home veem tudo) e
chama `/api/funil` uma vez.

- **Canal público de propósito:** o board autentica por cookie próprio (`crm_sessao`), não
  por Supabase Auth — não há JWT para validar canal privado. O payload não carrega dado de
  negócio; a autorização continua no servidor, em `/api/funil`.
- **UPDATE é filtrado:** o id da mensagem é `sha1(cliente_id|created_at|content)`, então
  upsert de linha existente tem conteúdo idêntico por construção. Só notifica se `status`
  ou `tipo` mudarem — senão o board recarregaria a cada re-fetch do ETL sem novidade.
- **Falha nunca derruba o ETL:** todo o corpo está sob `exception when others`. Se o
  Realtime cair, degrada para o poll de 60s.

Monitorar: `select * from vw_etl_trigger_saude;` (`desde_ultimo_ok` deve ficar < 20 min).

### 15.5 Convenção de PII — o repositório é PÚBLICO

O repo é público de propósito (Actions grátis/ilimitado). Logo: **nome completo de cliente
não entra em arquivo versionado.** Casos são referenciados por iniciais (`S.S.B.`, `E.A.`,
`M.B.`, `C.M.`) — o histórico de sessões anteriores foi convertido.

Nomes de **vendedores** continuam em claro: são funcionais (o slug da carteira é chave em
`carteira_config`, nas views e no ETL) e não são dado de cliente.

Se um dia o conteúdo operacional precisar de nomes reais, o caminho é mover este arquivo
para um repo privado — não tornar o repo do ETL privado, que custaria os minutos de Actions.

## 16. Migração para a WhatsApp Cloud API (Fases A/B validadas — 06/08/2026)

> Canal direto com a Meta, em transição para substituir o RD Conversas. **Decisão de
> arquitetura: adaptar este projeto, não recriar** — o canal novo é ADITIVO: grava nas
> mesmas tabelas (`clientes`/`mensagens`), então board, views, Realtime e relatórios
> funcionam sem mudança. O ETL do RD segue rodando em paralelo, intocado, até a Fase C.

### 16.1 O que está no ar (PRs #37–#42)

| Peça | O que faz |
|---|---|
| `web/app/api/whatsapp/webhook` | GET = verificação (`hub.challenge` + `WHATSAPP_VERIFY_TOKEN`); POST = mensagens recebidas → upsert em `mensagens` com **id = wamid** (idempotente) + statuses de envio (sent/delivered/read/failed) → update da mesma linha. Valida `X-Hub-Signature-256` se `WHATSAPP_APP_SECRET` existir. Sempre responde 200 (erro interno é logado — a Meta reenvia eternamente o que não recebe 200) |
| `web/lib/whatsapp.ts` | `sendText`/`sendTemplate` (Graph **v22.0** — subir p/ v26 qualquer hora), `canalDoCliente()` e `canalDeResposta()` |
| `send-message` / `send-template` | Roteiam por canal (16.3). Fluxo RD 100% intocado |
| `web/app/api/whatsapp/send-test` | **TEMPORÁRIA** (allowlist com o telefone do dev hardcoded). Remover na Fase C — e o telefone sai do repo junto |

### 16.2 Infra na Meta

- App **Murano Pulse** `2654151365016843` · WABA de teste `28189344217325382`
  ("Test WhatsApp Business Account") · phone_number_id `1221847701011584`
  · número de teste **+1 555 671 6653**.
- **WABA real "Murano Pro" `1441580480587007`** já existe no Business Manager —
  candidata natural a receber o número oficial na Fase C. Há também contas
  "Murano Cobrança", "Murano Shop" e apps de celular (Henry, Milene) a mapear.
- Usuário do sistema **Murano Pulse** (Employee, `61592991989302`) com o app e as
  WABAs atribuídos — dono do token permanente.
- Webhook cadastrado: `https://crm.muranoprofessional.com.br/api/whatsapp/webhook`,
  campo **`messages`** assinado (v26.0). **A URL de produção é o domínio próprio**
  (Cloudflare → Vercel); `funil-murano.vercel.app` responde 402 DEPLOYMENT_DISABLED
  e NÃO é a produção.

### 16.3 Regras de roteamento e convergência

- **Recebimento:** webhook grava tudo. Vínculo com cliente por **tel8** (últimos 8
  dígitos — RD guarda 12 dígitos sem o nono, Meta manda 13). Sem match → cria cliente
  **`wa:<wa_id>`** (id sintético, padrão `winthor:<codcli>`).
- **Envio (`canalDeResposta`):** `wa:*` → Cloud API; senão, se a **última mensagem
  recebida** do cliente tem id `wamid.*` → Cloud API (responde pelo canal em que o
  cliente falou); senão → RD. Interruptor **`WHATSAPP_ENVIO_PADRAO=true`** (Vercel)
  vira tudo para Cloud na migração do número, sem deploy.
- **Envio espelhado:** toda mensagem enviada pela Cloud grava linha em `mensagens`
  (id = wamid, status `wait`) — o webhook atualiza a MESMA linha com o recibo
  (`wait`→`success`→`read`, mapeados de sent/delivered/read; `failed` fica literal).
- **Template Cloud ≠ template RD:** é outro cadastro (nome aprovado no Gerenciador da
  Meta). Env `WHATSAPP_TEMPLATE_RECONTATO` (nome) — enquanto vazia, o desvio Cloud do
  send-template responde 501 com instrução.
- Envs (nomes; valores só na Vercel): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_WABA_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` (pendente),
  `WHATSAPP_ENVIO_PADRAO`, `WHATSAPP_TEMPLATE_RECONTATO` (pendente).

### 16.4 Armadilhas já pagas (não repagar)

1. **Graph 190 com token válido:** caractere invisível (espaço/quebra) colado junto do
   token na Vercel. A lib sanitiza (`[^\x21-\x7E]` → remove) — mesmo bug que o RD já teve.
2. **Graph 131030 com número cadastrado:** a allowlist de destinatários de teste guarda o
   formato COM nono dígito; o `wa_id` do webhook vem SEM. Enviar sempre no formato cadastrado.
3. **Webhook "validado" mas mudo:** validar a URL não basta — tem que ASSINAR o campo
   `messages` (toggle em Configuração → Webhook → Gerenciar). O botão "Teste" do painel
   dispara mesmo sem assinatura (falso positivo de sanidade).
4. **Token do painel ("Configuração da API") é da SESSÃO PESSOAL do dev** — morre em ~24h
   e a cada regeneração. Produção exige token de usuário do sistema com expiração "Nunca".
5. **Gerar token de usuário do sistema pede aprovação de OUTRO admin** do portfólio
   (solicitação expira em 7 dias). O limite da conta é 1 system user Admin — o Murano
   Pulse é Employee, o que basta (poder vem dos ativos + permissões, não do papel).
6. Teste de ponta: mandar mensagem para o número de TESTE do app (+1 555 671 6653), do
   celular cadastrado como destinatário. Latência normal ponta a ponta: ~2 s.

### 16.5 Pendências (ordem) e fases

1. ~~Token permanente~~ **RESOLVIDO (06/08):** aprovado pelo 2º admin, gerado no system
   user Murano Pulse com expiração "Nunca", instalado na Vercel e testado. Envio não
   expira mais.
2. ~~`WHATSAPP_APP_SECRET`~~ **RESOLVIDO (11/08):** instalado na Vercel; o webhook passou
   a validar `X-Hub-Signature-256`. Evidência dos dois lados, no domínio de produção:
   POST sem assinatura respondia **200** antes e **403** depois; e um evento **real
   assinado** da Meta (mensagem do celular do dev para o número de teste) foi aceito e
   gravado em **~2 s** (`criada_em` 00:56:30 → `sincronizado_em` 00:56:32, Belém).
   Só a *ausência* de assinatura foi exercitada — assinatura inválida cai no mesmo ramo,
   mas não foi testada. **Não verificado:** em quais *environments* da Vercel a env
   existe. Se só em Production, deploys de preview seguem aceitando evento não assinado.
3. Template de recontato na Meta + `WHATSAPP_TEMPLATE_RECONTATO`. **Adiado pelo usuário
   em 06/08 sem motivo declarado** (pediu para não criar naquele momento; ninguém
   perguntou o porquê — não invente racional). Enquanto a env não existir, o botão
   TEMPLATE responde **501** com instrução quando a conversa está no canal Cloud; o
   fluxo RD segue normal.
4. Graph v22 → v26 na lib; remover `send-test`.
5. **Fase C (corte):** mapear o que o time usa do painel RD → migrar o número oficial
   do RD/Tallos para a WABA (ponto sem volta: RD para de receber) → nome de exibição →
   `WHATSAPP_ENVIO_PADRAO=true` → aposentar o ETL gradualmente.
6. **Fase D:** mídia (webhook entrega media_id, que expira — baixar p/ Supabase Storage;
   hoje entra como marcador `[image]` etc.), tela de chat no board, monitoramento do
   webhook, limpeza do código RD e dos docs (ainda citam funil-murano.vercel.app).

### 16.6 Estado do painel da Meta — campo a campo

> **Observado por captura de tela em 05–06/08/2026 e NÃO reverificado desde então**
> (exceto a Chave Secreta, instalada em 11/08). Reconfirmar antes de agir.

App **Murano Pulse** (`2654151365016843`), portfólio Murano Professional
(`business_id 1132196710850578`):

| Campo | Estado |
|---|---|
| Modo do app | **Desenvolvimento** — menu "Publicar" com selo *"Não publicado"* |
| Business Verification | ✅ **concluída** |
| "Análise do app" (pendente no painel) | **irrelevante** — só vale para Provedor de Tecnologia |
| ID do app · Chave Secreta · Nome de exibição · E-mail de contato | preenchidos |
| **URL da Política de Privacidade** | ❌ vazio |
| **URL dos Termos de Serviço** | ❌ vazio |
| **Domínios do app · Exclusão de dados · Categoria · Ícone** | ❌ vazios |

Webhook: URL do domínio próprio salva e verificada, campo **`messages` assinado** ✅
(demais campos não assinados), painel exibindo **v26.0** — contra `v22.0` na lib.

**Nome de exibição do NÚMERO:** não se aplica ainda — estamos no número de **teste da
Meta**, que não passa por esse processo. O status só existe depois que o número oficial
for registrado na WABA (Fase C).

**Para sair do modo Desenvolvimento** faltam, portanto: política de privacidade e termos
publicados (URLs), mais os campos vazios acima. Nada disso exige App Review: para app do
tipo Business acessando dados do próprio negócio, o **Acesso Padrão é aprovado
automaticamente** — App Review/Acesso Avançado só é exigido para servir usuários sem
papel no app (o caso dos BSPs, não o nosso).

### 16.7 Mapa das WABAs e usuários do sistema (observado 06/08/2026)

| Conta em "Contas do WhatsApp" | O que é | Confiança |
|---|---|---|
| **Test WhatsApp Business Account** (`28189344217325382`) | WABA de teste do nosso app; abriga o número de teste | alta |
| **Murano Pro** (`1441580480587007`) | WABA real da empresa; candidata a receber o número oficial | alta que é real; **não confirmado** que contenha número hoje |
| **Murano Cobrança** · **Murano Shop** | desconhecido — 1 pessoa e **1 parceiro** cada | **não investigado** |
| **Henry** · **Atendente Milene Pamplona** | rotuladas "Aplicativo WhatsApp Business" = contas do **app de celular**, não API | alta |

**Anomalia a conferir:** o resumo da *Murano Pro* mostrava **moeda INR (rupia indiana)**,
fuso America/Belem. Corrigir antes de faturar mensagens por essa WABA.

Usuários do sistema: `calling-api` (**Admin**, `61590860137092`, com o app calling-api e
a WABA Murano Pro), `Conversions API System User` (Employee, Pixel) e **`Murano Pulse`**
(Employee, `61592991989302`) — **dono do token permanente** do CRM, criado separado de
propósito para isolar risco (anular tokens de um não derruba o outro). A conta tem limite
de **1 system user Admin**, por isso o nosso é Employee — suficiente, porque o poder vem
dos ativos atribuídos + permissões do token, não do papel.

**Nada foi confirmado como descartável — não desative nenhuma dessas contas ainda.**
Investigar antes, nesta ordem: (1) **onde vive hoje o número de produção** (provavelmente
sob RD/Tallos como *parceiro* de alguma WABA — os "2 parceiros" da Murano Pro são pista,
não prova; desativar às cegas derruba o atendimento real); (2) o que são Cobrança e Shop
e quem é o parceiro de cada uma; (3) se os números de celular dos vendedores (Henry,
Milene) entram no CRM ou seguem fora.

## 17. Ponte de SSO com o hub interno (`/auth/hub-sso`, 11/08/2026)

O `murano-app` (hub interno da Murano, repo separado) passou a embutir este
CRM num `<iframe>` (rota `/crm-externo` de lá, card "CRM" no hub) — decisão
tomada porque a reconstrução do CRM **dentro** do hub (que já tinha Fases 1-3a
prontas) foi pausada em favor de uma solução mais rápida: continuar usando
este app, do jeito que está, só que acessível sem sair do hub.

**O que isso mudou aqui: só uma rota nova, aditiva.** `web/app/auth/hub-sso/route.ts`.
O login por "Entrar com Google" (`/auth/callback`, `web/app/api/login`)
**continua exatamente como está** — indefinidamente, por decisão explícita —
essa rota nova é só um segundo caminho de entrar, pensado para quem já está
autenticado no hub.

**Como funciona:** o hub (que sabe o e-mail de quem está logado nele) assina
um token curto (HMAC-SHA256, payload `{email, exp}` em base64url, TTL de
segundos) com um segredo compartilhado `CRM_HUB_SSO_SECRET` — mesmo valor
configurado na Vercel dos dois projetos — e aponta o `src` do iframe para
`/auth/hub-sso?token=...`. Esta rota verifica a assinatura e o prazo, e a
partir daí faz **exatamente** o que `/auth/callback` faz depois da troca de
código do OAuth: busca `papel`/`carteira`/`ativo` em `acesso` (service_role,
ignora RLS) e seta o cookie `crm_sessao` (+ `crm_email`). Sem `acesso` válido
e `ativo`, cai no mesmo `?erro=nao_autorizado` do fluxo Google.

**Por que o cookie sai com `SameSite=None` aqui e não `Lax` como no
`/auth/callback`:** esta rota carrega dentro de um `<iframe>` cujo documento
de topo é outro site (`app.muranoprofessional.com.br`) — `SameSite=Lax`
(ou ausente, que cai em Lax por padrão) faz o navegador descartar o
`Set-Cookie` nesse contexto, por ser cookie de terceiro. `None` exige
`Secure` (`https`, sempre verdadeiro em produção — por isso não segue o
mesmo `secure: NODE_ENV === "production"` condicional que o resto do app
usa). **Isso não é garantia universal:** navegador com bloqueio total de
cookie de terceiro ligado (Safari com "Impedir rastreamento entre sites" é o
caso mais comum) descarta o cookie mesmo com `None;Secure` — o resultado
nesse caso não é erro, é o iframe cair na tela de login normal do CRM
(comportamento de hoje, sem SSO), nunca uma tela quebrada.

**O que NÃO mudou:** nenhuma tabela, nenhuma policy de RLS, nenhum outro
cookie, nenhuma rota existente. `web/lib/papel.ts` (`tokenDePapel`) é
reaproveitado sem alteração.

**Pendência:** `CRM_HUB_SSO_SECRET` precisa ser gerado (`openssl rand -hex
32` ou equivalente) e configurado idêntico nas duas Vercel (este projeto e
`murano-app`) antes desta rota funcionar em produção — sem a variável, ela
redireciona pra `?erro=oauth` sempre. Teste ponta-a-ponta (hub → iframe →
sessão ativa) ainda não realizado nesta sessão — fazer antes de considerar
a integração pronta pra uso real, mesmo rigor aplicado às outras integrações
deste ecossistema.

## 18. Chat (`/chat`) — o que falta para substituir o painel do RD

> Levantamento de 12/08/2026, comparando o `/chat` atual (seção 11.6) com o que o RD
> Conversas oferece como ferramenta de atendimento em equipe. **O chat hoje é um
> WhatsApp Web funcional, ainda não uma ferramenta de atendimento em equipe** — a
> diferença entre os dois é exatamente o que o RD vende. Esta lista é a régua para
> decidir quando a Fase C pode acontecer sem o time sentir falta do painel antigo.

**Já existe:** lista de conversas em tempo real com escopo por carteira · busca por
nome/telefone · thread com separadores de dia, ticks de entrega/leitura e selo de
template · envio com UI otimista e aviso da janela de 24h · Realtime + poll de
segurança · mobile · identidade Murano.

### ✅ P0 ENTREGUE em 12–13/08/2026 (PRs #56 e #58)

Os cinco itens do P0 estão no ar, mais o maior item do P1. O que mudou de fato:

| Item | Como ficou |
|---|---|
| Mídia — receber | O webhook baixa foto/áudio/vídeo/documento/figurinha na hora (o `media_id` da Meta expira), guarda no bucket **privado `wa-midia`** e grava `midia_*` em `mensagens`. Falha no download **não derruba a mensagem** — ela entra com `midia_id` para reprocessar. `/api/chat/midia` serve por **URL assinada** (302), então `<img>`/`<audio>` apontam direto pra rota |
| Mídia — enviar | `/api/chat/enviar-midia` sobe pela Graph API, espelha no bucket e na tabela. Conversa que ainda vive no RD responde **501 com instrução** (o RD tem outro endpoint de anexo e será aposentado) |
| Não lidas | `chat_leitura` guarda a marca **por usuário** (filas independentes, como no RD). Negrito + bolinha na lista, abas Pendentes/Abertas/Resolvidas com contador, aviso no título da aba (`(3) Chat`), **bipe via WebAudio** e notificação do sistema quando a aba não está à frente |
| Status aberta/resolvida | `chat_conversa` (status + motivo + quem resolveu). O motivo é **a nossa tabulação**, agora no fluxo natural do encerramento. **Reabre sozinha** quando o cliente responde (quem faz isso é o webhook) |
| Template no chat | Botão TEMPLATE na caixa de envio — o aviso de janela fechada não manda mais o usuário ao board |
| **P1: painel do contato** | Coluna direita com o **ERP ao lado da conversa**: código/cidade/RCA, histórico de compra, ciclo de recompra com barra e ação recomendada, etapa no funil, faturado no mês e últimas notas (`/api/chat/contato`). É a vantagem que o RD não tem |

Migration **0079** (a 0077 já estava tomada pela mídia do lado RD, do mesmo dia).

**Duas trilhas de mídia convivem — não confundir:**

| | Canal | Estado |
|---|---|---|
| `midia_*` (0079) | WhatsApp Cloud | completo: baixa, guarda e renderiza |
| `midia jsonb` (0077) | RD Conversas | metadados salvos; **download e transcrição são outra frente**, com objetivo de corpus histórico para consultas/relatórios — **não** para operação do chat (decisão do usuário em 13/08) |

Consequência prática enquanto o número de produção estiver no RD: o áudio real da
cliente aparece no chat como rótulo (`[áudio]`), não como player. Isso é esperado.

### P0 — a lista original (mantida como referência do que foi pedido)

| # | O quê | Por quê / nota de implementação |
|---|---|---|
| 1 | **Mídia — receber** (foto, áudio, documento, sticker) | hoje entra como marcador `[image]`/`[audio]`. Cliente de salão manda foto e áudio o tempo todo; sem isso o vendedor volta pro celular. O webhook entrega `media_id`, que **expira** → baixar para o Supabase Storage e renderizar na bolha |
| 2 | **Mídia — enviar** (ao menos imagem/documento) | upload → Graph API → espelho em `mensagens` |
| 3 | **Não lidas + notificação** | a lista não distingue conversa respondida de pendente. Exige marca de leitura por usuário (`lida_ate`), contador na sidebar, badge no título da aba, som/Notification API |
| 4 | **Status aberta / resolvida** (com motivo) | dá a noção de fila. Substitui o "fechar atendimento" do RD e **é a nossa tabulação**: motivo no encerramento vira a métrica confiável de venda que o RD nunca entregou (ver seções 6 e 8). Reabre sozinha quando o cliente responde |
| 5 | **Template dentro do chat** | hoje o aviso de janela fechada manda o usuário ir ao board — quebra o fluxo. A rota já existe |

### P1 — profissionalismo e produtividade

~~Painel do contato~~ **ENTREGUE** (ver quadro acima).

**✅ Respostas rápidas e notas internas — ENTREGUES em 14/08/2026 (migration 0082,
renumerada de 0080 — ver nota de numeração no fim desta seção).**

| Item | Como ficou |
|---|---|
| Respostas rápidas | Digitar `/` (ou o botão ⚡) na caixa abre a lista; `/atalho` filtra, ↑↓ navega, Enter cola o texto. Alcance duplo: `carteira is null` = **da casa** (todo mundo vê, só admin/home cria) · `carteira = <slug>` = **pessoal** do vendedor. Cria-se salvando o texto que já está na caixa — sem tela de cadastro à parte. Rota `/api/chat/respostas` (GET/POST/PATCH/DELETE) |
| Notas internas | Botão 🗒️ troca a caixa de "mensagem" para "nota"; a caixa muda de cor para deixar óbvio que **aquilo não vai pro cliente**. A nota aparece na thread, no ponto da conversa em que foi escrita, como papel amarelo. Apaga só o autor (ou o admin). Rota `/api/chat/notas` (POST/DELETE); a leitura vem junto do `/api/chat/thread`, que agora devolve `notas[]` e o front intercala pela data |

**⚠️ Correção do que este documento afirmava:** a linha anterior dizia para usar
`crm_templates` como base das respostas rápidas. **Não dá** — aquela tabela guarda
`nome` + `rd_template_id` (o template aprovado na Meta/RD que reabre a janela de
24h) e **não tem coluna de corpo**: o texto mora fora do nosso banco. São conceitos
diferentes com nomes parecidos. Daí a tabela nova `chat_resposta_rapida`.

**Por que `chat_nota` é tabela separada e não uma linha em `mensagens` com
`tipo='nota'`:** `mensagens` é espelho do que trafegou no WhatsApp, escrito por
UPSERT do ETL e do webhook — uma nota ali corre risco de sumir num re-fetch, e
contaminaria os contadores, as views e a régua de "quem falou por último" que
decide a etapa do funil (§11.1). Mesmo raciocínio da §10.11.

**✅ Transferência de conversa e busca no conteúdo — ENTREGUES em 14/08/2026
(migration 0081). Com isso o P1 inteiro está fechado.**

| Item | Como ficou |
|---|---|
| Transferência | Botão **↪ Transferir** no cabeçalho da conversa, com os vendedores ativos de `carteira_config` e um campo de motivo. A passagem aparece na própria thread, no ponto em que aconteceu. Quem pode: o dono efetivo atual, ou admin/home — um vendedor não tira conversa da mão do outro (validado no servidor) |
| Busca no conteúdo | Trigrama (`pg_trgm` + GIN em `mensagens.conteudo`). A busca por nome/telefone continua local e instantânea; abaixo dela, a seção **🔎 Nas mensagens** traz o resultado do servidor, com o trecho recortado e o termo destacado. Mínimo de 3 letras, debounce de 400 ms |

#### Transferir conversa ≠ mudar carteira

São coisas diferentes e confundi-las quebraria o resto do sistema:

| | O que é | Onde mora |
|---|---|---|
| **carteira do cliente** | dono comercial | RCA do WinThor via `wth_vinculo` (§10.3); `clientes.carteira` é espelho do ETL |
| **transferência de conversa** | quem **atende este diálogo agora** | `chat_transferencia`, tabela nossa, só vale dentro do chat |

Por isso a transferência **não** faz update em `clientes`: seria desfeito no
próximo upsert do ETL (§10.11) e desalinharia o board do ERP. É o mesmo recorte
que o RD Conversas faz entre "carteira" e "transferir atendimento". A tela avisa
isso em texto, para ninguém usar o botão esperando trocar a carteira.

`chat_transferencia` é **append-only** — o "registro" pedido no P1 é o histórico
completo, não o estado. A atribuição vigente é a última linha, exposta em
`vw_chat_atribuicao` (`distinct on (cliente_id) … order by criada_em desc`).
Devolver a conversa é só mais uma linha no sentido inverso; nenhum caso especial.

**Dono efetivo = transferência vigente ?? `vw_funil.vendedor`.** Essa régua está
em `web/lib/chatEscopo.ts` e é usada por `/api/chat` **e** `/api/chat/buscar` —
se ficasse duplicada, uma conversa transferida sumiria de uma e apareceria na
outra. Consequência no `/api/chat`: o filtro SQL por carteira não traz o que foi
transferido **para** mim de outra carteira, então essas linhas são buscadas à
parte e juntadas antes do escopo ser aplicado.

**Por que trigrama e não full-text:** quem procura numa conversa digita pedaço de
palavra, nome de produto abreviado e erro de digitação — casos em que
`ILIKE '%termo%'` acerta e o stemming do `to_tsvector('portuguese')` erra. O
preço é exigir 3+ caracteres (abaixo disso o índice não é usado). Medido em
produção com 72.087 mensagens: **0,98 ms**, via `Bitmap Index Scan`. A busca tem
teto de 400 mensagens varridas por consulta e devolve `truncado: true` quando
bate nele — a tela avisa em vez de fingir cobertura completa.

⚠️ O índice GIN entra num caminho de escrita quente: o ETL faz UPSERT em lotes de
500 em `mensagens`. `fastupdate` (ligado por padrão) amortece, mas **se o ETL
ficar mais lento logo depois desta migration, este índice é o primeiro suspeito.**

### P2 — paridade avançada (quando a operação estabilizar)

Indicadores TME/TMA por vendedor (os dados já estão em `mensagens` — vira view) ·
mensagem automática fora do horário (no próprio webhook) · presença anti-colisão
("fulano está nesta conversa", via Realtime Presence) · fila de não atribuídos
(substituto do chatbot de triagem do RD) · reações e resposta citada (`is_reply` já vem
do webhook, falta UI).

**Esforço estimado:** P0 ≈ 3–5 sessões (mídia é o maior bloco); P1 ≈ 2–3; P2 contínuo.

## 19. Ambiente local, segredos e drift de migrations (12/08/2026)

### 19.1 Clone novo não traz `.env` — e a chave JWE tem UMA cópia legível

A pasta de trabalho foi recriada como **clone novo** em 11/08. Código: nada perdido
(remoto em dia, nenhum commit local pendente). Mas arquivos ignorados pelo git **não
vêm**: `.env` da raiz (ETL), `web/.env.local` (app web) e `data/` (descartável).
Isso bloqueia apenas rodar ETL/app **localmente** — produção intacta.

**Ponto de atenção permanente:** `RD_CONVERSAS_PRIVATE_JWK` é mostrada **uma única vez**
pela Tallos e a rotação torna o histórico cifrado ilegível para sempre (seção 3).

#### ⚠️ PENDENTE — guardar os segredos do RD num gerenciador de senhas

**Prioridade alta. Substitui a "ação recomendada" anterior desta seção, que era
impossível de executar** (dizia "revelar na Vercel"; ver correção abaixo).

Onde `RD_CONVERSAS_PRIVATE_JWK` e `RD_CONVERSAS_TOKEN` vivem hoje, verificado em
12/08/2026:

| Local | Dá para ler de volta? |
|---|---|
| GitHub Actions Secrets | **Não** — write-only por design |
| Vercel | **Não** — as variáveis estão marcadas *Sensitive*; "Copy to Clipboard" fica travado e `vercel env pull` não traz o valor |
| Supabase Vault | **Não existem lá** — `vault.secrets` está vazio |
| `wth_config` | **Não estão lá** — só `gh_etl_token`, `gh_etl_repo`, `v2_rest_url`, `v2_service_key` |
| `.env` local da máquina do Romulo | **SIM — única cópia legível conhecida** |

Essa cópia foi recuperada por acaso, de uma pasta antiga do projeto, em 12/08. Se essa
máquina falhar ou o arquivo se perder, **não há de onde tirar a chave outra vez** — e a
única saída seria gerar chave nova na Tallos, o que torna ilegível todo o histórico
cifrado que ainda não foi baixado.

**Ação:** copiar os dois valores do `.env` da raiz para o gerenciador de senhas da
empresa (junto com o `kid` da JWK, para conferência futura). Fecha também a pendência
nº 4 da seção 10.7, aberta desde julho.

Mitigação que reduz o pânico, mas não substitui a ação: todo o histórico **já
decriptado** está no Supabase; perder a chave só impede decriptar mensagens **novas**.

**Correção de fato:** a versão anterior desta seção afirmava que a Vercel era a "única
cópia legível". Está errado — variável marcada *Sensitive* na Vercel é write-only.
Não repetir esse caminho.

### 19.2 Migrations aplicadas no banco sem arquivo correspondente

`supabase_migrations.schema_migrations` tem entradas que **não existem como arquivo** em
`supabase/migrations/` — replay num banco limpo não as reproduz:

| Entrada no banco | Situação |
|---|---|
| `wth_vinculo_origem_aceita_telefone` (06/08) | **coberta**: o `ALTER` foi dobrado dentro do arquivo `0073` como bloco "0)" |
| `0074b_visoes_vinculo_dedup` (06/08) | sem arquivo — conferir com quem aplicou |
| `create_cat_produtos` (06/08) | sem arquivo — conferir |
| `create_scratch_orfaos_2025` (12/08) | sem arquivo; nome sugere tabela temporária — conferir se pode ser descartada |

Convenção a manter: **toda DDL aplicada vira arquivo numerado no repo**, mesmo quando
aplicada primeiro pelo painel/MCP.

### 19.3 Pontas soltas conhecidas

- **`web/app/api/whatsapp/send-test/route.ts` tem telefone hardcoded** numa allowlist,
  em repositório público. Remover junto com a subida do Graph v22 → v26 (seção 16.5,
  item 4) — contraria o espírito da seção 15.5.
- **Migration 0073 deixou 85 contatos sem vínculo**: 81 sem match no WinThor e
  **4 ambíguos** (mesmo telefone em mais de um cadastro), deixados de fora de propósito.
  Os 4 ambíguos precisam de decisão manual.
- **Decisão de 06/08 — não higienizar as tags de carteira no painel do RD** (as 17
  divergentes que a 0073 corrigiu no board): o RD será aposentado e a atribuição oficial
  já é o RCA via `wth_vinculo`. **Não sugerir de novo.**
- **Rename `funil-murano` → `murano-crm` na Vercel: adiado** (05/08) e menos urgente,
  porque a produção é o domínio próprio. Ao renomear, atualizar em cadeia: domínio na
  Vercel, Redirect URLs do Supabase Auth (senão o login Google quebra), docs do repo.
  O webhook da Meta **não** quebra (aponta para o domínio próprio).

## 20. Segunda linha no Cloud API — piloto validado (15/08/2026)

> Primeira linha REAL nossa no WhatsApp Cloud API, rodando **em paralelo** ao número
> oficial. Receber, enviar e mídia validados ponta a ponta. A produção não foi tocada.

### 20.1 As duas contas — não confundir

| | WABA | Número | Papel |
|---|---|---|---|
| **Produção** | Murano Pro `1441580480587007` | +55 91 2018-2357 (`1004405886099218`) | oficial, vendedores atendendo pelo **RD/Tallos**, faturamento em tempo real |
| **Piloto** | Murano Shop `1384896129703324` | +55 91 9806-0032 (`973434089176828`) | linha secundária, canal direto Cloud API |

`chat_linha` (migration 0080) guarda o rótulo de cada `phone_number_id`; o chat mostra
a etiqueta no cabeçalho da conversa.

### 20.2 A armadilha que custou horas: PARCEIRO detém o direito de enviar

Sintoma: **recebíamos** mensagens normalmente pela linha nova, mas todo envio voltava
`(#200) You do not have the necessary permissions to send messages on behalf of this
WhatsApp Business Account`.

Foram verificados e descartados, um a um: token permanente (não expira, com
`whatsapp_business_messaging`), tarefas do usuário do sistema na conta (`MANAGE`),
inscrição do app no webhook (feita), registro do número (`status: CONNECTED`), env
`WHATSAPP_PHONE_NUMBER_ID` (correta) e até re-registro do número com PIN novo.

**A causa era outra:** a WABA Murano Shop tinha um **parceiro (BSP)** atribuído —
"Suri by Chatbot Maker". O parceiro detinha a mensageria da conta; nosso app conseguia
ler, assinar webhook e registrar, mas **não enviar**. Remover o parceiro em
*Contas do WhatsApp → a conta → aba Parceiros* liberou o envio na primeira tentativa.

**A pista que resolveu foi operacional, não técnica:** o usuário notou que o número
respondia sozinho a qualquer mensagem. Se o chatbot enviava, alguém tinha permissão de
envio que nós não tínhamos — e isso apontou direto para o parceiro.

**Regra para a Fase C:** antes de migrar o número oficial, conferir a aba **Parceiros**
da WABA de destino. Um parceiro herdado bloqueia o envio sem dar nenhuma pista no
token, nas permissões ou no número.

**Diagnóstico que fecha isso em minutos** (o `subscribed_apps` também denuncia a
presença do outro app):

```
GET /api/whatsapp/diag?waba=<id>    → números + ids, apps inscritos, permissões, escopo do token
POST /api/whatsapp/diag {acao:"testar-envio", phone_number_id, destino}
```
Comparar a linha suspeita com uma que funciona, usando o MESMO token, isola em uma
tentativa se o problema é do token ou da conta.

### 20.3 Rota `/api/whatsapp/diag` — temporária, com travas

Criada para diagnosticar sem ninguém manusear token (usa o `WHATSAPP_TOKEN` da Vercel).
Protegida por sessão de admin. **Escrita por lista de PERMISSÃO, não de bloqueio** —
lista de bloqueio protegeria só o que alguém lembrou de listar, e qualquer conta nova
nasceria desprotegida:

- `WABAS_ESCRITA_PERMITIDA` — só Murano Shop e a conta de teste;
- `NUMEROS_REGISTRO_PERMITIDO` — só os números de teste/piloto.
- **O número oficial de produção nunca entra nessas listas.**

Remover junto com `send-test` quando a Fase C fechar.

### 20.4 Redução de raio: o token não enxerga mais a produção

Em 15/08 a WABA **Murano Pro foi removida dos ativos do usuário do sistema Murano
Pulse**. Consulta a ela passou a responder erro 100 (sem permissão) — ou seja, o token
do CRM ficou **fisicamente incapaz** de ler ou alterar a conta de produção, em vez de
depender de trava em código. Reatribuir é o mesmo caminho, quando a Fase C começar.

### 20.5 Estado do piloto

Validado em 15/08: **recebimento** (~2 s), **mídia** (foto de 620 KB baixada para o
bucket `wa-midia`), **envio** pela rota do app com espelho em `mensagens` e recibo de
entrega, e **`linha_id`** gravado nos dois sentidos.

Pendências para o piloto valer com clientes reais: app em **modo Ativo** (hoje em
Desenvolvimento — só números da allowlist chegam), política de privacidade e termos
publicados, e template de recontato aprovado. Ver §16.5 e §16.6.

### ✅ P1 COMPLETO e mesclado em 15/08/2026 (PR #61)

Os quatro itens restantes do P1 entraram: **respostas rápidas**, **notas internas**,
**transferência de conversa** e **busca no conteúdo**. Com isso o bloco P1 fecha —
resta o P2.

**Numeração das migrations — resolvida:** duas frentes trabalharam o chat em
paralelo e ambas criaram uma `0080`. Ficou assim:

| Arquivo | O que é |
|---|---|
| `0079_chat_p0_midia_leitura_status.sql` | P0: mídia, leitura, status |
| `0080_chat_linha_multilinha.sql` | linha telefônica por mensagem (`linha_id`, `chat_linha`) |
| `0081_chat_transferencia_e_busca.sql` | transferência + busca (pg_trgm) |
| `0082_chat_respostas_rapidas_e_notas.sql` | respostas rápidas + notas (**renumerada de 0080**) |

Todas já aplicadas no banco. As três do chat são independentes entre si — a ordem
não importa —, mas número duplicado quebraria o replay num banco limpo (§19.2).

**Colisão de nome resolvida no merge:** `linha` passou a significar **linha
telefônica** em todo o projeto (`chat_linha`, `linha_id`, `linhaDeEnvio`). A variável
local do chat que montava a linha do tempo da conversa virou **`linhaDoTempo`**. Ao
mexer nessa tela, manter a distinção.

**O que o `/api/chat/thread` devolve hoje** (as duas frentes convivendo): `mensagens`,
`notas`, `transferencias` e `linha` — o front intercala as três primeiras por data e
usa a última para a etiqueta do número no cabeçalho.

## 21. Chat — P2 COMPLETO (16/08/2026). O chat cobre o que o RD oferece.

PRs #70–#74. Com isso os três blocos do §18 estão entregues: **P0, P1 e P2**.

| Item | Como ficou | Migration |
|---|---|---|
| **Presença anti-colisão** | Canal único de Realtime: cada aba publica em qual conversa está. Aviso no cabeçalho (`👀 Fulano está aqui`) e marcador na lista. Payload **sem e-mail** (canal público, §15.4) e filtro **por rótulo, não por aba** — senão a 2ª aba do próprio usuário (PC + celular) apareceria como "outra pessoa" | — |
| **Fila de não atribuídos** | Conversa sem dono ganha aba própria, visível a **todos**, com botão ✋ Pegar. **Sem tabela nova**: pegar = transferência de ninguém para mim, reusando `chat_transferencia` (append-only), então o histórico de quem puxou sai de graça. Admin/home não têm carteira: veem selo e designam pelo Transferir | — |
| **Indicadores de atendimento** | `/chat/indicadores` — tempo de resposta (mediana, p90, faixas), volume e encerramentos por motivo. Escopo no servidor | 0084 |
| **Mensagem fora do horário** | Config em tabela (horário, dias, texto, intervalo). **NASCE DESLIGADA** — envia a cliente real, ligar é decisão do usuário | 0085 |
| **Reações e resposta citada** | Reação vira atributo da mensagem; citação mostra o trecho original | 0086 |

### 21.1 Decisões de método que sustentam os indicadores

Sem elas o número engana, e engana para melhor — o pior tipo de erro numa métrica de equipe:

- **Uma espera por RAJADA.** Cinco mensagens seguidas da cliente contam como UMA espera. Senão o denominador infla e a métrica vira ficção.
- **Corte de 24h.** Acima disso a janela do WhatsApp fechou: é reengajamento por template, não demora de atendimento.
- **CONTAGENS, não percentuais, na view.** Somar `pct` diário daria peso igual a um dia de 3 respostas e a um de 300.
- **A mediana lidera.** Medido em 30 dias: **mediana 2,1 min contra média 36,5 min** — a média é dominada por poucas esperas longas. E o resumo se chama "mediana **típica do dia**", porque a mediana do período não se deriva das diárias; preferimos o rótulo honesto ao número falsamente preciso.
- **`tipo='auto'` fica FORA do indicador.** Robô respondendo em 2 s de madrugada faria o TME parecer ótimo.

### 21.2 Dois bugs silenciosos que a reação revelou

Reação era gravada como mensagem nova. Consequências que ninguém tinha notado:
1. virava "a última mensagem" → **movia o card de etapa no funil** (§11.1);
2. contava como fala do cliente → **abria uma espera** no indicador de tempo de resposta.

Um polegar levantado mexia no funil e piorava o número do vendedor. Corrigido na 0086 —
mas fica o alerta: **o que entra em `mensagens` alimenta funil, board e métricas**. Antes de
gravar um evento novo ali, verificar se ele é mesmo uma mensagem.

### 21.3 Numeração das migrations (o mapa vale mais que a regra)

Duas frentes trabalharam o chat em paralelo e colidiram duas vezes. Estado final:

`0079` P0 · `0080` linha telefônica · `0081` transferência+busca · `0082` respostas+notas
(renumerada) · `0083` música dos parabéns (renumerada de 0082) · `0084` indicadores ·
`0085` fora do horário · `0086` reações.

O `0083` estava reservado justamente para a frente do ranking, que tinha criado a sua
como `0082` — renumerada em 16/08, sem efeito no banco: lá a migration está registrada
como `ranking_musica_parabens`, sem o prefixo numérico.

### 21.4 O caminho crítico agora NÃO é código

Falta só acabamento técnico (Graph v22→v26; remover `send-test` e `diag`, ambas temporárias).
O que separa o projeto do corte é operacional:

1. Política de privacidade e termos publicados (minuta pronta, §16/relatório)
2. Dados básicos do app → **modo Ativo** (sem isso o piloto só funciona com a allowlist)
3. Template de recontato aprovado na Meta
4. **Time usando o chat em paralelo ao RD por alguns dias.** O que os vendedores
   reclamarem vale mais que qualquer item adivinhado numa lista.
