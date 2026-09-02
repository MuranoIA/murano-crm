# rd-conversas-etl — Brief do Projeto

> Destilado das sessões de exploração (jul/2026). Fonte de verdade portátil entre
> contas/máquinas — mora no git, ao contrário dos transcripts e da memória local.
> Só contém o que foi confirmado contra a conta real da API ou o código do repo.

---

## 0. LEIA PRIMEIRO — você não está sozinho neste projeto

> **Primeiro comando desta sessão, antes de escrever qualquer coisa:**
>
> ```bash
> node scripts/abertura.mjs
> ```
>
> Ele imprime a foto do momento — em que worktree e branch você está, **quais
> arquivos as outras sessões estão mexendo agora**, que portas já estão
> ocupadas, o head do `origin/master`, os PRs abertos e o próximo número de
> migration livre. É derivado do estado real (git, processos, disco), então
> não envelhece como um arquivo mantido à mão envelheceria.
>
> Para abrir uma frente nova: `node scripts/nova-worktree.mjs <nome> <porta>`
> — cria a pasta irmã, a branch a partir de `origin/master`, copia os `.env`
> (que são gitignored e não vêm junto), instala as dependências e imprime a
> mensagem de abertura pronta.

O usuário trabalha com **várias sessões ao mesmo tempo**, em features diferentes,
no mesmo repositório. Você não enxerga as outras. Isso já custou caro em
28/08/2026: dois `next build` sobre o mesmo `.next` o corromperam (`ENOENT` de
manifesto, `ChunkLoadError` numa suíte que estava correta), uma sessão trocou a
branch da árvore com o trabalho não commitado de outra dentro, e um `git status`
com 15 arquivos levou a atribuir a uma sessão o trabalho de outra.

**As regras, e o porquê de cada uma:**

- **Trabalhe só na worktree e na branch que a mensagem de abertura indicar.**
  Cada sessão tem a sua (`git worktree`), com `.next` e porta próprios — é isso
  que impede um build de derrubar o servidor da outra.
- **Branch sempre saindo de `origin/master`.** Nunca commite em branch de outra
  sessão, mesmo que a árvore esteja nela quando você chegar.
- **Ao terminar: PR para `master` (squash).** Nunca push direto.
- **Commite SÓ o que você mexeu.** Se `git status` mostrar arquivo que você não
  tocou, ele é de outra sessão — não inclua. `git diff origin/master` separa;
  a memória de "o que eu editei" não, porque a árvore muda debaixo de você.
- **Migration:** `git fetch` e confira `supabase_migrations.schema_migrations`
  **no banco** antes de escolher o número, e **commite o arquivo sozinho, na
  hora**, para reservá-lo. Este projeto já colidiu duas vezes (§21.3: duas
  frentes criaram `0080`, depois `0082`). O banco é **um só** — duas sessões
  aplicando migration ao mesmo tempo é mais arriscado que duas escrevendo código.
- **Antes de `npm run build`,** veja se outra sessão está buildando o mesmo
  `.next` (`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` mostra a
  linha de comando de cada uma). Se estiver, espere — não mate processo alheio.
- **Arquivos-monstro são serializados, não paralelizados.**
  `web/app/chat/page.tsx` e `web/app/page.tsx` passam de 3.000 linhas e quase
  toda feature encosta neles. Duas sessões ali ao mesmo tempo conflitam sempre.

Se a mensagem de abertura não disser em que worktree trabalhar, **pergunte antes
de escrever** — é mais barato que descobrir depois de quem era o código.

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
  `/v1/wallets`, `/v2/wallets/{nome}/contacts`,
  `/v2/employees/{id}/contacts`, `/v2/employees/{id}/wallet`, `/v1/segmentation/contacts`.
  → **Não existe endpoint para listar contatos por tag/carteira.**
  ⚠️ **Duas correções desta lista, medidas em 19/08/2026 — ver §25.** `/v2/customers`
  (lista) **existe** e responde 200: o que foi testado em jul/2026 e deu 404 foi
  `/v2/contacts`, nome diferente. E **`POST /v2/wallets` escreve** — é a atribuição
  de carteira. `PATCH /v2/wallets/{nome}` também existe (403), mas nenhuma chave de
  contato foi aceita nela.
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

## 22. Ligação por dentro do chat (17/08/2026) — migration 0087

Botão **📞 Ligar** no cabeçalho da conversa, chamada recebida com campainha, e o
registro da ligação como marco na thread. Voz de verdade no navegador (WebRTC)
pela **WhatsApp Business Calling API**.

### 22.1 ESCOPO: só o piloto — e isso é decisão, não limitação temporária

**Decisão do usuário em 17/08/2026: nada de ligação pelo RD ou amarrada a ele.**
A ligação existe apenas onde a conversa **já corre na Cloud API** — hoje, a linha
piloto. Em conversa do RD o botão **não aparece**, e a rota barra com 422
(`foraDoPiloto`), porque a tela pode estar desatualizada mas o servidor não.

Isso descarta explicitamente o desenho anterior, que oferecia um segundo canal
(`tel`, discar pelo celular e só registrar) para cobrir as conversas do RD. Foi
recusado. **Não propor de novo** sem o assunto ser reaberto pelo usuário.

Consequência a ter em mente ao ler números: verificado em 17/08, **92.864
mensagens vieram do RD contra 73 da Cloud**. Ou seja, hoje a ligação alcança uma
fatia mínima da base de propósito — ela cresce sozinha na Fase C, quando o número
oficial migrar. `conversaNaCloud()` já contempla isso: com
`WHATSAPP_ENVIO_PADRAO=true` a ligação passa a valer para todo mundo, sem deploy.

A coluna `chat_ligacao.canal` ainda aceita `'tel'` no CHECK, como reserva — **nada
grava esse valor**. Se for descartado de vez, estreitar o CHECK numa migration
própria.

### 22.2 A assimetria que governa o desenho (não tem como contornar)

**O SDP da outra ponta não volta na resposta HTTP do Graph — chega pelo webhook.**
São processos diferentes, e nenhum dos dois é a aba do navegador que está com o
microfone aberto. Não existe caminho `await` para isso. A ponte é:

```
navegador faz a oferta -> POST /api/chat/ligacao -> Graph
                                                     |
   webhook recebe o `answer`  ->  grava em chat_ligacao.sdp_remoto
                                     |
   trigger da 0087 -> realtime.send(topic 'ligacao', só o call_id)
                                     |
   navegador ouve -> GET /api/chat/ligacao/acao?call_id= -> aplica o SDP
```

**O broadcast NÃO leva `cliente_id`.** O canal é público (mesma razão do `board`,
§15.4) e `cliente_id` pode ser `wa:<telefone>` — ou seja, PII. Vai só o `call_id`,
que é id opaco da Meta; quem quiser saber de quem é passa pela rota, que autoriza
no servidor. Mesma régua de escopo do resto do chat (`lib/ligacao.ts` reusa
`donoEfetivo` de `chatEscopo.ts`).

Duas armadilhas de WebRTC já pagas, em `lib/webrtcLigacao.ts`:
- **ICE não-trickle.** O Graph aceita UM SDP completo, não candidatos avulsos —
  não há endpoint para "mais um candidato". É preciso esperar a coleta terminar
  antes de enviar. Sem isso a chamada conecta e fica **muda dos dois lados**.
- **`track.stop()` no fim.** Sem ele a luz do microfone continua acesa depois de
  desligar, e o usuário acha — com razão — que ainda está sendo ouvido.

### 22.3 O que NÃO entrou em `mensagens`, e por quê

Ligação tem tabela própria (`chat_ligacao`). Uma linha em `mensagens` viraria "a
última mensagem" da conversa, **moveria o card de etapa no funil** (§11.1) e
**abriria uma espera** no indicador de tempo de resposta (§21.1) — exatamente os
dois bugs silenciosos que a reação causou e a 0086 corrigiu (§21.2). A regra
daquela seção vale aqui: **antes de gravar um evento em `mensagens`, verificar se
ele é mesmo uma mensagem.**

### 22.4 Desfecho — a tabulação por voz

Ao encerrar, a tela pergunta **no que deu** (venda / follow-up / sem interesse /
não atendeu / caixa postal / outro) e aceita observação. Aparece também quando é
**a cliente que desliga** — que é o caso mais comum numa ligação de saída; sem
isso a ligação mais frequente ficaria sem registro. Mesma lógica do motivo ao
resolver a conversa (§18 item 4), e pelo mesmo motivo: é o campo que transforma
"liguei" em dado.

### 22.5 O CRM roda em IFRAME — e isso bloqueia o microfone (17/08/2026)

Sintoma: clicar em 📞 Ligar devolvia na hora "permissão de microfone negada",
**sem o navegador nunca ter perguntado**. A pista que fecha o caso está no painel
de permissões do site: havia Som, Cookies e Configurações — e **nenhuma entrada
de Microfone**. Permissão negada pelo usuário apareceria ali.

Causa: em **iframe cross-origin** o padrão do navegador para `microphone` é
`self`, ou seja, só o site do topo. O CRM é embutido pelo hub (§17), então sem o
pai delegar a permissão o `getUserMedia` é recusado com **`NotAllowedError` e sem
prompt**. O erro é idêntico ao de "o usuário clicou em bloquear", mas a solução é
o oposto: **não há nada que o usuário possa liberar no cadeado.**

Correção — é no **hub** (`murano-app`), não aqui, em
`packages/feature-crm-externo/src/CrmExternoFrame.tsx`:

```diff
-      allow="clipboard-write"
+      allow="clipboard-write; microphone; autoplay"
```

`autoplay` junto porque o áudio da outra ponta toca num `<audio>` criado por
script, e dentro de iframe isso também é política delegada.

Do nosso lado, `microfoneBloqueadoPeloQuadro()` (em `lib/webrtcLigacao.ts`)
distingue os dois casos por `document.permissionsPolicy.allowsFeature` e troca a
mensagem — senão a próxima pessoa perde a mesma hora caçando uma opção que não
existe no cadeado. Saída de emergência enquanto o hub não for corrigido: abrir
`crm.muranoprofessional.com.br` direto, fora do hub.

**Regra geral que fica:** qualquer recurso que dependa de permissão do navegador
(microfone, câmera, notificação, área de transferência, geolocalização) precisa
ser delegado no `allow` do iframe do hub. O CRM não tem como se autoconceder.

### 22.6 Chamada RECEBIDA funciona; a de SAÍDA exige pedir autorização (17/08)

**Validado em produção no mesmo dia:** três chamadas de entrada foram recebidas,
tocaram no navegador, foram atendidas e conectaram áudio (10s, 10s, 2s), com
registro completo em `chat_ligacao`. A cadeia webhook → trigger → Realtime →
WebRTC está de pé.

**A de saída barra em permissão**, e aqui mora uma armadilha de documentação:

> A doc da Meta diz que `callback_permission_status: ENABLED` faz o cliente
> conceder permissão automaticamente **ao ligar para o negócio**.
> **Não foi o que aconteceu.** Com o interruptor ligado e TRÊS chamadas do
> cliente recebidas e atendidas, `GET /call_permissions` seguiu devolvendo
> `no_permission`. A hipótese mais provável é que a concessão automática valha
> para chamada **não atendida** (é permissão de *retorno*, para ligar de volta a
> quem se perdeu) — mas isso não foi confirmado. **Não confie nesse caminho.**

O caminho que funciona é o que a própria API aponta na resposta:

```json
{"permission":{"status":"no_permission"},
 "actions":[{"action_name":"send_call_permission_request",
             "can_perform_action":true,
             "limits":[{"time_period":"PT24H","max_allowed":1},
                       {"time_period":"P7D","max_allowed":2}]}]}
```

`pedirPermissaoDeChamada()` envia um cartão interativo
(`interactive.type = call_permission_request`); a cliente toca em Permitir e a
resposta volta pelo webhook como `interactive.call_permission_reply`. No chat,
o erro de permissão vira um botão **Pedir autorização** em vez de um beco sem
saída.

Dois limites que moldam o uso: é **mensagem livre** (vale a janela de 24h, dá
131047 fora dela) e a cota é **1 por dia, 2 por semana por cliente** — por isso
o pedido é um clique consciente, e o cartão enviado é espelhado em `mensagens`
para o vendedor ver que já pediu.


### 22.6.1 `131044` — forma de pagamento (o bloqueio real, 17/08)

Com a permissão já concedida, discar passou a devolver:

```json
{"message":"Business eligibility payment issue for calling",
 "code":131044, "error_subcode":2593115,
 "error_user_title":"Business eligibility payment issue"}
```

**Toda chamada é cobrada por minuto** (~US$ 0,0108 no Brasil). Diferente das
mensagens, em que conversa de serviço é gratuita, a Meta exige meio de pagamento
válido na conta e **recusa antes de discar** se não houver como faturar. Resolve-se
no Gerenciador de Negócios → Configurações de pagamento, vinculando um cartão à
WABA do piloto.

Verificado que **não é versão do Graph**: `v23.0` e `v26.0` devolvem o erro
idêntico. A hipótese foi levantada e descartada com teste, não com opinião.

Lado bom do diagnóstico: o erro só aparece DEPOIS de permissão e validação de SDP,
ou seja, todo o resto do caminho está correto.

#### ⚠️ O bug que escondeu isso por horas — não repetir

A tela mostrava `Graph 131044:` e parava no dois-pontos. Causa: a Meta manda
`error_data.details` como **string VAZIA** nos erros de chamada, e o código fazia
`e.error_data?.details ?? e.message`. O `??` só cai adiante em `null`/`undefined`
— **string vazia vence** e a explicação real era descartada. Neste erro específico
`error_user_msg` também vem vazio; o texto útil está em `message` e
`error_user_title`.

**Regra:** ao formatar erro do Graph, juntar `error_data.details`,
`error_user_title`, `error_user_msg` e `message`, filtrando vazios — nunca `??`
entre eles. Vale para `lib/whatsapp.ts` e `lib/whatsappCalling.ts`, corrigidos nos
dois. Os códigos de chamada (1380xx) e alguns 131xxx **não estão na documentação
pública** — o texto que a Meta manda é a única pista, e perdê-lo custa horas.

#### Códigos de erro de chamada — OBSERVADOS, não documentados

A faixa `138xxx` e parte da `131xxx` **não existem na documentação pública**
(a lista oficial salta de 131042 para 131045). Cada um destes custou uma
reprodução ao vivo:

| Código | O que É de verdade | Quem resolve |
|---|---|---|
| `138000` | **calling não habilitado nesta linha** | admin, em `/admin` → Linhas |
| `138006` | cliente não autorizou receber ligação | pedido de autorização |
| `138008` | SDP inválido | código (nosso) |
| `138018` | pré-requisitos não atendidos (falta assinar `calls`) | painel da Meta |
| `131044` | **conta não apta a faturar chamadas** | financeiro |

⚠️ **Uma versão anterior deste código tratava `138000` como "cliente não
autorizou".** Era chute pela faixa, e é falso — `138000` é problema NOSSO de
configuração. Confundir os dois manda o vendedor pedir autorização ao cliente
quando o que falta é um interruptor de admin. Corrigido; a régua agora é `138006`.

#### Sandbox × linha real — a distinção que engana

"Estamos só testando" **não** dispensa o pagamento, porque a linha piloto
(`+55 91 9806-0032`) é um **número real numa WABA real**. O sandbox é o outro, o
`+1 555 671 6653` da conta de teste da Meta. Comprovado em 17/08 discando pelas
duas com o mesmo payload:

| | linha piloto (real) | linha de teste (sandbox) |
|---|---|---|
| erro ao discar | `131044` faturamento | `138006` permissão — **passou do faturamento** |
| cota de pedidos | 1/dia · 2/semana | 25/dia · 100/semana |

Por que só agora apareceu: mensagem de serviço (iniciada pelo cliente) é
**gratuita**, então a conta nunca gerou fatura. Ligação é cobrada por minuto e não
tem faixa gratuita — é a primeira coisa que exige meio de pagamento.

**Consequência prática:** dá para validar a chamada de saída ponta a ponta **sem
custo** pela linha de teste, que só alcança números da allowlist. Serve para
provar o fluxo; não serve para cliente real.

#### Quem paga o quê — e o caminho gratuito

Regra da Meta, confirmada na documentação de preços:

| | custo |
|---|---|
| chamada **iniciada pelo cliente** (entrada) | **gratuita**, qualquer duração |
| chamada **iniciada pelo negócio** (saída) | por minuto, cobrada **só se atendida**, em pulsos de 6s |

Isso explica por que a entrada funcionou em 17/08 sem nenhum meio de pagamento
na conta, e a saída não: **não há o que faturar na entrada.**

**Consequência operacional, enquanto não houver cartão:** o CRM já tem voz útil.
Com `call_icon_visibility: DEFAULT` (ligado junto com o calling), o ícone de
telefone aparece no WhatsApp de todo cliente da linha, ele liga, e a chamada toca
no chat com campainha. O recado do erro `131044` aponta esse caminho em vez de
apenas informar o bloqueio.

Não existe contorno para a chamada de SAÍDA a cliente real sem meio de pagamento
— é regra de cobrança da plataforma, não limitação do nosso código.

### 22.7 Pré-requisitos na META — nada disso é código

O código está pronto e o build passa. Para a chamada funcionar de fato:

1. **Limite de mensagens ≥ 2.000/24h** na WABA. Exigência da Meta para calling.
2. **Assinar o campo `calls`** no webhook. Assinar `messages` **não** assina
   `calls` — é a mesma armadilha nº 3 da §16.4, agora para chamadas.
3. **Ligar calling na linha**: `/admin` → aba Linhas → *Chamadas de voz*
   (`/api/admin/ligacao`). **Não vem ligado.** A rota age somente sobre
   `WHATSAPP_PHONE_NUMBER_ID` e nunca aceita a linha por parâmetro — mesmo
   recorte da §20.3, para o número oficial não ser alcançável nem por engano.
4. **App em modo Ativo** (§21.4 item 2): em Desenvolvimento só a allowlist toca.
5. **Verificar a aba Parceiros da WABA** (§20.2): parceiro herdado bloqueou o
   *envio* uma vez sem dar pista nenhuma; não há razão para supor que a voz
   escape disso.

**Limite de chamada iniciada pelo negócio: 1 por dia e 2 por semana por par
(número, cliente)** — precisa de permissão do cliente. Cliente que **liga para
nós** concede automaticamente (`callback_permission_status`, ligado junto com o
interruptor). A rota consulta a permissão **antes** de discar e devolve 422 com
recado, para o vendedor não descobrir a recusa depois de já ter aberto o
microfone. Brasil permite chamada iniciada pelo negócio (EUA, Canadá, Egito,
Vietnã e Nigéria, não).

Custo: ~US$ 0,0108/min de conectividade Meta.

**Graph v23.0 para chamada**, em constante separada (`lib/whatsappCalling.ts`):
a Calling API não existe na v22.0 que as mensagens usam, e subir a versão do
envio (§16.5 item 4) é mudança de risco próprio — não deve ser arrastada por esta.

### 22.8 Arquivos

| Arquivo | Papel |
|---|---|
| `supabase/migrations/0087_chat_ligacao.sql` | tabela, `vw_chat_ligacao_ativa`, trigger de Realtime |
| `web/lib/whatsappCalling.ts` | Graph: connect/pre_accept/accept/reject/terminate, permissão, settings |
| `web/lib/webrtcLigacao.ts` | `RTCPeerConnection` no navegador (só o áudio) |
| `web/lib/ligacao.ts` | escopo, telefone E.164, `conversaNaCloud`, cálculo de encerramento |
| `web/app/api/chat/ligacao/route.ts` | listar / iniciar / encerrar |
| `web/app/api/chat/ligacao/acao/route.ts` | sinalização: estado+SDP, atender, recusar, desligar |
| `web/app/api/admin/ligacao/route.ts` | interruptor de calling na linha (admin) |
| `web/app/chat/ligacao.tsx` | hook + telas (botão, barra, campainha, desfecho, marco) |
| `web/app/api/whatsapp/webhook/route.ts` | passou a tratar o campo `calls` |

`ligacao.tsx` mora fora de `page.tsx` de propósito: aquela tela passa de 1.500
linhas e é mexida por mais de uma frente ao mesmo tempo — o chat encosta na
ligação por três pontos apenas (o hook, as camadas flutuantes e o marco).

## 23. Dois números em paralelo — o que trava, o que não trava (18/08/2026)

> Objetivo declarado pelo usuário nesta data, corrigindo o plano anterior:
> **manter RD e Cloud API rodando ao mesmo tempo, dois números, por tempo
> indeterminado.** A Fase C (§16.5) continua sendo o futuro, mas **não é o alvo
> agora** — não propor corte do RD como próximo passo.

### 23.1 Estado real da linha piloto, medido na Graph API (não é do painel)

Consultado com o token do system user Murano Pulse (`whatsapp_business_management`):

| Checagem | Resultado |
|---|---|
| WABA Murano Shop `1384896129703324` | `account_review_status: APPROVED`, negócio verificado |
| Número `973434089176828` (+55 91 9806-0032) | `status: CONNECTED`, **`account_mode: LIVE`** |
| Nome de exibição | **"Murano Professional" — `name_status: APPROVED`** |
| `health_status.can_send_message` | **AVAILABLE** em PHONE_NUMBER, WABA, BUSINESS **e APP** |
| `subscribed_apps` | só Murano Pulse (o BSP Suri saiu mesmo, §20.2) |
| `/settings` | calling `ENABLED`, `callback_permission_status: ENABLED` |
| Templates aprovados na WABA | 4, herdados do chatbot (`saida_do_john`, 3 de shop) — **nenhum serve de recontato** |

⚠️ **Correção do §21.4 item 2.** Aquele item dizia que sem o app em modo Ativo
"o piloto só funciona com a allowlist". Isso vale para o número **de teste** da
Meta (`+1 555 671 6653`, `account_mode: SANDBOX`). A linha piloto é número real
em WABA real, `LIVE`, e a própria Meta reporta o **APP** como apto a enviar.
**O teste com um número fora da allowlist foi feito pelo usuário em 18/08 e
funcionou** — o modo Desenvolvimento não está bloqueando mensagem.

O único `BLOCKED` do `health_status` é `can_receive_call_sip` (138024/138025):
irrelevante, a ligação usa WebRTC, não SIP.

**Diagnóstico que fecha isso em um comando** — vale mais que qualquer print:
`GET /v23.0/<phone_number_id>?fields=health_status,account_mode` diz, em uma
resposta, se o bloqueio é do número, da conta, do negócio ou do app.

### 23.2 O que de fato falta (ordem real, sem o "modo Ativo" na frente)

1. **Meio de pagamento na WABA Murano Shop.** É o bloqueio comprovado — é ele
   que devolve `131044` na ligação de saída (§22.6.1). Mensagem de serviço
   (iniciada pelo cliente) é gratuita, então o piloto funciona **reativo** sem
   cartão; iniciar por template e ligar para fora, não. Os 4 templates já
   aprovados eram faturados pelo BSP que saiu — a conta agora é nossa.
2. **Template de recontato** + `WHATSAPP_TEMPLATE_RECONTATO` na Vercel. Sem ele
   o botão TEMPLATE responde **501** em conversa do canal Cloud.
3. **Modo Ativo** — higiene, não bloqueio: política de privacidade, termos,
   ícone, categoria e exclusão de dados (§16.6). As duas URLs já existem (23.3).

**Não ligar `WHATSAPP_ENVIO_PADRAO=true`**: esse é o interruptor da Fase C e
jogaria TODA conversa para o Cloud, quebrando o atendimento do número oficial.
O roteamento por conversa (`canalDeResposta`) já sustenta os dois números.

### 23.3 Páginas legais públicas (migration 0088)

`/privacidade` e `/termos` — as **únicas telas sem login** do sistema (a Meta
precisa lê-las; o cliente também). O **texto mora no código**, versionado; as
**variáveis moram no banco** (`paginas_legais`, linha única id=1), editáveis em
**/admin → 📄 Páginas legais**. A separação não é preciosismo: quem sabe o CNPJ
certo é o financeiro, não quem faz deploy — se exigisse commit, ficaria errado
por meses.

| Arquivo | Papel |
|---|---|
| `supabase/migrations/0088_paginas_legais.sql` | tabela de linha única, RLS ligado sem policy |
| `web/lib/paginasLegais.ts` | leitura (service_role), padrões, `pendencias()` |
| `web/app/legal.tsx` | moldura compartilhada (não é rota: só `page.tsx`/`route.ts` viram rota) |
| `web/app/privacidade/page.tsx` · `web/app/termos/page.tsx` | o texto, `force-dynamic` |
| `web/app/api/admin/paginas-legais/route.ts` | GET/PUT + as URLs para colar na Meta |

Duas decisões que valem manter:
- **Campo vazio some da página**, não vira "CNPJ: —". Publicar traço numa
  política é pior que omitir a linha; a cobrança do que falta aparece no
  /admin, onde só nós vemos (`pendencias()`).
- **Exclusão de dados é seção da política** (`/privacidade#exclusao-de-dados`),
  não página separada: instrução solta envelhece e passa a contradizer o
  documento principal.

`force-dynamic` porque correção de CNPJ tem que aparecer na hora — cache
estático faria o admin salvar e a página seguir mentindo.

### 23.4 Filtro por NÚMERO no chat (migration 0089)

A sidebar misturava os dois números; agora tem seletor **📱 Todos · Murano Pro ·
Murano Shop**, com contador, que **cruza** com as filas (Pendentes/Abertas/…) em
vez de substituí-las — "pendentes do Murano Shop" é pergunta frequente.

**O número do RD virou linha de verdade no cadastro.** `chat_linha` só conhecia
linhas da Cloud (o `linha_id` nasce do webhook da Meta; conversa do RD tem
`linha_id` nulo) — então o número oficial não tinha rótulo e ficava implícito no
"resto". Recebeu o id sintético **`'rd'`**, no mesmo espírito de `wa:<numero>` e
`winthor:<codcli>` (§16.3).

⚠️ **`'rd'` não é phone_number_id** — nada que fale com a Graph API pode
recebê-lo. Envio segue decidido por `canalDeResposta` + `WHATSAPP_PHONE_NUMBER_ID`;
a 0089 não toca nisso.

`vw_chat_linha_cliente` só olha mensagens **com** `linha_id`, usando o índice
parcial `idx_msg_linha` que já existia — custa proporcional ao volume da Cloud
(39 mensagens hoje), não às 94 mil do RD. Ausente da view = conversa do RD.
Regra: a conversa pertence à **última linha que carimbou** uma mensagem dela;
como a migração de número é de mão única, "teve linha" e "está na linha" não
divergem na prática.

### 23.5 Filtro por VENDEDOR no chat

O board já deixava admin/home verem uma carteira por vez; o chat não. Agora tem
a mesma coisa: chips 🧑‍💼 na sidebar, com a bolinha de cor de `carteira_config` e
o contador de cada carteira.

Três decisões que evitam número mentiroso na tela:

1. **Os dois seletores cruzam entre si e com as filas.** "Pendentes do Murano
   Shop da Kamilly" é uma pergunta legítima. Cada chip conta **dentro** do que o
   outro já escolheu (`baseVend` / `baseLinha`), senão o chip promete 12 e a
   lista mostra 3.
2. **Os contadores das filas passaram a seguir os seletores** (`noEscopo`).
   **O badge do título da aba (`naoLidas`) continua global de propósito** — ele
   avisa que chegou mensagem e não pode calar porque alguém filtrou a tela.
3. **A fila de espera escapa do filtro por vendedor.** Conversa sem dono não
   pertence a carteira nenhuma; escondê-la ao escolher um vendedor faria sumir
   justamente o que qualquer um pode pegar.

Os chips não aparecem para quem tem papel `vendedor`: a lista dele já vem
filtrada no **servidor** (`/api/chat`), então "Todos" e o próprio nome seriam a
mesma lista. Só são desenhados quando há mais de uma carteira com conversa —
e a lista de carteiras vem das conversas, não de `carteira_config`, para não
oferecer chip que filtra para o vazio.

A busca no conteúdo respeita o filtro de vendedor (o servidor devolve o dono
efetivo) e **não** respeita o de número: aquele resultado vem de `mensagens` sem
passar pela view de linha, e um palpite ali seria pior que trazer a conversa e
deixar o cabeçalho dizer por qual número ela corre.

## 24. Criar template do WhatsApp por dentro do sistema (18/08/2026) — migration 0090

**Pergunta que originou isto: "como o RD faz?" A resposta é que não dá para
espelhar.** A API do RD Conversas **não tem endpoint de template** (404 em nove
variantes, §2) — lá o template só nasce pelo painel deles, que por baixo faz o
que qualquer parceiro faz: submete à Meta e espera aprovação. Consequência que
estava no nosso banco sem ninguém notar: `crm_templates` guardava `nome` +
`rd_template_id`, ou seja, **um ponteiro** — o texto nunca esteve conosco.

Na Cloud API o cadastro é NOSSO, então a criação passou a ser possível aqui.

### 24.1 Verificado ao vivo antes de construir

- **A WABA Murano Shop está com ZERO templates.** Às 14h de 18/08 havia quatro
  (`saida_do_john` + três de shop, herdados do BSP Suri); horas depois, nenhum.
  Confirmado que não é token nem conta: a WABA responde e a conta de teste ainda
  lista o `hello_world`. Provavelmente foram embora com o parceiro removido
  (§20.2). **Corrige a afirmação da §23.1.**
- **Resumable Upload funciona com o nosso token de system user.** É o caminho da
  imagem de cabeçalho, e é o que costuma travar: `POST /<app_id>/uploads` abre a
  sessão, um segundo POST manda os bytes e devolve o `header_handle`.
  ⚠️ A primeira chamada **tem que ser POST** — com GET o Graph responde
  `(#100) Tried accessing nonexisting field (uploads)`, que parece falta de
  permissão e não é.

### 24.2 O desenho

| Peça | Papel |
|---|---|
| `supabase/migrations/0090_templates_cloud.sql` | estende `crm_templates`: `canal`, `meta_nome`, `corpo`, `cabecalho_*`, `imagem_path`, `usa_nome`, `status`, `motivo_recusa` |
| `web/lib/whatsappTemplates.ts` | upload da imagem, criação, status e remoção na Meta |
| `web/app/api/admin/templates-whatsapp/route.ts` | GET (lista + sincroniza status) · POST (multipart) · PATCH (ativo/padrão) · DELETE |
| `/admin` → aba **📨 Templates** | criar com texto e imagem opcional; lista com status e motivo de recusa |
| `web/app/api/send-template/route.ts` | ramo Cloud passou a ler o cadastro em vez da env |

**Duas coisas convivem e não podem ser confundidas:** linhas `canal='rd'` são
ponteiros para o painel do RD (sem texto, sem status — `status` fica NULO de
propósito: preencher "aprovado" seria inventar); linhas `canal='cloud'` são
cadastro completo nosso. Mesma regra dos dois números (§23).

### 24.3 Decisões que evitam bug silencioso

- **A imagem vai para DOIS lugares, e os dois são necessários.** O `header_handle`
  da Meta serve para **aprovar** (é o exemplo que o revisor vê); o arquivo no
  bucket privado `wa-midia` é o que será **enviado** a cada disparo, por URL
  assinada gerada na hora. Handle não envia, link não aprova — trocar um pelo
  outro quebra em momentos diferentes, e o segundo só falha em produção.
- **`usa_nome` é coluna, não palpite.** Mandar parâmetro de corpo para template
  sem variável — ou o contrário — é erro 132000 na Meta. O envio monta os
  componentes a partir do cadastro.
- **Só `{{1}}` (primeiro nome) é aceito.** É a única variável que o envio sabe
  preencher; permitir `{{2}}` produziria template aprovado e inenviável.
- **Grava no banco só depois que a Meta aceita.** O contrário deixaria template
  fantasma na lista, e alguém tentaria enviá-lo.
- **O status é reconsultado a cada abertura da tela.** A Meta não avisa quando
  aprova; sem isso o admin olharia "em análise" para sempre. Falha na consulta
  não derruba a listagem — mostra aviso de que o status pode estar velho.
- **`WHATSAPP_TEMPLATE_RECONTATO` virou fallback legado.** A fonte é a tabela;
  o erro 501 agora distingue três casos com ações opostas: nenhum template,
  em análise, ou vários aprovados sem padrão.

### 24.4 Limites da Meta que a tela já cobra

Corpo 1024 · rodapé 60 · cabeçalho de texto 60 · imagem JPEG/PNG até 5 MB ·
**um cabeçalho por template** (imagem OU texto — deixar os dois passarem faria a
recusa acontecer lá, minutos depois, sem explicação). Apagar é irreversível e o
nome fica **bloqueado por 30 dias**, por isso a tela pede confirmação.

### 24.5 Pré-requisito

`WHATSAPP_WABA_ID` precisa existir na Vercel (§16.3 diz que sim; **não
reconferido**). Sem ela a rota responde erro claro em vez de criar em conta
errada. O token do CRM não enxerga a WABA de produção desde 15/08 (§20.4), então
o raio de escrita é a linha piloto por construção.

## 25. Gestão de Carteira — transferir contato entre carteiras pela API (19–20/08/2026)

Tela `/carteira` (admin), migration 0092. Move contatos entre carteiras **no RD
Conversas**, em massa, sem abrir o painel deles.

### 25.1 O contrato — descoberto por sondagem, não por documentação

```
POST /v2/wallets  { customer: "<_id do contato>", wallet: "<nome de exibição>" }  -> 204
```

Cada linha abaixo custou uma medição ao vivo. O caminho "óbvio" está errado
inteiro — inclusive num spec que chegou pronto e teria sido implementado como veio:

| Tentativa | Resposta | Leitura |
|---|---|---|
| `PATCH /v2/customers/{id}` | 404 **texto cru** | rota inexistente (era o que o spec mandava usar) |
| `PATCH /v2/contacts/{_id}` | 404 `{"error":"Customer not found"}` | rota existe, mas a chave **não** é o `_id` |
| `PATCH /v2/contacts/{telefone}` | **200** `{"customerId":...}` | edita o contato de verdade (o `email` mudou e reverteu)… |
| ↳ com 9 nomes de campo de carteira | 200, **nenhum efeito** | …e **ignora carteira em silêncio** |
| `POST /v2/wallets {}` | 403 `{"message":"Contato Inválido"}` | **a rota certa** |
| ↳ `{customer:"<telefone>"}` | 403 Contato Inválido | a chave é o `_id`, não o telefone |
| ↳ `{customer:"<_id>"}` | 404 `Carteira não localizada` | validação em 2 etapas: contato, depois carteira |
| `DELETE /v2/wallets[/{nome}]` | 404 texto cru | **não há remoção** |

**A distinção que resolve o diagnóstico:** rota inexistente devolve `Not Found`
em **texto cru**; rota que existe devolve **JSON**. Foi isso que separou
`/v2/customers` (morto) de `/v2/contacts` (vivo) e achou o `/v2/wallets`.

Quatro regras que caem daí:

1. **`employee_id` não é carteira.** `employee` é quem atendeu; a carteira é
   `current_wallet` (§4, §10.3). Mandar `employee_id` mudaria a coisa errada.
2. **`customer` é o `_id`** do contato — que é o mesmo `clientes.id` do Supabase,
   então não há lookup extra.
3. **`wallet` é o nome de exibição** (`"Milene Pamplona"`), não o slug. O slug sai
   da primeira palavra em minúscula, **regra idêntica à do ETL** — se divergir, o
   slug não casa com `clientes.carteira` e a tela mostra vazio. Os 7 casaram.
4. **Não existe "sem carteira".** Dá para mover entre carteiras, nunca para nulo.
   `wallet` nulo ou ausente devolve `Carteira não localizada`. A tela avisa antes
   de confirmar, porque é decisão sem volta pela API.

### 25.2 O espelho local TEM de ser escrito aqui — e isso contraria a regra geral

O §10.11 diz para não escrever em `clientes` porque o ETL sobrescreve. **Para
`carteira`, o ETL não sobrescreve — ele nunca reescreve.** Verificado em
19/08/2026: `clientes.set(...)` em `src/etl/run.ts` mora dentro do laço dos
**`novos`**; contato já conhecido é filtrado antes por `carteirasConhecidas()` e
pula a checagem que traria o `current_wallet` atual. Vale no incremental **e** no
full.

Consequência que vale para muito além desta tela: **mudança de carteira feita no
RD — pela API ou pelo painel, por qualquer pessoa — nunca chega ao nosso banco.**
O board, o chat e o funil seguem mostrando o vendedor antigo indefinidamente. Por
isso a rota faz *dual write*: RD primeiro (fonte da verdade), espelho depois.

Fica em aberto o inverso: trocas feitas **direto no painel do RD** continuam
invisíveis. A correção seria um job de reconciliação relendo `current_wallet` —
1 chamada por cliente, ~1h40 para os 4.842 na cota atual, então job próprio e
esparso, não dentro do ETL.

### 25.3 Carteira ≠ RCA — a tela mexe em dois dos três lugares

| Onde | O que é | Esta tela |
|---|---|---|
| `current_wallet` no RD | dono comercial no atendimento | **escreve** |
| `clientes.carteira` | espelho do CRM | **escreve** |
| RCA do WinThor (`wth_carteira`) | dono comercial no ERP | **não toca** |

O ERP está fora de alcance por decisão, não por esquecimento: o
`murano-clientes-v2` é somente leitura (§10.1) e `wth_carteira` é reescrita por
upsert a cada 10 min pelo `wth-sync-tudo` — edição local ali dura no máximo dez
minutos. Logo, **cada transferência acende uma linha em
`vw_divergencia_carteira`** até alguém ajustar o WinThor. A confirmação diz isso
em texto, para ninguém usar o botão achando que trocou o RCA.

⚠️ `vw_divergencia_carteira` está com **432 linhas** (20/08/2026) contra 23 em
julho (§10.7). O salto é anterior a esta tela e **não foi investigado**.

### 25.4 Lote: o limite é a cota, e ela é dividida

~48 chamadas/min (§14.5), compartilhadas com ETL e envios do board. Uma carteira
de 800 contatos leva ~17 min — não há como acelerar, só como não mentir sobre isso:

- a rota processa o que couber em **60s** e devolve `restantes`; o front reenvia
  até esvaziar, com barra de progresso. Mesmo padrão de orçamento do ETL.
- **retentativa em 429 e 5xx** dentro da chamada: com a cota dividida, 429 no meio
  do lote é esperado, não excepcional — sem isso um pico do ETL marcaria dezenas
  de clientes como "falha" quando faltava só esperar.
- a lista de carteiras é **cacheada 5 min**: sem isso, cada bloco gastaria uma
  chamada só para reler oito nomes.
- falha por dado errado (403 contato, 404 carteira) **não** é repetida — não
  melhora com espera. O front oferece repetir só as falhas, e repetir é seguro:
  reatribuir à mesma carteira devolve 204.

### 25.5 `carteira_transferencia` ≠ `chat_transferencia`

Colunas quase idênticas, significados opostos. `chat_transferencia` (0081) é
**quem atende a conversa** e alimenta o dono efetivo em `/api/chat` — gravar
carteira ali faria conversas sumirem da caixa de um vendedor e brotarem na de
outro, e mexeria na fila de não atribuídos (§21). A tabela nova registra a
escrita que aconteceu **lá fora**, na API do RD.

Ela tem `sucesso`/`erro`, que a 0081 não tem: aqui cada linha é uma chamada de
rede a terceiro dentro de um lote que pode falhar no meio, e registrar só o que
deu certo esconderia justamente o que o supervisor precisa ver.

### 25.6 Arquivos

| Arquivo | Papel |
|---|---|
| `supabase/migrations/0092_carteira_transferencia.sql` | tabela + índices + RLS |
| `web/lib/carteiraRd.ts` | contrato do RD, slug↔nome, retentativa, cache |
| `web/app/api/carteira/route.ts` | GET (carteiras + clientes) · POST (lote com orçamento) |
| `web/app/api/carteira/historico/route.ts` | histórico dos últimos 7/30 dias |
| `web/app/carteira/page.tsx` | tela (seleção, busca, progresso, histórico) |

### 25.7 Pendências

- **Sondas descartáveis a apagar** quando o assunto fechar: `src/etl/probe_carteira_*.ts`.
- O contato de teste **"TESTE MARKETING"** ficou em `Romulo` (era sem carteira).
  Sem remoção pela API — tirar pelo painel do RD, se incomodar.
- Reconciliação das trocas feitas direto no painel (§25.2).
- Investigar o salto de 23 → 432 divergências de carteira (§25.3).

## 26. Disparo em massa saiu do board e virou campanha em /admin (23/08/2026)

O botão **📣 Disparo massa** do cabeçalho do board foi removido. No lugar,
`/admin` → aba **📨 Templates** → chave **📣 Disparo em massa**, com rota
`/api/admin/disparo-massa`. Nenhuma migration: o público sai das views que já
existem.

**Não é aba de topo, e isso foi pedido explicitamente.** Cadastrar template e
disparar em massa são o mesmo assunto visto de dois lados — quem monta uma
campanha está escolhendo entre os templates que acabou de cadastrar. Duas abas
no topo obrigariam a ir e voltar só para comparar o texto. A chave fica dentro
da aba Templates, e a config do disparo (templates prontos, carteiras, extrato)
só é buscada quando alguém abre a seção: quem veio cadastrar não paga por ela.

### 26.1 O que mudou de fato

O botão do board não era só um botão: o público **saía dos filtros ligados na
tela naquele momento** (`visiveis`). Isso amarrava uma ação cara e irreversível
ao estado de uma tela de trabalho — montava-se um público de 500 pessoas mexendo
em filtro de card, e depois não havia como repetir nem explicar o que tinha sido
feito. Agora o público é **declarado**: carteira, etapa do funil, tempo parado,
janela de anti-repetição e quantidade.

| | antes (board) | agora (/admin) |
|---|---|---|
| público | filtros ligados na tela | declarado em campos, conferido no servidor |
| quem é atingido | contagem, sem nomes | tabela com nome, carteira, etapa, dias parado e canal |
| por que alguém ficou de fora | não dizia | contagem por motivo (sem contato no RD, sem telefone, lixeira, template recente, ativo demais, canal) |
| texto que a cliente lê | não aparecia | corpo do template na tela, com as variáveis preenchidas |
| histórico | nenhum | extrato de 30 dias por dia+template a partir de `disparos_template` |

### 26.2 O que NÃO mudou, de propósito

- **O laço de envio continua no navegador**, um `POST /api/send-template` por
  cliente, com pausa do ETL antes, `1800 ms` entre um e outro e retomada com
  retry no fim. Mover para o servidor era tentador e está errado: a cota do RD é
  de ~48 chamadas/min e **compartilhada com o ETL** (§14.5), então centenas de
  envios não cabem no tempo de uma rota da Vercel. A rota nova escolhe e explica
  o público; quem manda é a tela, mostrando a falha de cada cliente.
- `/api/send-template` **não foi tocado**. O ranqueamento (urgência do ciclo +
  tempo parado + ticket), o corte de anti-repetição e o `CUSTO_TEMPLATE = 0,43`
  são os mesmos — só mudaram de lugar.
- A régua de permissão continua sendo `podeAdmin` (via `guardaAdmin`).

### 26.3 A opção "Padrão do sistema" tem de existir — e quase ficou de fora

`crm_templates` hoje só tem linhas `canal='cloud'`; **nenhum template do RD está
cadastrado**. A lista de escolha, montada só da tabela, deixaria a tela incapaz
de fazer o que o board fazia: as campanhas reais de julho (517 num dia) saíram
com o id `6a5fa7dd77ea3f90cdfc28de`, que vem da env `TEMPLATE_RECONTATO_ID` —
é o caminho do `select value=""` do modal antigo, que mandava **nenhum**
`template_id` e deixava o servidor resolver.

Por isso a rota injeta uma entrada sintética `id: 0` — "Padrão do sistema",
canal `rd`, `envio_id: null` — e ela é a **seleção inicial**. O `★ padrão` da
tabela vale para o botão do card e para o chat, não para uma campanha.

### 26.4 Template da Cloud não alcança a base do RD — a tela recorta e diz

Medido em 23/08/2026: **3.838 contatos elegíveis, 1 na Cloud**. Escolher um
template da Cloud e disparar para a base do RD cairia no ramo do RD com um nome
que o painel deles não conhece — falha certa, **uma por cliente**. Então, quando
o template escolhido é da Cloud, o público é recortado para quem já conversa por
lá, e a tela diz quantos ficaram de fora e por quê.

O canal sai de `vw_chat_linha_cliente` (§23.4), que é barata: só mensagem da
Cloud carrega `linha_id`. Quem **não** está nela não tem mensagem `wamid`
nenhuma, então `canalDeResposta` dá `rd` com certeza — o erro possível é só para
o lado conservador. Com `WHATSAPP_ENVIO_PADRAO=true` (Fase C) o recorte some
sozinho.

### 26.5 Campos do template ({{2}} em diante) valem para a campanha

O template padrão de hoje (`tudo_bem_com_voce`) tem `{{1}}` e `{{2}}`, e
`/api/send-template` **recusa** chamador sem `variaveis` quando há mais de um
campo — o disparo em massa do board bateria nisso. A tela pede os campos de
`{{2}}` em diante **uma vez, para a campanha inteira** (é o que a tela do RD
faz); `{{1}}` continua sendo o primeiro nome de cada cliente. Com um campo só,
nada é enviado e o servidor põe o nome sozinho, exatamente como antes.

### 26.6 Arquivos

| Arquivo | Papel |
|---|---|
| `web/app/api/admin/disparo-massa/route.ts` | GET (templates, carteiras, extrato) · POST `previa` (público + motivos de corte) |
| `web/app/admin/page.tsx` | `DisparoMassaAba` (montar → confirmar → enviar), dentro do `TemplatesAba` |
| `web/app/page.tsx` | **removido**: botão, modal, estado e `enviarMassa` (só deleções) |

## 27. Limpeza do menu do board (23/08/2026)

Pedido do usuário, item a item, na mesma sessão da §26. Nada disso é migration —
é só onde as coisas ficam.

### 27.1 O que saiu do board

| Saiu | Era | Foi para |
|---|---|---|
| pastilha **Templates 2733** | `vw_templates_diario` | /admin → Templates → **📊 Envios** |
| pastilha **Automáticos 94 ▾** | `vw_templates_auto_diario` + menu de catálogo | idem (o número) |
| **Visões** | `/visoes` | — obsoleto |
| **Consulta Clientes** | link externo | — obsoleto |
| **Catálogo** | `/catalogos` | — obsoleto |
| **Base de Conhecimento** | link externo | — obsoleto |
| **🗂️ Carteira** | `/carteira` | /admin, na barra de abas |
| — | — | entrou **Visões da Carteira** (§27.4) |

**As rotas `/visoes` e `/catalogos` continuam existindo**, só não têm mais link.
Apagá-las é outra decisão, não tomada aqui. O botão **"C"** dos cards, que abre
a Consulta Clientes por `codcli`, também continua: o pedido foi sobre o menu.

### 27.2 Os dois números enganavam, e agora têm nome

Ficavam no cabeçalho sem nada que dissesse o que eram, e o rótulo mentia —
**nada ali é "automático"**:

| pastilha | view | o que É |
|---|---|---|
| Templates | `vw_templates_diario` | mensagens `tipo='template'` de operador: **todo** template entregue, tenha saído daqui ou do painel do RD |
| Automáticos | `vw_templates_auto_diario` | linhas de `disparos_template`: só os que **saíram do CRM** |

A tela nova mostra os dois **e a diferença**, que é o número mais útil e o que
ninguém calculava: quanto a equipe ainda dispara **pelo painel do RD**. Medido
em 23/08, no mês: 2.733 chegaram · 94 pelo CRM · **2.639 pelo painel**. Por
consultora, milene 846/22 e thiago 268/0 — ou seja, a adoção do CRM para
template ainda é marginal, e isso não estava visível em lugar nenhum.

A diferença é chão zero de propósito: as duas contagens vêm de fontes distintas
(espelho de mensagens × log de disparos) e o ETL pode não ter trazido ainda a
mensagem de um disparo recente. "−3 pelo painel do RD" seria pior que zero.

### 27.3 O que morreu junto com o menu **Automáticos** — e por que tudo bem

Aquele dropdown não era só um número. Levava embora:

1. **A escolha "por navegador" do template do botão do card.** Era **inerte**:
   só valia para template com `rd_template_id`, e não há nenhum cadastrado
   (§26.3) — a chamada sempre caía no padrão do sistema. O botão do card agora
   manda `cliente_id` e mais nada, que é literalmente o que já acontecia.
2. **O CRUD dos ponteiros do RD em `crm_templates`** (cadastrar, editar, ★
   padrão, ativar/desativar). O `/api/templates` continua no ar e o admin
   continua marcando ★ e desativando **templates da Cloud** em Administração →
   Templates. O que ficou sem tela é **criar ponteiro do RD** — caminho do canal
   que está sendo aposentado. Se voltar a ser preciso, é um formulário na aba
   Templates, não uma volta do dropdown.

### 27.4 "Visões da Carteira" ≠ "Gestão de carteira" — dois módulos, nomes quase iguais

Isto é a armadilha desta seção:

| No menu | O que é | Onde vive |
|---|---|---|
| **Visões da Carteira** (menu do board) | segmentação da carteira do time IS — Top 30, recorrentes, consolidação, reativação | app externo `MuranoIA/gestao-de-carteira`, sobre o **murano-clientes-v2** |
| **🗂️ Gestão de carteira** (/admin) | transferir contato de carteira **no RD Conversas**, em massa (§25) | este repo, `/carteira` |

O link do menu aponta para **a página do hub** (`app.muranoprofessional.com.br/gestao-carteira`),
**não** para o app. Motivo: quem tem a ponte de SSO é o hub — ele emite um token
de uso único com a **service_role do murano-clientes-v2**
(`packages/feature-carteira/src/carteiraSso.ts` no `murano-app`). Reimplementar
isso aqui espalharia aquela chave para mais um projeto sem ganho nenhum. Sem
login no hub a rota devolve `307 → /login?proximo=/gestao-carteira`, então quem
já está logado cai direto no módulo.

**Navega com `target="_top"`, não abre aba nova** (corrigido no mesmo dia, a
pedido: o item tinha de se comportar como os demais do menu). Dentro do iframe
do hub (§17) isso troca a aba interna do hub pela de carteira — que é
exatamente o comportamento de qualquer outro item. Fora do iframe, navega a
própria aba. Funciona porque o iframe do hub **não tem `sandbox`**
(`packages/feature-crm-externo/src/CrmExternoFrame.tsx` traz só `allow=`); se um
dia ganhar um, o link para de navegar **em silêncio** — sem erro no console.

**Embutir o app dentro do CRM não é possível hoje**, e a razão é medida, não
suposta: ele responde
`Content-Security-Policy: frame-ancestors 'self' https://app.muranoprofessional.com.br`
(`next.config.ts` do repo `gestao-de-carteira`, a partir de `NEXT_PUBLIC_HUB_ORIGIN`,
que aceita **uma** origem). Para uma tela `/visoes-carteira` nossa seriam
necessárias três coisas, nesta ordem: (1) aquele repo aceitar a origem do CRM;
(2) a service_role do **murano-clientes-v2** na Vercel do CRM; (3) refazer aqui a
ponte de SSO de token de uso único. O item (2) é o que pesa — espalha a chave do
ERP para um terceiro projeto (a mesma preocupação da §10.7, item 5).

### 27.5 Arquivos

| Arquivo | Papel |
|---|---|
| `web/app/api/admin/envios-template/route.ts` | os dois contadores, por carteira e por período |
| `web/app/admin/page.tsx` | `EnviosAba`, terceira posição da chave; link 🗂️ Gestão de carteira na barra |
| `web/app/page.tsx` | menos as duas pastilhas, o dropdown e 4 itens de menu; mais Visões da Carteira |
| `web/app/carteira/page.tsx` | o "voltar" aponta para /admin, não mais para o board |

## 28. Segundo número real na Cloud API — "Murano Professional" (23–24/08/2026)

Número próprio registrado direto na Cloud API e colocado como **a linha de envio
do app**. Recebimento, envio de texto, recibos de entrega, template e ligação
validados ponta a ponta no mesmo dia. O RD segue intocado atendendo o número
oficial — continua valendo a §23: dois números em paralelo, sem corte à vista.

### 28.1 Os ids (verificados na Graph API, não no painel)

| | valor |
|---|---|
| `phone_number_id` | `1264458800091787` |
| número | **+55 91 8166-0019** |
| `verified_name` | Murano Professional · `account_mode: LIVE` · `CLOUD_API` |
| **WABA** | `1568370048121307` (conta "Murano Professional") |
| token | o **`WHATSAPP_TOKEN` que já existia** — system user Murano Pulse, `expires_at: 0` |

Migration **0094** cadastra a linha em `chat_linha`; `WHATSAPP_PHONE_NUMBER_ID` e
`WHATSAPP_WABA_ID` na Vercel apontam para os dois ids acima.

**Como achar o WABA id sem adivinhar:** a coluna "Identificação" da tela
*Cobrança → Contas do WhatsApp Business* É o WABA id — conferido porque duas
linhas dela batem com ids já conhecidos daqui (Test `28189344217325382`, Murano
Pro `1441580480587007`). O token do CRM **não** lista WABAs
(`assigned_whatsapp_business_accounts` volta vazio, `owned_…` dá #200), mas
depois de conhecido o id ele lê a conta inteira.

### 28.2 TEMPLATE É POR WABA, NÃO POR NÚMERO — a armadilha central

Trocar o número trocou de **conta**, e com isso os quatro templates aprovados
viraram pó: `crm_templates` continuou apontando para nomes que só existiam na
WABA anterior. Sintoma no chat, com o cadastro impecável e o código correto:

```
Graph 132001: template name (recontato_de_clientes) does not exist in pt_BR
```

A WABA nova nasce só com o `hello_world` de fábrica — por isso um teste com
`hello_world` passa e todo o resto falha, o que engana o diagnóstico.

Recriados na conta nova, aprovados em minutos: **`recontato_de_clientes`** (o ★
padrão, `{{1}}` + `{{2}}`) e **`tudo_bem`**. Ficaram de fora de propósito
`promo` (corpo "teste asdfasdf…") e `tudo_bem_com_voce` (duplicata truncada do
padrão) — **os dois seguem `ativo: true` no cadastro e dão 132001 se alguém
escolher**; ver pendências.

**Isto vai se repetir na Fase C**, quando o número oficial migrar: recriar os
templates na WABA de destino faz parte do corte, não é acabamento posterior.

### 28.3 `subscribed_apps` vazio — a falha mais silenciosa que este projeto já teve

Por horas o envio funcionou e **nada voltava**: nenhuma mensagem recebida,
nenhum tique, nenhum evento de chamada. Inscrever o app é passo separado de
tudo o mais e não dá erro em lugar nenhum quando falta.

```
GET  /<waba_id>/subscribed_apps  -> {"data":[]}      <- o diagnóstico
POST /<waba_id>/subscribed_apps  -> {"success":true} <- a correção
```

**O sintoma que denuncia isso no nosso banco** (e vale como régua permanente):
mensagem enviada parada em **`status: "wait"`** para sempre, porque quem
promove `wait → success → read` é o webhook (§16.3). Some-se a isso zero linhas
`enviada_por='customer'` com id `wamid.*` na linha nova.

⚠️ Assinar a WABA **não** assina os campos: `messages` já vinha assinado no
nível do app (herdado), mas **`calls` precisa ser marcado à mão** no App
Dashboard — é a armadilha nº 3 da §16.4 outra vez, agora para voz. Ler quais
campos estão assinados exige **app token** (`#190 Application Secret required`),
então é conferência visual no painel: o `WHATSAPP_APP_SECRET` só existe na
Vercel.

⚠️ A rota `/api/whatsapp/diag` faz esse POST, mas a allowlist dela (§20.3) só
permite Murano Shop e a conta de teste — **a lista está desatualizada** e não
alcança a conta em uso.

### 28.4 `132001` tem TRÊS causas e o texto da Meta só nomeia uma

`template name (X) does not exist in pt_BR` sai igual para: **nome** errado,
**idioma** errado, ou **conta** errada. O `pt_BR` no fim é só o que ela
procurou, não uma reclamação sobre a língua do texto — e foi exatamente isso que
despistou o diagnóstico aqui, onde a causa era a terceira.

A rota não usa `pt_BR` fixo: lê `crm_templates.idioma` e só cai em `pt_BR` se
estiver vazio (`send-template`, ~linha 156). Um `pt-BR` ou `pt` guardado ali
reproduz o mesmo erro com a conta certa.

### 28.5 Cobrança: saldo R$ 0,00 NÃO é bloqueio

O "Saldo atual" da tela de contas é **valor acumulado a pagar**, não crédito
pré-pago — a cobrança do Cloud API é pós-paga. O que bloqueia é **WABA sem forma
de pagamento vinculada**, e o vínculo é por conta: o mesmo cartão do portfólio
serve para várias WABAs (a Test e a Murano Professional dividem o mesmo Visa).

Efeito prático, e a razão de a ligação ter sido o último item a cair:

| | precisa de cartão na WABA? |
|---|---|
| conversa de serviço / texto na janela de 24h | não (franquia gratuita) |
| template de marketing | só depois de esgotada a franquia — falha tarde e sem aviso |
| **chamada de saída** | **sim, desde a primeira** — é o `131044` da §22.6.1 |

Vínculo por interface apenas: a Graph API não expõe cobrança.

### 28.6 Uma linha de envio só — consequência de trocar a env

`linhaDeEnvio()` é lido por **sete** pontos (send-message, send-template,
enviar-midia, ligação ×2, fora de horário, admin/ligacao). Trocar
`WHATSAPP_PHONE_NUMBER_ID` **move todo mundo de uma vez**: conversa que entrou
por outro número passa a ser respondida pelo novo, o que na tela da cliente é
uma **conversa nova**, e a janela de 24h — que é **por número** — não vem junto.

E o interruptor de calling (§22.7 item 3) age exatamente sobre essa env: ligar
"Chamadas de voz" em /admin → Linhas passou a valer para o número real, com o
ícone de telefone aparecendo para todas as clientes da linha.

### 28.7 Correções a seções anteriores

- **Murano Shop foi eliminada de propósito pelo usuário em 24/08/2026.** A §20
  inteira descreve um piloto que não existe mais: o número +55 91 9806-0032, a
  WABA `1384896129703324` e os templates aprovados nela se foram. As 57
  mensagens e as 6 conversas dela seguem no banco como histórico, e a linha
  continua em `chat_linha` só para dar rótulo a elas.
- **§23.2 item 1 (meio de pagamento na Murano Shop)** e **§23.2 item 2
  (template de recontato)** estão resolvidos, porém na conta NOVA — não naquela.
- **§21.4 item 2 e §23.1** já corrigiam o mito do "modo Ativo": confirmado outra
  vez aqui, com número real em WABA real enviando para fora de qualquer
  allowlist, com o app ainda em Desenvolvimento.

### 28.8 Pendências

1. **`promo` e `tudo_bem_com_voce` ativos em `crm_templates` sem existir na WABA
   em uso** — desativar, ou recriar se alguém os quiser de volta.
2. **Linhas mortas em `chat_linha`**: piloto (Murano Shop) e número de teste.
   Desativar tira do filtro do chat, mas some o rótulo das conversas antigas —
   por isso não foi feito.
3. **Allowlist da `/api/whatsapp/diag` desatualizada** (§20.3): aponta para uma
   conta que não existe mais. Rota é temporária e sai na Fase C de qualquer jeito.
4. **Murano Pro e Murano Cobrança faturam por linha de crédito alocada por
   terceiros** (ODCEM, Text Wave) — a Murano Pro é a WABA do número oficial;
   esse arranjo precisa ser resolvido **antes** de migrar o número, não depois.

## 29. Auditoria de UX do chat e o interruptor de desenho (24/08/2026) — migration 0095

O `/chat` foi auditado sobre o **código**, não sobre print de tela, e ganhou três
direções de redesenho em protótipo. A escolha entre elas virou configuração em
`/admin` → aba **🎨 Desenho do chat**.

### 29.1 O especialista e a skill de marca reconstruída

Duas peças novas em `.claude/` (⚠️ **`.claude/` está no `.gitignore` deste repo** —
elas NÃO são versionadas e somem se a pasta for recriada, como já aconteceu em
11/08, §19.1):

| Arquivo | O que é |
|---|---|
| `.claude/agents/ux-chat.md` | subagente especialista em UX/UI de ferramentas de atendimento. Régua de 12 pontos, as 10 tarefas reais do vendedor, e trava dura: escreve só em `prototipos/` |
| `.claude/skills/murano-brand/SKILL.md` | **a skill original NÃO existe no disco** — é citada em comentário no código e no `CLAUDE.md` do hub, mas não está em `~/.claude`, nos plugins nem em nenhum repo. Reconstruída a partir de `murano-app/src/app/globals.css` (canônico), `web/lib/tema.ts` e o objeto `M` do chat |

A skill registra o que hex sozinho não registra: **púrpura = marca, azul = ação,
laranja = acento pontual** (um destaque por tela), e as duas calibragens de
contraste já pagas — `.murano-btn` usa `#7a1755` porque `#621244` chapado sobre o
card dá **1,46:1**; púrpura como *texto* precisa clarear para `#a8447f`.

**Três paletas Murano divergem hoje**, e não é bug: a do hub é canônica; o tema
`murano` do CRM usa laranja como cor de ação (anterior à calibragem de 02/08); e o
chat usa **`#7b2d8b`**, um quarto roxo que **não é token de lugar nenhum**.

### 29.2 Os achados que mais pesam

Laudo completo em `prototipos/laudo-ux-chat.md` (11 achados com evidência
`arquivo:linha`, custo das 10 tarefas em cliques, o que preservar, riscos).

1. **A tela não diz quantas clientes estão esperando.** O contador de não lidas só
   existe depois de abrir o dropdown (`page.tsx:1408-1428`) — 2 cliques na primeira
   pergunta do dia, paga dezenas de vezes por 7 pessoas.
2. **A janela de 24h só se manifesta como erro.** Zero indicadores; o dado para
   antecipar **já vem carregado na thread**. Escreve-se a mensagem inteira para
   descobrir que precisava de template (R$ 0,43).
3. **A vantagem do ERP abre na aba errada e não existe no celular.** `abrir()` força
   a aba Perfil, que repete o cabeçalho (`:816`); painel e abas são `!isMobile`
   (`:1751`, `:2235`) — o diferencial contra o RD desaparece no dispositivo que vai
   virar app.
4. **Um único slot `aviso`** (18 `setAviso`) para janela, falha de envio, mídia,
   nota, transferência e microfone: o segundo evento apaga o primeiro. E a barra de
   chamada é `fixed bottom:0` em largura total (`ligacao.tsx:471`) — **cobre o
   compositor**.
5. **Falha tardia é inalcançável em touch:** o motivo da Meta vive num `title`
   (`:362`), que exige hover, e não há reenviar.
6. Contrastes medidos: texto secundário em 10px = **3,57:1** (reprova). Mobile usa
   `100vh` sem área segura, e o compositor consome ~352 de 362px — sobram **10px**
   para a caixa de texto.

### 29.3 O interruptor — e a linha que o banco NÃO cruza

`chat_layout` (linha única id=1) guarda o desenho em vigor; `acesso.chat_layout`
guarda o **piloto por pessoa** (NULL = segue o global); `chat_layout_historico` é
append-only com `de`/`para`/`por`/`escopo`.

⚠️ **Quais desenhos têm implementação real é fato do CÓDIGO, não do banco** —
mora em `web/lib/chatLayout.ts` (`implementado: boolean`). Quem sabe se a Direção 2
existe é o deploy que está no ar, não uma coluna. Duplicar isso no banco criaria
duas verdades que divergem no primeiro deploy, e o admin conseguiria "estabelecer
para todos" um desenho que ninguém construiu. A rota recusa com **409**.

Hoje **só `original` está implementado**: as três direções aparecem na tela como
*Em avaliação*, não selecionáveis. Virar `implementado: true` é o **último** passo
de implementar uma direção.

`layoutEfetivo()` é a fonte única da régua (piloto ganha do global; valor
desconhecido cai no padrão em vez de deixar a tela sem desenho) e é usada pelo
`/api/chat` **e** pelo `/admin` — se cada um calculasse, o admin anunciaria um
desenho diferente do que a equipe vê.

**`original` é sempre um valor válido** — enquanto for, nenhum redesenho é
irreversível. Mesmo instinto de `WHATSAPP_ENVIO_PADRAO` e da `chat_horario_atendimento`
nascendo desligada.

### 29.4 Duas decisões de UI da própria tela de admin

- **Marcar o rádio NÃO aplica.** Estabelecer troca a tela de 15 acessos ativos; um
  clique acidental não deve fazer isso. Marcar seleciona, um segundo gesto confirma
  — o mesmo freio que o laudo cobra dos erros caros do chat.
- **Opção sem implementação aparece, mas não é selecionável.** Esconder as três
  direções tiraria o material de comparação; deixar ativá-las jogaria a equipe numa
  tela que não existe.

**PUT e PATCH são separados de propósito**: o primeiro afeta 15 pessoas, o segundo
uma. Um endpoint só, decidindo pelo formato do corpo, tornaria fácil escrever
global achando que escrevia piloto.

### 29.5 Piloto por usuário — por que existe

Trocar a tela de sete pessoas de uma vez, sem ninguém ter usado, é o cenário em que
um desenho bom morre por estranhamento. Mesmo argumento do §21.4 para o corte do RD:
*o que o vendedor reclamar depois de usar vale mais que qualquer item adivinhado numa
lista.* Coluna em `acesso` e não tabela nova porque `acesso` **é** a tabela de config
por usuário e não é escrita por ETL — o risco da §10.11 não se aplica.

### 29.6 Arquivos

| Arquivo | Papel |
|---|---|
| `supabase/migrations/0095_chat_layout.sql` | as duas tabelas + a coluna em `acesso` |
| `web/lib/chatLayout.ts` | catálogo das 4 opções (tese, ganhos, sacrifícios), `implementado`, `layoutEfetivo()` |
| `web/app/api/admin/chat-layout/route.ts` | GET · PUT (global) · PATCH (piloto) |
| `web/app/admin/page.tsx` | `RedesenhoAba` + aba 🎨 |
| `web/app/api/chat/route.ts` | devolve `layout` no load único (entra no `Promise.all` que já existia — zero round-trip novo) |
| `prototipos/` | laudo, 3 protótipos standalone e README comparativo |

### 29.7 Direção 1 CONSTRUÍDA (24/08/2026) — o interruptor tem dois estados reais

`implementado: true` para `continuidade`. Tudo o que ela muda está atrás da flag
**`d1`** em `app/chat/page.tsx` — **não existe uma segunda árvore de JSX**. A tese
dela é "nada muda de lugar, coisas passam a aparecer", então são adições pontuais
nos quatro pontos caros, mais a paleta. Uma tela só é o que torna o rollback
confiável.

| O que mudou | Onde |
|---|---|
| **Paleta** — objeto `M` virou mutável com `Object.assign(M, PALETAS[layout])`, mesmo padrão do board (§11.5). Sai o rosa `#f5edf4` e o roxo `#7b2d8b` (que não são token de lugar nenhum); entram os tokens do hub, com a bolha enviada **azul** porque enviar é ação, não marca | topo de `page.tsx` |
| **Faixa de filas** com os 4 contadores sempre visíveis; o dropdown continua onde estava | cabeçalho da sidebar |
| **Faixa da janela de 24h** com tempo restante e barra, e o botão que reabre dentro dela. Conta da última mensagem **recebida**, que já vem na thread — zero chamada nova, sem tick próprio (o poll de 60s já re-renderiza) | acima do compositor |
| **Aba "Resumo"** (`soD1: true`) com comprado / dias sem comprar / % do ciclo em corpo grande, e `abaPadrao` faz `abrir()` cair nela | `PainelContato` |
| **Motivo antes dos nomes** na transferência, via a constante `campoMotivoTransf` — uma só, para as duas ordens não divergirem | bloco de transferência |
| **Falha sai do `title`**: motivo em texto + botão Reenviar abaixo da bolha | thread |
| **Mobile**: `100dvh`, `safe-area-inset-bottom`, barra inferior de filas (só na lista) e o ERP em **folha deslizante** — antes o painel era `!isMobile` e o celular atendia sem nenhum dado de compra | container raiz e thread |

**Uma armadilha paga:** o container da bolha é `flex row` com `justifyContent`. O
recado de falha do D1 precisa ficar **abaixo** dela, então em D1 o container vira
`column` + `alignItems`. Foi feito condicional depois de já estar valendo para os
dois — rollback que muda "quase nada" não é rollback.

`layoutEfetivo` testado nos 7 casos (piloto ganha do global; valor não
implementado, desconhecido ou nulo cai no padrão): todos passam.

### 29.8 Pendências

1. **Decidir entre 2 e 3** depois de a equipe usar a 1. A pergunta não é qual tela é
   mais bonita: a **2 aposta em atender mais conversas por dia**, a **3 em vender
   mais por conversa**.
2. **Versionar `.claude/`** (skill + agente) ou aceitar que somem. Hoje estão
   ignorados pelo git.
3. Direção 2 exige **adiar**, que não existe no banco. Direção 3 exige catálogo com
   preço e ação recomendada.

## 30. Interruptores de mecanismo em /admin — o primeiro é o ciclo de compra (24/08/2026) — migration 0097

Aba **⚙️ Mecanismos** no `/admin`, com a chave **Motor de ciclo de compra**. Decisão
do usuário: o mecanismo vai ser revisado, e enquanto isso precisa poder ser
desligado e religado **sem deploy**.

`crm_config` é **linha única e genérica de propósito** — não `ciclo_config`. Os
próximos interruptores no radar (fonte do board: conversas × carteira do ERP;
quais conversas ficam visíveis) entram como **coluna nova ali**, não como tabela
nova. Mesmo formato de `paginas_legais`.

### 30.1 A fronteira é por CAMPO, não por tabela — e confundir isso quebra o Excel

`wth_ciclo` carrega duas coisas na mesma linha:

| | Campos | Com a chave desligada |
|---|---|---|
| **motor preditivo** (o que está em revisão) | `tipo_oportunidade` · `score_urgencia` · `pct_ciclo` · `acao_recomendada` · `tendencia` · `ciclo_medio` | **some** |
| **fato bruto do ERP** | `dias_ausente` · `ultima_compra` · `ticket_medio` · `total_pedidos` · `rec_total` · `ramo` | **fica** |

Isso importa porque o `relatorio_rows` tira **`ticket_medio` e `total_pedidos` de
`wth_ciclo`** — "desligar a leitura de `wth_ciclo`" apagaria ticket médio da
planilha, que ninguém pediu. O filtro **Tempo parado** do board também sobrevive:
conta dias de inatividade, não usa o motor.

### 30.2 Nasce LIGADO, e isso não é timidez

O ciclo está em uso. Nascer desligado faria um **deploy** mudar a tela de 15
acessos por efeito colateral — exatamente o que a 0095 evita. Desligar é decisão
de um admin, na tela, com nome e hora em `atualizado_por`/`atualizado_em`.
Consequência prática: **depois do deploy, alguém precisa ir ao /admin e desligar** —
o merge sozinho não muda nada.

### 30.3 Onde a chave pega (5 lugares, uma implementação)

`web/lib/crmConfig.ts` é a fonte única, e **falha para o lado do que já
funcionava**: tabela ausente, erro de leitura ou linha sumida devolvem `ligado`.
O contrário seria uma instabilidade do banco desligando um mecanismo na cara da
equipe.

| Consumidor | O que muda |
|---|---|
| `/api/funil` | **nem consulta** `vw_ciclo_card` — o mecanismo sai do ar de verdade, não fica escondido por CSS, e a rota economiza uma consulta paginada. Devolve `ciclo_ativo` |
| `web/app/page.tsx` | o filtro **Ciclo compra** some do cabeçalho. O selo no card **não precisou de guarda**: vem `ciclo: null` do servidor |
| `/api/chat/contato` + `/chat` | some a aba **Ciclo**, o número "% do ciclo" e a linha "Ciclo médio" do Resumo, e a Sugestão |
| `/api/admin/disparo-massa` | o ranqueamento perde a parcela de urgência e vira **tempo parado + ticket** — ordem defensável, em vez de campanha sem critério. O texto da tela muda junto |
| `/api/relatorio` | a coluna **Ciclo Médio (dias)** sai da planilha em vez de virar coluna de traços |

### 30.4 Três armadilhas pagas ao construir

1. **Filtro de ciclo ligado quando a chave desliga** esconderia TODOS os cards
   (`matchCiclo` contra `ciclo: null`) — tela vazia sem explicação. Um efeito
   limpa `cicloSel`.
2. **Estar na aba Ciclo** quando um admin desliga deixaria o painel do contato em
   branco. Resolvido no render (`abaAtual`), não num efeito: efeito ali dependeria
   de nenhum `return` aparecer antes daquela linha.
3. **Ler o interruptor de dentro de `contato`** fazia a aba "Ciclo" **piscar** a
   cada conversa aberta, porque `contato` volta a `null` no `abrir()`. É config
   global: estado próprio, setado quando a resposta chega.

Verificado ao vivo em 24/08: desligou, religou, e `vw_ciclo_card` seguiu com
1.104 linhas. **Nada é apagado** — o `wth-sync-tudo` continua atualizando a cada
10 min, então religar mostra o dado de agora, não um buraco.

## 31. Segundo interruptor: esconder as conversas do RD (24/08/2026) — migration 0098

`/admin` → ⚙️ Mecanismos → **Conversas do RD Conversas**. Pedido do usuário, ao pé
da letra: **não mexer na régua das 5 colunas** — mexer no que ALIMENTA a régua.
Sem gatilho de conversa, o card cai onde a régua manda.

### 31.1 A `vw_funil` NÃO pode ser filtrada — o ETL depende dela

**A armadilha central desta migration.** `src/etl/run.ts` lê a `vw_funil` para
decidir o que sincronizar (`.gte("ultima_atividade", cutoff)` na linha 132 e
`.eq("etapa","negociacao")` na 154). Filtrar a view existente faria o ETL
concluir que nada está ativo e **parar de puxar o RD**, sem erro nenhum — o
oposto do pedido, que é explícito: *"o ETL pode continuar alimentando o banco,
mesmo que não mostre nada na tela"*.

Daí a `vw_funil_sem_rd`: mesma régua, mesma ordem de colunas, enxergando só
mensagem com `linha_id` não nulo. **Duplicação consciente** — as duas precisam
mudar juntas se a régua mudar.

### 31.2 A linha que separa esconder de agir

| Lê a view filtrada (TELA) | Continua na `vw_funil` (VERDADE) |
|---|---|
| `/api/funil` · `/api/chat` · `/api/chat/contato` · `/api/chat/buscar` | `src/etl/run.ts` — senão para de ingerir |
| `/api/chat/thread` · `/api/mensagens` (lupa do card) | `/api/admin/disparo-massa` — decide **quem abordar** |
| | `/api/chat/transferir` · `lib/ligacao.ts` — checagem de dono (autorização) |

**Esconder não pode virar agir sem saber.** Cegar o disparo em massa faria o CRM
re-abordar quem está em conversa aberta no RD agora — dano real, no cliente. E
checagem de permissão se resolve contra o dado autoritativo, nunca contra uma
view deliberadamente parcial.

`viewFunil(cfg)` em `web/lib/crmConfig.ts` é a escolha única: se cada rota
decidisse, o board mostraria o card em Prospecção enquanto o chat ainda listaria
a conversa dele.

### 31.3 O ramo 1b existe para ninguém sumir

Medido em 24/08 com a chave ligada:

| | com RD | sem RD |
|---|---|---|
| conversa visível | 3.847 | **2** |
| **ociosos (ramo 1b, NOVO)** | 0 | **75** |
| prospecção | 820 | **4.091** |
| venda sem contato | 39 | 39 |
| **total da view** | 4.705 | 4.207 |

Os **75** são contatos que estão no board hoje só por causa de uma conversa do
RD e que a prospecção **não** alcança — sem vínculo e sem telefone batendo no
WinThor. Sem o ramo 1b evaporariam em silêncio. Entram como `ociosos` (foram
contatados; `prospeccao` significa "nunca contatado") com `ultima_atividade`
NULA, então só aparecem no filtro de período "todos", igual à prospecção.

**A diferença de 498 no total não é perda:** 510 compraram no mês e por isso saem
da prospecção de propósito — aparecem na coluna **Pedido emitido**, que vem de
`vw_pedido_bi_card` (nota fiscal, rota separada) e não da conversa. Outros 4
reaparecem em prospecção casados por telefone. Conferido: **zero cliente_id
duplicado**, ninguém sem card.

### 31.4 Bug pré-existente que a chave escancarou

O `/api/chat` cortava a prospecção por `ultima_atividade is not null` — mas o
card de **venda** carrega a data da nota, então **39 cards sintéticos
`venda:<codcli>` sempre estiveram na lista do chat**, invisíveis entre 3.908
conversas. Com o RD escondido virariam **39 de 41 itens**, e o chat pareceria
quebrado. Corrigido: a lista exclui `venda:%` e `winthor:%`, que não têm thread.
Lista do chat hoje: 3.908 → **3.869** (com RD) e **2** (sem RD).

### 31.5 O que vem a seguir invalida este formato — e é de propósito

O usuário já pediu o passo seguinte: **escolher quais linhas ver** (RD, Murano
Professional, ou as duas). Isso é a generalização deste booleano, não um terceiro
interruptor: `conversas_rd_visiveis=false` é o mesmo que marcar só a Murano
Professional. Quando o seletor entrar, esta coluna deve ser **substituída**, não
acompanhada — dois controles sobre o mesmo assunto se contradizem ("RD escondido"
com "mostrar RD" marcado) e ninguém sabe qual vence.


## 32. O interruptor de conversas vira SELETOR DE LINHAS (24-25/08/2026) — migration 0099

`/admin` → ⚙️ Mecanismos → **Conversas visíveis, por número**: marca-se RD
Conversas, Murano Professional, ou as duas. Isso **substitui** o booleano
`conversas_rd_visiveis` da 0098 — não convive com ele. Dois controles sobre o
mesmo assunto acabam se contradizendo ("RD escondido" com "mostrar RD" marcado)
e ninguem sabe qual vence. A 0099 migra o valor e derruba a coluna.

### 32.1 As linhas saem da tabela, e NULO significa "todas"

`chat_linha` ja era o cadastro: hoje `rd` (Murano Pro, +55 91 2018-2357) e
`1264458800091787` (Murano Professional) ativas; Shop e o numero de teste
ficaram `ativo=false` (§28.7). O seletor le dali — ativar uma linha amanha a faz
aparecer sozinha (§14.1).

**`linhas_visiveis` NULO = todas as ativas**, e e o estado de origem. Nulo em vez
de uma lista congelada de proposito: com a lista, ativar uma linha nova a
deixaria invisivel ate alguem lembrar de marca-la — falha silenciosa. Pelo mesmo
motivo, marcar TUDO na tela grava NULO, nao a lista.

### 32.2 Uma view so, que se filtra sozinha

A 0098 criou `vw_funil_sem_rd`, um caso particular; com N linhas isso viraria N
views. A `vw_funil_visivel` **le a config**:
`coalesce(m.linha_id,'rd') = any(<selecao>)`. Medido: **473 ms / 4.666 linhas**
com tudo marcado — as 4.705 de hoje menos os 39 cards sinteticos.

O app le SEMPRE `vw_funil_visivel` (`VIEW_FUNIL_TELA`), nunca alternando entre
duas views: "as vezes uma, as vezes outra" e onde nasce board e chat divergirem.

⚠️ A `vw_funil` continua **sem filtro nenhum**, e isso nao e descuido: o ETL
depende dela para saber o que sincronizar (`src/etl/run.ts:132,154`). Filtrada,
ele concluiria que nada esta ativo e pararia de puxar o RD em silencio. O pedido
do usuario e explicito e o oposto: *"o ETL pode continuar alimentando o banco,
mesmo que nao mostre nada na tela"*.

### 32.3 O ramo sintetico `venda:<codcli>` MORREU

Os 39 cards `venda:` nunca apareceram no board — o `/api/funil` os descartava em
`etapa !== "pedido_emitido"`. Serviam so para poluir a lista do chat (§31.4).
Verificado: **os 39 sao todos clientes de carteira ativa**, entao continuam no
board pelo ramo de prospeccao ou pela coluna Pedido emitido, que vem de
`vw_pedido_bi_card` (nota fiscal) e nao da conversa. Peso morto removido.

### 32.4 A regua das 5 colunas NAO mudou — e nao precisava

Levantamento pedido pelo usuario em 24/08. A regua que ele descreveu ja e a que
esta no codigo desde a 0093:

| Regra que o usuario descreveu | Onde ja estava |
|---|---|
| nunca contatado -> prospeccao | ramo de prospeccao da `vw_funil` |
| recebeu template -> tentativa de contato | `WHEN operator AND tipo='template'` |
| respondeu -> negociacao | `ELSE` (ultima mensagem ha menos de 24h) |
| respondeu e a janela de 24h fechou -> ociosos | `WHEN criada_em < now()-24h` |
| comprou -> pedido emitido | nota fiscal, via `vw_pedido_bi_card` |

**Conclusao que vale registrar: o problema nunca foi a regua, foi o DADO** — as
conversas do RD chegam atrasadas e desorganizadas pelo ETL. Por isso o seletor
resolve o incomodo sem tocar em gatilho nenhum. Nao "consertar" a classificacao
antes de olhar a origem do dado.

### 32.5 Onde o recorte de linha precisa ser aplicado a mao

A lupa do card (`/api/mensagens`), a thread (`/api/chat/thread`) e a busca por
conteudo (`/api/chat/buscar`) varrem `mensagens` **direto**, sem passar pela
view. Sem filtro ali, o board mostraria o cliente em Prospeccao e um clique
escancararia justamente a conversa escondida. `filtroLinhas()` em
`web/lib/crmConfig.ts` e a implementacao unica — e precisa de `.or(...)` porque
a linha do RD e `linha_id IS NULL` e nao cabe num `.in(...)`.

### 32.6 A coluna Pedido emitido nunca zerava — o bucket `todos` (25/08/2026)

Sintoma relatado pelo usuario: *"os cards que estao em pedido emitido sempre ficam
la, e nao e assim para ser — devem ficar ate o final do mes e ir para a lista de
prospeccao no inicio do mes seguinte."*

A §11.1 sempre afirmou que a etapa "expira sozinha no dia 1o". **A etapa expira;
a COLUNA nao.** Sao coisas diferentes e foi ai que passou despercebido: a coluna
nao vem da `vw_funil`, vem de `vw_pedido_bi_card` (§12.4), que oferece buckets de
periodo — e um deles, **`todos`, vai de 1900-01-01 ate hoje**. O board usava
`todos` como padrao (`periodoPorColuna[col.key] ?? "todos"`).

Medido em 25/08/2026:

| bucket | clientes | compra mais antiga |
|---|---|---|
| **`todos`** (o que a coluna usava) | **3.147** | **27/04/2026** |
| `mes` | 849 | 01/08/2026 |

**Dois defeitos, mesma causa:**
1. A coluna acumulava quatro meses em vez de zerar no dia 1o.
2. **O mesmo cliente aparecia duas vezes no board.** `ehCompradorMes` so remove
   das outras colunas quem comprou no MES; quem comprou em abril seguia na sua
   etapa normal **e** em Pedido emitido. Isso e o oposto de "cada card representa
   um cliente".
3. De quebra, o KPI do cabecalho somava desde abril: **R$ 2,45 mi contra
   R$ 375 mil do mes** — grande demais para alguem desconfiar.

**Conserto — na origem, nao na tela.** `/api/funil` passou a pedir
`.neq("periodo","todos")`: a coluna simplesmente nao tem universo maior que o mes.
Esconder no front deixaria o dado chegando e alguem o reintroduziria.

⚠️ **`todos` precisou ser TRADUZIDO, nao so trocado de padrao.** O dropdown global
aplica um periodo a todas as colunas de uma vez; escolher "todos" ali deixaria
esta coluna procurando um bucket que o servidor nao manda mais — vazia, sem nada
explicando. Em `page.tsx`, `ehPedido && periodo === "todos"` vira `"mes"`, nos tres
lugares (cards, contagem, KPI).

**Para onde vao os 2.298 que saem da coluna** (medido com todas as linhas visiveis):
tentativa_contato 699 · ociosos 551 · prospeccao 166 · negociacao 13 · **353 saem
do board**. Desses 353, **335 tem RCA fora das 7 carteiras do CRM**: nunca
estiveram em carteira nenhuma, apareciam so porque alguem do time LANCOU o pedido
(a coluna e chaveada por `nome_usuario`, §12.3). Sem carteira nao ha fila para
voltar — reaparecem em Pedido emitido se comprarem de novo. **Isso e correto, nao
perda.**

Com o RD escondido a distribuicao muda: quase todos caem em prospeccao, que e
exatamente a regra pedida.

### 32.7 Pendencias combinadas com o usuario

1. **Card virar chat de verdade**: hoje o card ampliado busca as ultimas 30
   mensagens em `/api/mensagens` e mostra um input reduzido so em negociacao.
   Vira thread com rolagem/paginacao como a do `/chat`, e o compositor completo,
   com a mesma regra de janela de 24h.
2. **"Um card por cliente"**: com o `venda:` removido, falta decidir se o cliente
   que comprou continua aparecendo so na coluna Pedido emitido (hoje) ou vira um
   card unico que muda de coluna.


## 33. O card ampliado virou chat de verdade (25/08/2026) — `web/app/conversa.tsx`

Pedido do usuario: *"que em cada card apareca a conversa igual como aparece no
chat... nao somente algumas ultimas mensagens, mas a rolagem das mensagens normal
como e no chat, e em negociacao o input para a mensagem deve ser normal como em um
chat e nao com limitacoes tipo inline"*.

| | antes | agora |
|---|---|---|
| fonte | `/api/mensagens` — **30 mensagens, so texto** | `/api/chat/thread` — **200**, a MESMA rota do /chat |
| conteudo | bolha de texto e hora | midia (foto/audio/video/documento), tique de entrega, selo de template, separador de dia, notas internas e transferencias na linha do tempo |
| falha de envio | invisivel | motivo da Meta em texto, abaixo da bolha |
| compositor | `<input>` de uma linha | `<textarea>` que cresce com o texto, Enter envia e Shift+Enter quebra linha |
| quando aparece | so em `negociacao` (ou pedido com conversa <24h) | sempre que a **janela de 24h** estiver aberta |

### 33.1 A janela decide o compositor, nao a etapa do card

Antes: `zMostraInput = etapa === "negociacao" || ...`. A etapa vem da `vw_funil`,
que so recalcula quando o board recarrega — entao quem tinha acabado de receber
mensagem **nao via o campo**, mesmo com a janela aberta, ate o proximo load.

Agora quem decide e a **ultima mensagem recebida**, que ja veio junto da thread:
zero chamada a mais, e o rodape mostra *"Janela aberta · fecha em 3h"* ANTES de a
pessoa escrever. Com a janela fechada, no lugar do campo aparece o motivo e o
botao TEMPLATE — o mesmo remedio da §29.2 item 2, que e o erro que custa R$ 0,43.

### 33.2 Arquivo proprio, e a duplicacao que isso assume

`app/chat/page.tsx` passa de 2.900 linhas e a bolha de la esta amarrada a
presenca, ligacao, respostas rapidas, picker e ao layout D1. Extrair aquilo
mexeria na tela que a equipe usa o dia inteiro para entregar uma que ela ainda nao
viu. `app/page.tsx` tambem ja passa de 3.000. Mesma decisao e mesmo motivo de
`app/chat/ligacao.tsx` (§22.8): modulo proprio, superficie de contato pequena.

⚠️ **Existem agora DUAS renderizacoes de bolha no projeto.** Mudou o desenho da
bolha, muda nas duas. E custo assumido — a alternativa trocava esse custo por
risco em producao.

### 33.3 O poll de 5 SEGUNDOS que ninguem tinha visto

O card ampliado rodava `setInterval(..., 5000)` contra `/api/mensagens`: **12
requisicoes por minuto por card aberto**. Nao queimava cota do RD (e Supabase),
mas e exatamente o vicio que a §15.1 corrigiu no board — polling incondicional que
escala com abas abertas, nao com trabalho real. Morreu junto: a `<Conversa>` usa
**60s**, a mesma rede de protecao do /chat.

### 33.4 O que NAO mudou

O card pequeno da coluna continua com a previa curta e o seu `<input>` inline de
resposta rapida. A conversa completa vive no card **ampliado** (a lupa) — num card
de ~250px de largura um chat nao cabe. Se a intencao era trocar tambem o input do
card pequeno, e um passo a parte.


## 35. Contato novo pelo numero, e o bug que derrubou o board (25/08/2026)

### 35.1 O board caiu inteiro por causa de um `charAt` — e a culpa foi da 0100

Depois da 0100 a producao ficou com **"Application error: a client-side
exception has occurred"** no board, dentro e fora do hub.

```
TypeError: Cannot read properties of null (reading 'charAt')
web/app/page.tsx:268
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
```

**A causa foi a propria 0100**, nao a PR do card-chat que chegou junto. Ao parar
de exigir mensagem de operador e RCA de carteira ativa, o board passou a receber
os cards da **fila de nao atribuidos** — e neles `vendedor` chega **NULO**.
Nunca tinha chegado antes, entao um `cap()` sem guarda que vivia ali havia meses
so entrou em contato com null naquele dia.

⚠️ **O tipo mentia**: `Card.vendedor` era `string`, e por isso o TypeScript nunca
apontou o risco. Corrigido para `string | null` — e foi o proprio compilador que
revelou **mais tres pontos** que o `grep` nao tinha achado (a lista de chips e
duas indexacoes de cor). **Quando uma view passa a devolver null num campo,
corrigir o TIPO acha os chamadores; procurar por texto, nao.**

**Licao de metodo, essa custou um revert desnecessario:** eu descartei a PR nova
por leitura de codigo (tudo nela estava dentro do bloco do card, que so renderiza
apos o clique) e nao desconfiei da minha propria migration, aplicada minutos
antes. Reverter a PR nao consertou nada. O que resolveu foi parar de deduzir e
**executar**: subir o build de producao local e dirigir o Chrome headless por
CDP com cookie de admin — a excecao apareceu na primeira tentativa.

Receita, que vale para a proxima:
```
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/perfil
# Node 22+ tem WebSocket nativo: da para falar CDP sem puppeteer.
# Runtime.enable + Console.enable -> Network.setCookie -> Page.navigate
```
⚠️ Em headless sem layout, **`innerText` volta VAZIO** mesmo com a pagina
renderizada. Medir por `innerHTML.length`, `document.title` ou `querySelectorAll`
— foi por isso que o primeiro teste pareceu "tela em branco" quando nao era.

### 35.2 Novo contato — `POST /api/chat/novo-contato`

Botao **+** ao lado da busca do chat: telefone e nome opcional.

- **Normaliza** o que for digitado (mascara, `+55`, com ou sem o nono digito) em
  `web/lib/telefone.ts`. Recusa numero incompleto em vez de criar contato
  truncado que nunca receberia nada.
- **Acha antes de criar**, pelos 8 ultimos digitos — a mesma chave do webhook e
  do ETL (§16.3). Numero ja conhecido abre a conversa existente.
- **Mesmo id sintetico do webhook** (`wa:<numero>`): quem escrever depois cai na
  MESMA conversa, sem duplicar.
- **Dono**: o do ERP se o telefone bater em `wth_carteira`; senao a carteira de
  quem cadastrou, quando e vendedor. Admin e home nao tem carteira, entao o
  contato nasce na fila de nao atribuidos.
- **Nao envia nada.** Cadastrar e mandar mensagem sao gestos separados: um
  clique em "abrir conversa" nunca deve disparar mensagem para numero digitado
  errado. Fora da janela de 24h, o primeiro contato sai por template.

O contato recem-criado ainda nao tem mensagem, entao a view (que exige conversa)
nao o devolve — ele fica na lista **localmente** e some de la sozinho quando o
servidor passar a manda-lo, com o mesmo `cliente_id`.

⚠️ `normalizarTelefone` mora em `lib/`, nao na rota: um `route.ts` do Next so
pode exportar handlers, e um export a mais quebra o build com um erro de tipo
que **nao menciona a causa** (`does not satisfy the constraint { [x: string]:
never }`).

Verificado em Chrome headless contra o build de producao: form abre, mascara
normalizada, numero existente abre a conversa certa, repeticao nao duplica,
numero incompleto e recusado. Zero excecao nas duas telas.


## 36. Pendencias — o que o board nao consegue classificar (25/08/2026) — migration 0101

`/admin` → aba **⚠️ Pendencias**. Pedido do usuario: os clientes sem telefone,
e os que nao estao na carteira de nenhum vendedor do board, *"nao podem ficar
sem serem visualizados pelo admin"* — mesmo antes de existir a funcao que
resolve cada caso.

### 36.1 O principio, que vale alem desta tela

**Um registro que o sistema nao sabe classificar nao pode simplesmente nao
aparecer.** Foi exatamente assim que a conversa da §34 ficou invisivel por
meses: havia ate uma metrica registrando o caso
(`vw_carteira_conflito.no_board`), mas contagem escondida em view de
diagnostico nao e visibilidade — **tela e**.

Por isso a view **nao resolve nada, de proposito**. As acoes vem depois; o que
nao pode e o caso nao ter dono.

### 36.2 Os quatro grupos (medidos em 25/08/2026 — total 438)

| | n | o que e | onde se resolve |
|---|---|---|---|
| **A** sem telefone | 102 | cliente da carteira sem numero: nao ha canal possivel, nem template | cadastro do WinThor |
| **B** sem contato criado | 145 | esta na carteira e tem telefone, mas nao existe linha em `clientes` — o envio precisa de uma | **tem conserto automatico** (mesma logica de /api/chat/novo-contato) |
| **C** conversa sem cadastro no ERP | 79 | alguem falando conosco que nao e cliente de ninguem | cadastrar, atribuir ou descartar |
| **D** RCA fora do board | 112 | cliente de outro time (GC/IS) que conversou; desde a 0100 cai na fila em vez de sumir | decidir de quem e |

O grupo E que eu tinha previsto (sem CPF) deu **zero** — aquele buraco ja foi
fechado em algum momento anterior.

### 36.3 O `.csv` e a peca que faz a tela valer HOJE

A maioria destes casos se resolve **fora do CRM**, no cadastro do ERP. Sem a
exportacao, a tela seria so um numero para o admin olhar e nao poder agir. O
arquivo sai com `;` e BOM porque e o que o Excel em pt-BR abre sem pedir
importacao.

A tabela mostra 600 linhas e diz quantas ficaram de fora; o csv leva tudo.
Truncar em silencio seria a mesma doenca que a tela existe para curar.

### 36.4 Armadilha de edicao (custou dois ciclos de build)

Ao gerar codigo TS por script, `"﻿"` e `"
"` viraram **o BOM de
verdade e uma quebra de linha real** dentro do literal — string nao terminada. O
conserto foi montar os dois em runtime (`String.fromCharCode`), que e imune a
mais uma rodada de escape. Vale para qualquer edicao automatizada de fonte que
contenha escapes.

### 36.5 Pendencias da propria pendencia

- **Grupo B tem conserto automatico** e ainda nao foi feito: provisionar as 145
  linhas em `clientes` fecha o grupo e destrava o envio para a carteira inteira.
- Os grupos A, C e D precisam de decisao humana antes de qualquer botao.


## 37. O admin escolhe por qual numero o CRM fala (25/08/2026) — migration 0102

Sintoma que originou isto, com print: o usuario digitou um numero que **ja
existia no RD**, a conversa abriu — e o envio devolveu so **`RD 429`**. Ele leu
como *"o sistema nao permitiu falar com esse numero"*. Era a cota da API do RD
estourada, que passa sozinha em um minuto.

**Erro que nao diz o que fazer vira diagnostico errado, e diagnostico errado
vira pedido de mudanca na coisa errada.** Mesma licao da §22.6.1, do lado da
Meta; aqui o texto util nem existia.

### 37.1 A decisao de canal passa a ter dono

`canalDeResposta()` decidia POR CONVERSA (responde pelo canal em que o cliente
falou por ultimo, §16.3). Continua sendo um bom padrao, mas agora existe uma
precedencia acima dele:

| ordem | quem decide | por que |
|---|---|---|
| 1 | `wa:*` -> sempre Cloud | o RD nao conhece esse contato; a rota de mensagem livre endereca pelo `_id` DELE. Enviar pelo RD e falha garantida — sobrepoe ate a escolha do admin |
| 2 | **`crm_config.numero_envio`** | a escolha do admin, valendo para mensagem, template e ligacao em QUALQUER contato |
| 3 | o canal da ultima mensagem recebida | o automatico de sempre, quando nada foi escolhido |

`numero_envio` nasce **NULO** (= automatico): nenhum deploy troca o canal de
sete pessoas por efeito colateral.

⚠️ **`numero_envio` guarda `'rd' | 'cloud'`, NAO o `phone_number_id`.** Quem
carimba `linha_id` na mensagem enviada e `linhaDeEnvio()`, que le a env
`WHATSAPP_PHONE_NUMBER_ID`. Guardar o id aqui criaria uma segunda fonte para a
mesma decisao, e o sintoma seria mensagem saindo por um numero e sendo
registrada como de outro. Enviar por VARIAS linhas Cloud e outra feature — o
lugar de mudar seria a env virar tabela, nao esta coluna.

### 37.2 A JANELA DE 24H E POR NUMERO — e a tela nao sabia

Este era o bug que a mudanca ia introduzir. Com o admin escolhendo Cloud, um
cliente que respondeu ha 10 minutos **no RD** nao tem janela aberta na Cloud.
Mas a faixa do chat e a do card contavam a janela sobre a conversa INTEIRA:
diriam *"aberta, fecha em 23h"*, liberariam o campo, e o envio falharia com
131047 — com o texto ja escrito.

Corrigido: `/api/chat/thread` devolve `canal_envio` (ja com a escolha aplicada) e
as duas telas so contam mensagens daquele canal. **A faixa existe justamente
para evitar escrever a mensagem inteira e descobrir depois; contar a janela
errada a transformaria no oposto.**

### 37.3 ENVIO ≠ VISIBILIDADE

Sao dois interruptores, e a tela precisa dizer isso:

| | pergunta | coluna |
|---|---|---|
| **Numero de envio** | por qual numero eu FALO | `numero_envio` |
| **Conversas visiveis** | o que eu VEJO na tela | `linhas_visiveis` |

Da para acompanhar o historico do RD e ja estar respondendo pelo numero novo. Um
so knob juntaria duas decisoes que nao sao a mesma.

### 37.4 Provisionamento do grupo B (108 de 145)

O grupo B da §36 era o que impedia *"enviar para qualquer um de seus clientes"*:
esta na carteira, tem telefone, e nao havia linha em `clientes` para o envio
usar. Provisionados **108**; o grupo caiu de 145 para 37.

Os **37 restantes tem telefone malformado no WinThor** (`92775900` sem DDD,
`919925573999` com digito a mais) e o normalizador os RECUSA de proposito:
criar contato com numero invalido so empurra a falha para o dia do envio. Ficam
visiveis na tela de Pendencias, que e onde devem estar.

⚠️ Nao gera card duplicado: o contato novo nasce sem mensagem, entao nao entra
no ramo 1 da view, e o card de prospeccao continua sendo o unico. Quando o
primeiro template sair, ele troca de coluna — nao ganha um irmao. Conferido:
zero `cliente_id` duplicado depois da carga.

### 37.5 O bug que so o teste pegou

A rota do /admin extraia o valor assim:
```ts
const valor = typeof b.valor === "boolean" || Array.isArray(b.valor) ? b.valor : b.ciclo_ativo;
```
Para uma **string** (`"cloud"`) isso caia no fallback e virava `undefined` — a
tela salvava e nada mudava, **sem erro visivel**. So apareceu ao dirigir o
navegador de verdade e conferir o radio DEPOIS do clique.

Vale como regra: quando um endpoint aceita tipos diferentes por chave, testar um
tipo nao testa os outros. O conserto foi `"valor" in b ? b.valor : b.ciclo_ativo`.

### 37.6 O que NAO foi feito, por decisao do usuario

**Contornar a cota do RD.** O 429 sobreviveu as 5 tentativas com backoff que ja
existiam — a cota estava mesmo saturada. O usuario foi explicito: *"nao e uma
preocupacao minha resolver isso, pois estamos desenvolvendo uma nova ferramenta
que ira funcionar independente do rd conversas"*. Ficou so a **traducao do
erro** (`lib/erroRd.ts`), porque custa dez linhas e evita o diagnostico errado.
Nao investir mais no lado do RD.


## 38. "Minha carteira" no chat — a agenda ao lado das conversas (25/08/2026)

Quinta opcao no dropdown do chat: **todos os clientes do RCA do vendedor**, com
ou sem conversa. Pedido do usuario: *"como se fosse mesmo a funcao contatos do
whatsapp"*.

Volume medido: **961 (luana), 955 (kamilly), 754 (romulo), ~500 os demais** —
4.692 no total. **98% ja tem contato aberto**, entao clicar e conversar funciona
quase sempre.

### 38.1 A identidade — o ponto delicado, e como foi resolvido

O board identifica cliente de prospeccao por `winthor:<codcli>`: id sintetico,
sem thread, que serve para desenhar card e nada mais. O chat precisa do contato
REAL para abrir conversa e enviar. Sao **fontes diferentes para a mesma pessoa**.

A solucao foi **nao misturar as duas listas**:

| lista | chaveada por |
|---|---|
| conversas (as 4 filas) | `cliente_id` |
| **carteira (a agenda)** | **`codcli`** |

O dropdown ALTERNA entre elas. Sem merge, nao ha como nascer linha duplicada —
que e o risco de forcar a mesma view a servir os dois usos.

Cada linha da agenda carrega os dois ids, com `cliente_id` resolvido no servidor:
`wth_vinculo` (CPF) → `clientes` com o mesmo telefone (8 digitos) → NULO.

No clique: se o `cliente_id` ja esta entre as conversas carregadas, seleciona
**aquele objeto** — assim nao-lidas, status e transferencia ficam certos. Se nao
esta, monta a conversa na hora, reusando a maquinaria do botao + (§35.2).

### 38.2 Rota propria, e nao mais um recorte de /api/chat

As quatro filas sao recortes da lista que o chat JA tem em memoria — custam
zero. A carteira sao ate 961 linhas por vendedor que nao sao buscadas hoje.
Enfia-las no carregamento inicial encareceria toda abertura do chat por uma aba
que quase nunca e a primeira. `/api/chat/carteira` e chamada **so quando a aba
abre, uma vez por sessao**.

Ordem **alfabetica** (e uma agenda, nao uma caixa de entrada) e a busca da
sidebar filtra. Com ~900 nomes, procurar e o caminho principal; a lista corta em
400 e **diz quantos ficaram de fora**.

### 38.3 Os 96 sem contato aparecem INERTES, nao somem

58 sem telefone no WinThor + 38 cujo telefone nao confere com nenhum contato.
Ficam na lista esmaecidos, com o motivo — mesmo principio da §36: sumir em
silencio e a doenca, nao o remedio.

### 38.4 ⚠️ React #310 — o hook depois do `return`

O `useEffect` que dispara a carga foi escrito junto do resto da logica da
carteira, por volta da linha 1500. So que a partir da **1436** o componente tem
`if (sessao === undefined) return ...`. Hook depois de um return e chamado num
render e nao no outro: **React #310, chat em branco**.

O proprio arquivo ja avisa disso no comentario do `abaPadrao` ("depender da
ordem de declaracao dentro do render e o tipo de acoplamento que quebra em
silencio") — e eu cai mesmo assim. **`tsc` e `next build` passaram limpos**; so
o teste no navegador pegou. O efeito agora mora junto do estado, na linha 658.

Regra que fica: em `chat/page.tsx` e `page.tsx`, **todo hook vai para o topo**,
antes de qualquer `return` condicional. Build verde nao prova que a tela abre.


## 39. Historico do RD a um clique, dentro da conversa (25/08/2026) — migration 0103

### 39.1 O contexto que explica TODAS as chaves de ligar/desligar

O usuario declarou, ao pedir esta: *"o objetivo de ter chaves para ligar e
desligar as coisas e porque estou me preparando e testando aos poucos, para
mudar, sair do rd conversas de vez e ficar so com o murano professional... quero
ver os comportamentos"*.

**As chaves nao sao preferencia de tela; sao instrumento de migracao.** Cada uma
existe para simular um pedaco do cenario pos-corte e medir o estrago antes de
ele ser irreversivel. Isso muda como avaliar pedidos futuros: o padrao certo de
uma chave nova e "reproduz o depois", e o valor dela e poder VOLTAR.

### 39.2 O problema medido

Com `linhas_visiveis` em "so Murano Professional", abrir um cliente mostrava
**"Sem mensagens ainda"** — e havia, no banco:

| | |
|---|---|
| clientes da carteira com historico oculto | **3.769** |
| mensagens ocultas | **88.523** (media de 23 por cliente) |
| conversaram nos ultimos 30 dias | **2.553** |
| conversaram nos ultimos **7 dias** | **567** |

A tela nao estava so omitindo: **afirmava algo falso**, e o vendedor ligava
achando que era primeiro contato. Isso nunca foi pedido — o que ele tirou foi o
RD de ORGANIZAR AS COLUNAS; o historico foi junto porque `linhas_visiveis`
decidia as duas coisas com a mesma chave.

### 39.3 A forma foi escolhida pelo usuario, e e melhor que a minha proposta

Eu propus **misturar** as mensagens do RD na thread quando a chave estivesse
ligada. Ele preferiu **copiar o que o proprio RD faz**: um botao "ver historico"
dentro da conversa. Tres razoes pelas quais e melhor:

1. a thread continua sendo **o que aconteceu neste numero** — nao funde dois
   canais como se fossem um;
2. o historico vem **rotulado** ("inclui o historico do Murano Pro"), entao
   ninguem confunde a origem;
3. nao paga o custo de carregar 23 mensagens por conversa que quase nunca serao
   lidas.

`/api/chat/thread` sem parametro devolve so o numero em uso **mais a contagem do
que ficou de fora** (`historico_oculto`); com `?historico=1`, devolve tudo.

⚠️ A contagem e **total menos visivel**, com duas consultas de cabecalho, e nao
a negacao de `filtroLinhas`: negar o filtro a mao criaria uma segunda regra que
divergiria dele no primeiro ajuste — e o sintoma seria um botao prometendo
historico que nao existe.

### 39.4 O que a chave NAO afeta

A **janela de 24h** continua contando so o numero de envio (§37.2), entao trazer
o historico do RD nao faz a tela achar que ha conversa aberta na Cloud. As duas
coisas compoem sem se contaminar — e era o risco obvio de misturar canais numa
thread so.

### 39.5 Pendencias que o usuario deixou ao encerrar o dia

Registradas tambem na memoria (`crm-proximas-features`):

1. **Clicar no nome no board deve abrir o NOSSO chat**, nao o RD (`URL_CHAT` em
   `page.tsx` ainda aponta para `app.tallos.com.br`).
2. **A lupa deve mostrar a MESMA tela do chat** — cabecalho com acoes, abas do
   painel, faixa da janela e a barra do compositor. Hoje e o `conversa.tsx`, mais
   enxuto.
3. **Pedido emitido nao pode FIXAR o card**: gatilho continua a nota fiscal, mas
   **7 dias apos a compra o card volta para Lista de prospeccao**. O usuario
   autorizou **substituir a regra do mes corrente** (§32.6), que conflita.


## 40. Board aponta para o nosso chat, e Pedido emitido para de fixar o card (25-26/08/2026) — migration 0104

Dois itens da lista que o usuario deixou ao encerrar o dia.

### 40.1 Clicar no card abre o NOSSO chat

`page.tsx` mandava para `app.tallos.com.br/app/chat/<id>` — tirava o vendedor do
sistema **no gesto mais frequente da tela**, e com o RD sendo aposentado mandava
para o lugar errado. Agora `router.push('/chat?cliente=<id>')`, na mesma aba:
board e chat sao o mesmo app, entao navegar e instantaneo e o voltar funciona.

Card de prospeccao (`winthor:<codcli>`) nao tem thread — usa o `rd_cliente_id`,
que e o contato real casado por telefone; sem ele, segue abrindo o `wa.me`.

No `/chat`, `?cliente=` e lido **uma vez** e guardado em ref: sem isso, qualquer
recarga da lista puxaria a selecao de volta, tirando o vendedor de onde ele foi
parar. Se o cliente nao esta na lista (contato sem conversa, ou fora do filtro),
busca o minimo em `/api/chat/thread` e monta a conversa — mesmo caminho do botao
+ e da aba de carteira.

⚠️ O efeito do deep link roda ACIMA de `abrir()` no arquivo, e hook nao pode
descer para depois do `return` condicional (§38.4). A ponte e um `abrirRef`.

### 40.2 Pedido emitido: 7 dias, nao o mes

Pedido do usuario: *"o comportamento do board esta fixando o card la, eu nao
quero isso, quero que ele se mova igual aos outros... 7 dias apos a compra
realizada, esse card pode ir para lista de prospeccao"*. Autorizou substituir a
regra antiga.

**Isto substitui a §32.6**, escrita poucas horas antes. Aquela consertou o card
que nunca saia (a coluna acumulava desde abril) fazendo a coluna ser o mes
corrente — mas mantinha um degrau: quem comprava no dia 2 ficava preso quase 30
dias. A regra nova e por **idade da compra**, nao por calendario.

Medido em 25/08: a coluna cai de **594 para 167 clientes**; para a Milene, de
145 para 41, e a prospeccao dela sobe de 367 para 460. Os que saem **nao somem**
— voltam para prospeccao ou para a etapa que a conversa indicar.

⚠️ **SAO DOIS LADOS, e esquecer um deles faz o card sumir da tela.**

| lado | o que faz |
|---|---|
| `vw_pedido_bi_card` | ganhou o periodo `7d`, que passa a ser o universo da coluna |
| prospeccao das views do funil | EXCLUI quem comprou — precisou passar de "no mes" para "nos ultimos 7 dias" |

Se so o primeiro mudasse, o cliente que sai da coluna aos 7 dias ficaria **fora
das duas** ate o dia 1o. As duas views (`vw_funil` do ETL e `vw_funil_visivel`
da tela) andam juntas pelo motivo da §32.2. Conferido: prospeccao 4.524 + coluna
167 = **4.691**, a carteira exata, com zero `cliente_id` duplicado.

### 40.3 O KPI do cabecalho segue sendo o do MES — e agora diz isso

O total "R$ X · N VENDAS" continua acumulando o mes, porque e o numero comercial
que o time acompanha. Mas com a coluna em 7 dias os dois **passam a discordar na
tela**, e sem rotulo pareceria que um deles esta errado. Ganhou o selo **NO MES**
e o `title` explica a diferenca.

### 40.4 Armadilha de edicao, de novo

Editar por script uma string TS que contem `
` literais: o helper converteu os
escapes em quebras de linha reais e quebrou o literal. Segunda vez no dia (a
primeira foi na §36.4, com `﻿`). **Para strings com escapes, usar edicao
direta de arquivo, nao substituicao por script.**


## 41. A lupa do board VIROU o /chat, embutido (26/08/2026)

Pedido: a lupa devia mostrar a mesma tela do chat — cabecalho com acoes, abas do
painel, faixa da janela, barra completa do compositor. **A ideia do usuario foi
melhor que a minha**: em vez de reconstruir aquilo, reusar a **visao de celular**
do proprio chat.

### 41.1 Por que sai quase de graca — duas coisas que ja existiam

1. **`isMobile` e `window.innerWidth < 768`.** Dentro de um iframe de 500px,
   `innerWidth` e a largura DELE. A visao de celular liga **sozinha**, sem
   layout novo. Medido: iframe 500x628, "so a thread", sem a lista.
2. **`modoApp`** (do PWA, §29) ja escondia a navegacao do topo. Bastou aceitar
   tambem `?embed=1`.

A lupa passou a ser `<iframe src="/chat?cliente=X&embed=1">`.

### 41.2 O ganho de verdade: uma tela de conversa, nao duas

Quando criei `conversa.tsx` (§33.2), registrei que estava aceitando **duas
renderizacoes de bolha no projeto** — "mudou o desenho, muda nas duas". Essa
divida **morreu aqui**: o arquivo foi removido, e agora existe UMA tela de
conversa. Toda melhoria futura do chat aparece na lupa de graca.

Trocado de barato (o componente enxuto) por completo: a lupa ganhou Pegar
atendimento, Cliente, Ligar, Transferir, Resolver, abas do painel, respostas
rapidas, anexo e audio — nada disso ela tinha.

### 41.3 Tres armadilhas tratadas

**Microfone.** `allow="microphone; autoplay; clipboard-write"` NAO e opcional:
em iframe o padrao do navegador para `microphone` e `self`, entao sem delegacao
o botao Ligar falha com `NotAllowedError` **e sem prompt** — erro identico ao de
"o usuario bloqueou", mas nao ha nada que ele possa liberar no cadeado. E a
armadilha da §22.5, que ja custou uma hora naquela vez.

**A lista nao e carregada.** Embutido mostra UMA conversa; buscar as ~3.900 so
para isso seria o desperdicio que a §15.1 corrigiu no board. Consequencia: o
deep link nao pode ESPERAR pela lista — embutido resolve o cliente direto na
thread.

**Altura por `flex`, nao por pixel.** O cabecalho do card varia (selo de ciclo,
"sem cadastro", aviso de disparo), entao um calculo fixo sobra ou falta conforme
o card. O iframe preenche o que sobra (`flex: 1`, `minHeight: 300`) e a janela
passou a `height: min(78vh, 720px)` — ela hospeda um chat inteiro agora, nao uma
previa.

### 41.4 O custo assumido

Um segundo React montado dentro do board enquanto a lupa esta aberta: mais
memoria e ~1s a mais na primeira pintura, alem de uma conexao Realtime extra.
Aceitavel porque so uma lupa fica aberta por vez — e o preco de nao ter duas
telas de conversa para manter.

A alternativa era extrair a coluna da thread de `chat/page.tsx` para um
componente compartilhado: mais limpo no papel, e recusado pelo mesmo motivo da
§33.2 — aquele arquivo passa de 2.900 linhas com a thread amarrada a presenca,
ligacao, picker e layout D1, e mexer nele para entregar OUTRA tela e a troca que
ja custou producao nesta mesma sessao.


### 41.5 Compactacao do modo embutido (26/08/2026)

Primeiro retorno do usuario com print: *"o espaco para a conversa em si ficou
muito estreito... diminuir os icones de ligar, transferir, resolver, de maneira
que tudo caiba somente em uma linha... chat, indicadores, talvez nao seja viavel
manter aparecendo nessa visualizacao"*.

Tres desperdicios de altura, todos corrigidos so no modo embutido (`compacto`):

| | antes | agora |
|---|---|---|
| barra do produto (logo, "Chat", Indicadores, avatar) | ~52px + faixa de 3px | **some** — dentro da lupa ela nao navega para lugar nenhum |
| acoes (Cliente, Ligar, Transferir, Resolver, WhatsApp) | texto completo, quebrando em 3 linhas a 500px | **icone so**, numa faixa propria que nao quebra |
| botoes do compositor | 42x42 | 34x34 |

As acoes ganharam `flexBasis: 100%` para ficar numa linha propria: dividindo a
faixa com o nome, elas quebravam em tres — e cada quebra come altura da
conversa, que e o motivo de a janela existir.

O texto de cada acao **nao se perdeu**: virou o `title`, que todos os botoes ja
tinham. Nada precisou ser inventado.

⚠️ **Licao de metodo.** Duas sondas de DOM me disseram "3 linhas" quando as
acoes ja estavam em uma: eu media `getBoundingClientRect().top`, e botoes de
alturas diferentes centralizados na MESMA linha tem tops diferentes. O que
resolveu foi **capturar a tela** (`Page.captureScreenshot` via CDP) e olhar.
Para layout, screenshot > sonda numerica — a sonda mede o que voce pensou em
perguntar, a imagem mostra o que esta la.


## 42. Pedido emitido (3 dias) -> Vender novamente (18) -> Prospeccao (26/08/2026) — migration 0105

Substitui a regra dos 7 dias da §40.2, escrita no dia anterior. O usuario
confirmou as tres objecoes que levantei antes de implementar.

### 42.1 A regra e funcao de UM numero

    dias desde a ultima compra:  0..2 -> pedido_emitido
                                 3..18 -> vender_novamente
                                 >18  -> sai (prospeccao / etapa da conversa)

**"Voltar para Pedido emitido ao comprar de novo" sai de graca**: a venda nova
muda `ultima_compra`, o contador zera e a etapa se recalcula. Nao ha estado
guardado, nada para sincronizar, nada que possa ficar preso — que era o defeito
das duas versoes anteriores desta coluna.

Por isso a fonte deixou de ser `vw_pedido_bi_card` (uma linha por cliente POR
PERIODO, boa para recortes do dropdown) e passou a ser **`vw_venda_card`**: uma
linha por cliente, com a etapa ja decidida no banco.

Medido em 26/08: **94 em Pedido emitido, 377 em Vender novamente**.

### 42.2 As tres objecoes, e o que o usuario decidiu

**1. A pilha nao some, muda de coluna.** Tirar 167 de uma coluna e criar uma com
377 nao resolve "por que aparecem tantos cards" — a janela e 6x mais longa e o
time fatura ~35 clientes/dia. O usuario aceitou: a diferenca e que Vender
novamente **e fila de trabalho** (ha o que fazer: reabordar), e Pedido emitido
era trofeu.

**2. O selo do mes mentiria.** "Valor total no mes vigente" era o pedido
original: quem comprou em 30/08 e esta em Vender novamente em 02/09 apareceria
com **R$ 0**. `valor` passou a somar a janela de 18 dias — as compras que
justificam a posicao do card. Conferido: **zero selos zerados**.

**3. Conversa aberta ganha de tudo.** Sem isso, quem esta respondendo AGORA
ficaria em Vender novamente por 18 dias em vez de Negociacao — e reabordar quem
ja fala com voce e ruido. A view marca `conversa_aberta` (recebida ha <24h) e o
/api/funil deixa esses cards na coluna da conversa. Hoje sao 9; depois da
migracao do numero, muitos mais.

### 42.3 ⚠️ O off-by-one que colocou 40 clientes em duas colunas

A view segurava `dias <= 18`; a prospeccao excluia `data > hoje - 18`, que e
`dias <= 17`. **Quarenta clientes no 18o dia apareciam nas duas colunas.**

Achado so ao conferir a sobreposicao com dado real DEPOIS de aplicar — nao pelo
build, nao pelo tsc, nao pela leitura. E o mesmo comparador estava errado na
soma do selo: o cliente no 18o dia entraria com `valor = 0`, exatamente o furo
que a decisao 2 existia para tapar.

**Regra que fica: quando duas regras delimitam a MESMA janela, comparar os dois
lados com dado real antes de dar por pronto.** Escrever `<= 18` de um lado e
`> hoje-18` do outro parece igual e nao e.

### 42.4 Armadilhas de processo repetidas nesta sessao

- **`
` em string TS editada por script** virou quebra de linha real de novo
  (3a vez: §36.4, §40.4, aqui). Para strings com escapes, edicao direta.
- **`rm -rf .next` com o `next start` rodando** travou um build por mais de 20
  minutos. Matar o servidor antes de limpar.


## 43. Colunas rolam na horizontal, e "salvar contato" (26/08/2026)

### 43.1 A sexta coluna caia para baixo

`gridTemplateColumns: repeat(5, minmax(0,1fr))` — **cinco trilhas fixas**. Ao
entrar Vender novamente (0105), ela quebrava linha e aparecia sob a Lista de
prospeccao.

Trocado por `gridAutoFlow: column` + `gridAutoColumns: minmax(330px, 1fr)` +
`overflowX: auto`. Mantem a largura que as colunas ja tinham (~334px com cinco),
deixa a sexta transbordar para a barra em vez de encolher todas, e **uma setima
coluna um dia nao vai exigir mexer aqui**. Medido: 6 colunas em 1 linha, 330px
cada, `scrollWidth 2040 > clientWidth 1440`.

### 43.2 Nao existia como SALVAR um contato

Pergunta do usuario: *"contatos novos que caem em fila de espera, o vendedor
atende, como ele faz pra salvar?"*. Conferido: **nao existia**. `clientes` so era
escrita pelo ETL, pelo webhook e pela criacao — nada editava.

Consequencia visivel: o webhook grava o nome do PERFIL do WhatsApp, que as vezes
e o proprio numero. Havia um contato na fila chamado literalmente
**"551152826842"**, e ele ficaria assim para sempre.

O ✋ **Pegar atendimento ja resolvia o DONO** (via `chat_transferencia`); o que
faltava era a IDENTIDADE.

### 43.3 O CPF liga ao ERP sozinho — nao escrever `wth_vinculo` a mao

`wth_reconciliar_vinculos()` casa CPF e preenche o vinculo a cada 10 minutos
(§10.5). Gravando o CPF em `clientes`, o card ganha codcli, RCA oficial e todo o
historico de compra **pela maquina que ja existe** — em vez de uma escrita
paralela que o proprio job poderia desfazer no ciclo seguinte.

Por isso o formulario e so **nome + CPF/CNPJ**, e o aviso diz que o vinculo
aparece "em ate 10 minutos".

⚠️ **Verificado ANTES de escrever que a edicao persiste:** o ETL so faz
`clientes.set(...)` dentro do laco dos NOVOS — contato conhecido e filtrado
antes (§25.2) — e o webhook so cria quando nao acha por telefone. Nenhum dos
dois reescreve nome de contato existente. Sem essa checagem, o nome salvo
poderia ser sobrescrito na proxima sincronizacao e ninguem entenderia por que.

### 43.4 Permissao

Dono efetivo da conversa, ou admin/home. **Dono NULO nao bloqueia**: a fila e de
todos, e quem atende precisa poder salvar — era o caso do pedido. Card sintetico
do ERP (`winthor:`/`venda:`) e recusado com 422: nao e contato, e cliente.

Verificado na rota: CPF incompleto recusa, card do ERP recusa, nome valido grava.

## 44. O princípio que governa daqui em diante (27/08/2026)

Declarado pelo usuário, e vale mais que qualquer seção anterior deste arquivo
quando houver conflito:

> *"considerar coisas do rd conversas atualmente ficou obsoleto. a única
> importância que temos no momento relacionada com rd conversas é o etl
> continuar alimentando o banco, para que, se quisermos, termos o histórico, se
> eu quiser ligar uma chave mostrar histórico, então podemos, mas fora isso, não
> há necessidade de considerar o rd conversas."*

E, sobre as chaves de ligar/desligar que se acumularam:

> *"o objetivo de ter chaves para ligar e desligar as coisas é porque estou me
> preparando e testando aos poucos, para mudar, sair do rd conversas de vez e
> ficar só com o murano professional... quero ver os comportamentos"*

**Consequências práticas, para não reabrir discussões encerradas:**

1. **Conversa que só existe no RD = não existe.** É essa a simulação. Nenhuma
   tela deve anunciar "há N mensagens no outro número" a menos que a chave
   `historico_rd` esteja ligada.
2. **Não propor melhorias no lado do RD.** O usuário já recusou investir no 429
   da cota (§37.6). Traduzir erro, sim; otimizar, não.
3. **Pendências de carteira do RD e da Murano Shop foram descartadas** por ele
   em 27/08. Não voltar com elas.
4. O ETL continua rodando e **não deve ser desligado** — é o que garante o
   histórico caso a chave seja ligada um dia.

## 45. Modo migração — a Fase C simulada, com volta (27/08/2026)

`/admin` → Mecanismos → **Modo migração — sem RD Conversas**.

### 45.1 NÃO é uma quinta coluna no banco

Esta é a decisão central. O modo **é** a leitura das quatro chaves que já
existem, todas na posição de migração ao mesmo tempo:

| chave | posição | efeito |
|---|---|---|
| `linhas_visiveis` | sem `rd` | nenhuma conversa do RD na tela |
| `historico_rd` | `false` | nem sob demanda, pelo botão |
| `carteira_rd_ativa` | `false` (0107) | dono é só o RCA do WinThor |
| `numero_envio` | `cloud` | tudo sai pelo número próprio |

Uma quinta coluna independente entraria em contradição com elas no primeiro
ajuste — "modo migração ligado" convivendo com "RD marcado nas linhas visíveis"
— e ninguém saberia qual vence. Mesma armadilha que a 0099 resolveu ao
substituir `conversas_rd_visiveis` pelo seletor (§32).

Dois efeitos colaterais bons: **não há snapshot para guardar** (desligado = o
CRM de sempre) e **zero migration** para a chave em si. `modoMigracao()` e
`POSICAO_MIGRACAO` vivem em `lib/crmConfig.ts`.

Enquanto ligado, as quatro aparecem **travadas** no /admin ("definido pelo modo
migração") e os dois seletores somem.

### 45.2 `carteira_rd_ativa` (0107) — medido antes de escrever

Desliga a tag `carteira <nome>` do painel do RD como critério de dono, deixando
só o RCA. **Nasce ligada.**

| | |
|---|---|
| RCA e tag concordam | 4.420 — nada muda |
| divergem | 210 — o RCA passa a mandar |
| só têm a tag do RD | **335 — perdem o dono** |

Dos 335, **233 existem no WinThor sob RCA de outro time** — Francisco (2) 76,
Jorge (53) 38, Maiara (9) 37, Henry (30) 29, Adm. Venus (11) 20. Ou seja, nunca
foram do IS/ISR: estavam nas carteiras deles só porque alguém pôs a tag no
painel do RD. Para devolvê-los a um dono, basta cadastrar aquele RCA em
`carteira_config`. No board o efeito é menor: **78 cards** mudam de lugar, e
nenhum teve atividade nos últimos 30 dias.

### 45.3 O modo precisa alcançar TODAS as telas

A aba Envios do /admin exibia "3.533 pelo painel do RD" com a chave ligada — um
quadro inteiro nomeando o sistema que a chave diz não existir. Como cada aba
busca só os próprios dados, foi preciso um **contexto React** (`ModoMigracao`
em `app/admin/page.tsx`) para o modo chegar a todas.

Somem com a chave: o terceiro quadro e a coluna "pelo painel do RD", o bloco
"Templates do RD Conversas", a coluna e o campo "ID no RD", o link da Gestão de
carteira, o selo `RCA n · RD x` dos cards, o toggle Sinc/Pause do ETL e o botão
que puxa do RD. E `semMencaoRd()` troca a palavra nos textos de ajuda das
colunas — trocar no render, e não manter duas versões de cada texto, porque
duas cópias divergem no primeiro ajuste da régua.

## 46. O WinThor manda no nome (0108) — e duas travas que salvaram

Regra do usuário: *"se já existir no winthor então os dados cadastrados no
winthor devem prevalecer na visualização"*. É a §10.8 finalmente aplicada ao
NOME.

**O que consertou:** o botão "Salvar contato" gravava `clientes.nome_completo`,
que é o nome exibido. Num cliente já vinculado, digitar "rom" fazia o CRM
inteiro chamar de "rom" quem o ERP chama de ROMULO ALBUQUERQUE — **e para
sempre**, porque o ETL nunca reescreve contato já conhecido (§25.2). Havia um
caso assim no banco.

Também alinhou uma inconsistência antiga: `vw_venda_card` (0105) já usava o
nome do WinThor e as views do funil usavam o nosso — o mesmo cliente podia
aparecer com **dois nomes em duas colunas do mesmo board**.

### A migration morreu duas vezes, e cada erro ensinou

```
1a tentativa (esperava n = 1)  -> "em vw_funil_visivel esperava 1, achei 2"
2a tentativa (trocar todas)    -> "missing FROM-clause entry for table wcar"
```

A `vw_funil_visivel` é UNION de **três ramos**, e o padrão aparece em dois:

| ramo | FROM | troca? |
|---|---|---|
| 1 conversas | `clientes ... LEFT JOIN wth_carteira wcar` | **sim** |
| 1b ociosos (§31.3) | `clientes CROSS JOIN sel` (sem `wcar`) | **não** |
| 2 prospecção | `wth_carteira w`, já usa `w.nome` | já ok |

O ramo 1b **não pode** mudar, e não é detalhe técnico: o `WHERE` dele exige
`NOT EXISTS` em `wth_vinculo` **e** em `wth_carteira` — ele é, por definição,
quem **não existe no WinThor**. Não há nome do ERP para preferir. O Postgres
estava certo pelo motivo certo.

Solução: `position` + `overlay` para trocar só a **primeira** ocorrência, em vez
de `replace` (que troca todas). E nada foi aplicado pela metade nas duas
tentativas: `do $$` é uma transação só.

**Do lado da tela:** cliente com vínculo não tem mais formulário de "salvar
contato" — no lugar, a nota de que o cadastro vem do ERP e corrigir é lá.

## 47. Ficha de cadastro para o WinThor (0109)

`cadastro_cliente` (jsonb `dados`) + `crm_config.cadastro_campos`.

O consultor pede os dados à cliente pelo botão **Pedir os dados** (o texto vai
para a CAIXA DE MENSAGEM, não direto para o WhatsApp — quem envia é a pessoa),
cola a resposta num formulário ao lado da conversa, e a ficha espera alguém
digitar no ERP, com **Copiar** e **Já cadastrei**.

### A lista de campos NÃO está no código, e isso é o centro

**Não sabemos quais campos o WinThor exige.** O que temos é `wth_carteira`, uma
**projeção de consulta** com 8 colunas (codcli, cpf, nome, telefone, cidade,
estado, rca) — não a tela de cadastro do ERP, que pede endereço completo, IE,
fantasia e o resto.

Chutar no código faria o consultor pedir a lista errada e faltar campo na hora
de digitar: **perguntar duas vezes**, que é o problema que a ficha existe para
acabar. A lista mora em `crm_config.cadastro_campos`, editável em /admin (mesmo
padrão de `paginas_legais` e `texto_pausa`), com 14 campos de partida.

**A mensagem que pede os dados é GERADA da mesma lista** (`textoPedidoDeDados`
em `lib/cadastroCampos.ts`). Se fossem dois textos, divergiriam — o consultor
pediria oito coisas e o formulário teria dez.

Cliente já vinculado não tem ficha: o cadastro existe no ERP e é ele que manda.

## 48. Consultor cria template, administrador avalia (0110)

Menu **Templates** (todos os papéis) e a tela `/templates`. No `/admin` →
Templates, quarta posição da chave: **Sugestões (N)**.

### 48.1 O laudo de UX achou o que eu não tinha visto

Rodei o subagente `ux-chat` sobre o código antes de escrever a tela (laudo e
protótipo em `prototipos/`). Dois achados mudaram o resultado:

**1. "Aprovada" nao é "posso usar".** São **dois vereditos em sequência**: o
admin diz que o texto presta, e só *depois* a Meta analisa o template. Um selo
"Aprovada" logo após o admin faria a consultora procurar o template no chat e
não achar, porque `/api/templates` só entrega o que a Meta marcou `APPROVED`.
Daí **cinco estados**, não três:

| estado na tela | de onde sai |
|---|---|
| Em análise com o administrador | `status=pendente` |
| Aprovada — o administrador ainda vai criar na Meta | `aprovado` e `publicado_id` nulo |
| Criada na Meta, esperando a análise deles | `publicado_id` + Meta `PENDING` |
| **Pronta para usar** | Meta `APPROVED` |
| Recusada + motivo | `status=recusado` |

Os cinco são derivados **no servidor**, senão as duas telas nomeariam o mesmo
caso diferente.

**2. O consultor não lia um template fora de uma conversa.** `/api/templates`
tinha **um único consumidor** no app: o dropdown do compositor, que exige uma
cliente selecionada. Por isso a ordem da tela é **prontos para usar, criar,
meus templates**: ler o que já existe é o antídoto do template duplicado.

### 48.2 Tabela própria, não um `status` em `crm_templates`

`crm_templates.status` guarda o veredito da **Meta**, reconsultado a cada
abertura da tela (§24.3). Uma sugestão ali seria sobrescrita na primeira
sincronização — ou, pior, apareceria na lista de escolha do envio e falharia
com **132001 na cara da cliente**.

### 48.3 Vocabulário: "criar", não "sugerir"

Pedido do usuário: *"não é para ficar explícito para o consultor que é apenas
uma sugestão"*. É coerente com o pedido original (a experiência deve ser a mesma
de criar um template) e não custa honestidade: um template de verdade **também**
vai para análise antes de existir. Some a palavra que rebaixa o trabalho; ficam
as três coisas que importam — vai para análise, pode ser recusado com motivo, e
só depois de criado dá para usar.

Duas regras que o laudo cobrou e continuam valendo: **a palavra "Meta" não
aparece em nenhuma tela do consultor** (faria esperar aprovação "em minutos" de
algo que ainda nem foi lido por um humano), e **nenhum prazo é inventado** —
mostra-se há quanto tempo espera, que é verdade verificável.

### 48.4 Aprovar NÃO cria nada na Meta

É o veredito; criar continua sendo o botão do admin, com o formulário
preenchido. Juntar os dois num clique misturaria a decisão com uma ação
irreversível (nome apagado na Meta fica bloqueado por 30 dias, §24.4). Enquanto
`publicado_id` for nulo, a sugestão fica numa faixa **"aprovadas, ainda não
criadas na Meta"** — porque "aprovei, sumiu da fila, nunca publiquei" é fácil de
fazer sem perceber.

O admin vê, por sugestão: quem sugeriu, **há quanto tempo espera (mais antiga
primeiro)**, o texto como a cliente vai ler, a justificativa, quantos campos o
consultor terá de digitar a cada envio, e as conferências que ainda dão para
fazer antes de falar com a Meta — 1024/60/60, título **e** imagem juntos,
numeração fora de sequência, link encurtado, e identificador já existente (que
daria 409 só depois do clique).

## 49. Localização e encaminhar (0111) — e o que a API não tem

O usuário marcou quatro itens do checklist como fundamentais. **Dois não
existem na Cloud API**, confirmado na documentação:

| item | situação |
|---|---|
| Envio de localização | suportado (`type: location`) |
| Encaminhar | não há "forward" — dá para **reenviar o conteúdo** |
| Apagar mensagem | sem endpoint |
| Editar enviada | sem endpoint |

**O usuário cancelou apagar e editar** depois de eu explicar que a versão
possível seria falsa: um botão "apagar" sumiria da nossa tela e a cliente
continuaria vendo — e a pessoa clicaria nisso exatamente quando mandou algo
errado, que é quando a ilusão de desfazer custa mais caro. **Não repropor.**

### 49.1 Localização é por endereço SALVO, não pela posição do navegador

Duas razões, e a segunda é dura:

1. **Não é o caso de uso.** A cliente pergunta *onde fica a loja*, não onde o
   consultor está — e mandar a posição do celular dele num sábado à noite é um
   dado pessoal que ninguém pediu.
2. **Não funcionaria.** A tela vive dentro de iframe (o hub embute o CRM, o
   board embute o chat na lupa). Em iframe cross-origin o padrão para
   `geolocation` é `self`: sem delegação no `allow` de **cada** nível o pedido é
   recusado **sem prompt** — a armadilha do microfone da §22.5, e exigiria mexer
   no repositório do hub.

Os endereços moram em `crm_config.locais`, editáveis em /admin, colados do
Google Maps do jeito que ele copia (`lerCoordenadas` aceita a vírgula). **Linha
com coordenada inválida não é salva**, e a tela diz quantas foram descartadas:
melhor faltar o botão do que mandar a cliente para o lugar errado. `lerLocais`
também recusa `0,0` — é quase sempre campo vazio virando zero.

O gesto ficou no clipe, como no WhatsApp: ele abre "Arquivo, foto ou vídeo" e os
endereços. Não custou mais um ícone na barra.

### 49.2 Encaminhar — e o que ele não é

Reenvia o conteúdo, e **a cliente recebe como mensagem normal, sem o selo
"Encaminhada"**. Isso está escrito na tela de confirmação, antes da lista de
contatos. Do nosso lado a origem fica em `mensagens.encaminhada_de`, senão a
thread fingiria que o consultor escreveu aquilo do zero. A janela de 24h vale
para o **destino**: encaminhar é começar a falar com outra pessoa.

Mídia é **baixada do bucket e reenviada** (`sendMedia` sobe para a Meta), e não
por URL assinada — evita expor um link do bucket, mesmo temporário.

A rota tolera a coluna ausente (tenta com, refaz sem): botão quebrado em
produção é pior que botão ausente.

## 50. Board: o card virou chat, e a coluna "Sem cadastro"

### 50.1 O card é uma miniatura da conversa

A palavra TEMPLATE saiu (a 330px comia a linha inteira). No lugar, barra de
ícones no rodapé — ligar, áudio, anexo, template, cliente — e o maximizar no
canto superior direito.

**Ligar, áudio e anexo NÃO são reimplementados.** Abrem a lupa com `?acao=`, e a
lupa **é** o `/chat` embutido (§41) — quem executa é o dono do WebRTC, do
gravador e do upload. Reimplementá-los no board recriaria em triplicata a dívida
que a §41 pagou ao apagar o `conversa.tsx`.

O botão de cliente abre o painel do contato em quatro abas (Resumo, Perfil,
Compras, Notas fiscais): **uma requisição por card ABERTO**, nunca por card
desenhado — são ~400 na tela. A caixa de mensagens virou thread rolável: nasce
com as 3 do payload (de graça) e busca a conversa inteira quando a pessoa rola
ao topo.

### 50.2 `temConversaReal` excluía os contatos do NOSSO número

Era `!cliente_id.includes(":")`. Queria excluir os cards sintéticos do ERP
(`winthor:`, `venda:`), mas também excluía **`wa:`** — o id dos contatos do
número próprio (§16.3). Ligar, áudio, anexo, lupa e a thread rolável sumiam
**justamente nas conversas da Cloud**, e apareciam nas do RD. E piora sozinho:
todo contato novo nasce `wa:`. Agora o teste é por prefixo explícito.

**Regra que fica:** ao excluir "ids sintéticos", listar os prefixos que se quer
excluir — nunca testar por "tem dois-pontos".

### 50.3 Coluna "Sem cadastro"

Regra do usuário: sem conversa visível, quem decide a coluna é o **cadastro no
ERP**.

```
tem cadastro no WinThor  ->  Lista de prospecção
não tem                  ->  Sem cadastro
```

Antes esses caíam em Ociosos (ramo 1b, §31.3) e ficavam ao lado de quem parou de
responder — dois problemas diferentes na mesma pilha. Medido depois:
**Sem cadastro 95, Ociosos 4**. Ociosos volta a significar uma coisa só.

A regra mora na **rota**, não na view: é decisão de apresentação, não muda o que
o ETL enxerga (§32.2), e não custa migration.

**`sem_cadastro` é um palpite**: a view só marca `true` depois de não achar por
vínculo, por telefone **e** por nome normalizado. Por isso o texto diz "não
encontrei no WinThor", nunca "não existe". A saída é automática — CPF
preenchido, vínculo em até 10 min, o card migra sozinho.

### 50.4 Nome do cliente igual a `código - NOME`

`nomeComCodigo()` em `lib/nomeCliente.ts`. Custo zero: o `codcli` já vinha na
view do board, e no chat foi só pedir a coluna que a view já tinha.

### 50.5 O botão TEMPLATE do card falhava SEMPRE

O template padrão (`recontato_de_clientes`) tem dois campos; o board só sabe
mandar o primeiro nome, e a rota — com razão — recusa inventar texto em nome do
vendedor. Agora o board **abre a conversa** quando o template pede mais de um
campo. A rota devolve `comporNoChat`, marca legível por máquina: casar por
substring da mensagem quebraria no dia em que o texto mudasse.

E o board chamava `/api/sync-cliente` (que bate no RD) depois de **todo** envio
bem-sucedido — inútil na Cloud, e o 429 daí voltava como "instabilidade" logo
após um envio que tinha dado certo.

## 51. Compositor estilo WhatsApp — duas armadilhas de layout

**A caixa cresce com o texto**: 31px com uma linha, 88px com quatro, e volta a
31 ao apagar.

**Armadilha 1:** `height:"auto"` antes de ler `scrollHeight` **não invalida o
layout** — o navegador devolve o valor anterior. Tem que ser `0px`.

**Armadilha 2, a que custou mais:** o `scrollHeight` de um textarea **vazio**
conta a altura do **placeholder**. O texto antigo ("Escreva uma mensagem… (/
abre respostas rápidas, Enter envia)") quebrava em duas linhas num campo de
300px, então a caixa nunca voltava ao tamanho de uma linha depois de enviar.
Virou "Mensagem", com a dica no `title`.

**Os ícones foram para dentro do campo** (a "pílula"), como no WhatsApp: a borda
é do container, os botões ficam transparentes, e o enviar fica de fora. Antes
cada botão era um quadrado com borda própria e o campo era mais um quadrado na
fila — por isso parecia estreito tendo espaço. Campo passou de **22% para 56%**
da barra. No modo compacto, pausa, respostas rápidas e nota interna vivem atrás
de um botão de reticências.

## 52. Alerta de canal mudo (27/08/2026)

O modo de falha real, já vivido (§28.3): o app deixou de estar inscrito na WABA
e o sistema ficou **mudo por horas**, sem nada quebrar na tela.

**O sinal escolhido: recibo que não volta.** Quem promove
`wait -> success -> read` é o webhook — a mesma porta por onde as mensagens das
clientes entram. Mensagem nossa parada em `wait` há mais de 15 min significa que
o caminho de volta está morto, e isso mata as duas direções de uma vez.

Melhor que "faz X horas que ninguém escreve": isso acontece todo domingo, e
alarme que dispara todo domingo deixa de ser lido. Para o canal morto há dias
(quando ninguém mais tenta enviar e o contador zera) existe `sem_sinal`: 12h sem
nenhum recibo.

**Prova de que o sinal é o certo:** sobraram no banco 4 mensagens presas em
`wait`, todas de **23 e 24/08** — a janela exata daquele apagão. São a impressão
digital do incidente.

| onde | o quê |
|---|---|
| faixa no board, acima das colunas | vem no payload do `/api/funil` (2 consultas baratas) — rota própria seria mais uma requisição por aba, o vício da §15.1 |
| `/admin` → Mecanismos, no topo | vai à Graph API só quando alguém clica |

O diagnóstico profundo responde as duas perguntas que o banco não sabe:
`subscribed_apps` (o app está inscrito? — a causa de 24/08) e `health_status`
(a Meta considera a linha apta?). Cada checagem falha por conta própria: saber
**qual** das duas quebrou é o diagnóstico. E **não tenta consertar** — inscrever
o app altera a conta, e a rota que faz isso tem allowlist.

**Limitação declarada:** é alarme de tela. Avisa quem abrir o board; não manda
notificação. Push proativo é possível (o projeto tem `pg_cron` e `chat_push`),
mas é outra construção — se o canal cair de madrugada, ninguém sabe até alguém
abrir o sistema.

## 53. Erros da Meta em português (`lib/erroMeta.ts`)

`"Meta 131047 — Re-engagement message — Re-engagement message — Message failed
to send because more than 24 hours have passed…"` virava a mensagem de falha na
bolha. Três defeitos num recado só: inglês, título repetido (a Meta manda
`title` e `message` iguais em vários erros) e sem dizer o que fazer.

Agora: frase em português mais a ação, e o botão vira **Template** em vez de
Reenviar quando o código é 131047 (reenviar o mesmo texto falharia de novo).

**O texto cru NÃO é jogado fora** — vai para o `title`. A §22.6.1 custou horas
exatamente por ter perdido a explicação da Meta, e boa parte dos códigos de
chamada não existe na documentação pública.

## 54. `checklist_chat_crm.md` — auditoria contra o código

Arquivo na raiz, auditado em 27/08 item a item, com o arquivo responsável de
cada item pronto. Placar: **59 prontos, 18 parciais, 30 pendentes**.

O rótulo de "parcial" foi usado muito de propósito: "meio pronto" descrito é
acionável, "pronto" otimista vira surpresa na frente do cliente. Os parciais que
mais importam: multi-número **recebe** por vários e **envia** por um só; reação e
citação são **recebidas**, não enviadas; a thread para em 200 mensagens **sem
avisar**; o SLA é medido mas não alertado.

**A fila combinada com o usuário**, na ordem dele:

1. FEITO — localização e encaminhar (§49)
2. FEITO — alerta de canal caído (§52)
3. devolver conversa para a fila — quem pega por engano não tem saída
4. scroll infinito na thread — para em 200 sem avisar
5. excluir do disparo quem já falhou — custa dinheiro toda semana
6. apagar e editar — **cancelado pelo usuário**

**O que provavelmente não vale construir** (registrado para não voltar como
ideia nova): "digitando…" (a Cloud API não entrega esse evento — simular
presença é mentir), editar mensagem enviada e apagar para todos.

**Sobre tags** (seção 9 do checklist, tudo pendente): antes de construir, vale
conferir se é necessário. Parte do que o RD resolvia com tag aqui já é estrutura
— carteira/RCA, etapa do funil, status da conversa e motivo do encerramento. Tag
livre em cima disso costuma virar um segundo sistema de classificação que
ninguém mantém.

## 55. Método — o que custou tempo em 27/08

- **`python3` com heredoc quebra** quando o conteúdo tem certas combinações de
  aspas. Escrever o script com a ferramenta Write e rodar `python3 arquivo.py` é
  o caminho confiável. Vale também para blocos grandes de markdown.
- **Line endings importam.** Boa parte dos arquivos é CRLF, mas alguns (os que
  passaram pela ferramenta Edit) são LF. Um script de substituição precisa
  normalizar os âncoras — `assert s.count(a)==1` pega isso na hora.
- **`perl -pi -e` interpola `${VAR}`** dentro da string de substituição. Isso
  comeu `${URL_CONSULTA}` de duas linhas de JSX. Para código com template
  literals, usar Edit ou python.
- **Comando encadeado longo estoura o timeout.** Build, start, chrome e teste
  numa linha só passa dos 600s. Rodar em etapas.
- **Sonda numérica engana em layout.** Medir o topo de botões de alturas
  diferentes centralizados na mesma linha dá tops diferentes, e parece quebra de
  linha. **Screenshot decide** (§41.5).
- **Build verde não prova que a tela abre.** Todo hook precisa estar acima de
  qualquer `return` condicional; um `useEffect` referenciando um `const`
  declarado depois estoura em TDZ.
- **Testar contra a API real vale o esforço.** O diagnóstico de canal só provou
  que funciona porque subi o servidor local com as envs do WhatsApp e falei com
  a Graph de verdade — e depois plantei 3 mensagens presas no banco para ver o
  alarme disparar, removendo-as em seguida.

## 56. Devolver conversa para a fila (0112) — e a armadilha do `??` outra vez

Pegar da fila é um clique (✋ Pegar, §21), e **não havia saída**: quem pegava a
conversa errada dependia de um admin. É o erro mais provável do desenho.

**A migration é trivial** (`chat_transferencia.para_carteira` deixa de ser NOT
NULL, e nulo passa a significar "de volta para a fila"). O risco estava em
outro lugar — `donoEfetivo` era:

```ts
atrib.get(id)?.para ?? vendedorDoFunil ?? null
```

Com uma transferência de destino nulo, `?.para` é null e o `??` **cai para o
`vendedorDoFunil`**: devolver traria de volta o dono da carteira, não a fila. A
régua correta tem dois degraus, não uma coalescência — **existe transferência,
vale o `para` dela mesmo nulo; não existe, vale a carteira**. É a mesma
armadilha do `??` da §22.6.1.

Duas decisões:

- **Devolver é uma linha NOVA, não uma linha apagada.** `chat_transferencia` é
  append-only de propósito (§18): apagar o registro do "pegar" devolveria a
  conversa à fila **e apagaria a prova de que alguém a pegou por engano**.
- **Só se devolve o que não tem dono comercial.** Cliente com carteira/RCA tem
  dono natural; devolvê-lo criaria um órfão. O botão **nem aparece** nesse caso
  — para isso `aplicaEscopo` passou a expor `carteira_dona` (o dono comercial
  cru, antes da transferência), senão a tela não distingue "dono porque é a
  carteira" de "dono porque peguei".

## 57. A thread parava em 200 mensagens sem avisar

Numa cliente de anos, a conversa mais antiga simplesmente não existia para quem
rolava. Agora `/api/chat/thread` aceita `?antes=<criada_em>` e a tela tem
"Carregar mensagens anteriores".

- **Cursor por DATA, não offset.** O offset se desloca quando chega mensagem
  nova durante a rolagem, e o resultado é repetir ou pular uma bolha.
- **O lote pede UM a mais** que o limite — é assim que se sabe que ainda há
  passado, sem uma segunda consulta de contagem.
- **A posição de leitura** é preservada medindo `scrollHeight` antes e somando a
  diferença ao `scrollTop` depois do render.

Verificado com dado real (cliente de 238 mensagens): 193 + `tem_mais: true`,
depois 38 + `tem_mais: false`, todas mais antigas que o cursor. 193 + 38 = 231,
exatamente o total sem eventos de sistema.

⚠️ **A preservação da rolagem NÃO foi exercitada em navegador** — ela só aparece
com mais de 200 mensagens carregadas, o que nesta configuração exige o histórico
do RD ligado, e ele está desligado de propósito. Fica dito, não afirmado.

## 58. Tema "Bancada" (Direção 4) — o projeto

> Escrito em 27/08/2026, quando nada em `web/` tinha sido tocado. As entregas
> 1 e 2 do plano da §11 saíram no mesmo dia — ver **§60**. Esta seção continua
> valendo como o RACIOCÍNIO (escalas medidas, contrastes, riscos); o estado do
> que está construído mora na §60, não aqui.

> Pedido do usuário (27/08): *"quero que ele crie mais um tema (visão ou layout)
> que fique mais com cara de aplicativo premium; com mais simetria. quero que
> realmente ele gaste energia nisso."*

Rodei o subagente `ux-chat`. **Nada em `web/` foi tocado** — o material é
decisão, não código:

| arquivo | o quê |
|---|---|
| `prototipos/laudo-tema-premium.md` | raciocínio, escalas, contrastes, plano de 31 itens |
| `prototipos/tema-premium.html` | protótipo navegável: desktop, celular e compacto 500px, claro e escuro |
| `prototipos/README.md` | tabela comparativa das quatro direções, refeita |

### 58.1 A tese, e por que ela não repete as outras

- **D1 `continuidade`** respondeu *"o que falta aparecer"* (implementada, §29.7).
- **D2** aposta em atender **mais conversas por dia**.
- **D3** aposta em vender **mais por conversa**.
- **D4 `bancada`** responde *"por que a tela parece improvisada mesmo mostrando
  a coisa certa"*: **nenhuma informação nova, nada muda de lugar** — tudo passa
  a obedecer a uma grade.

É a única não-trivial que **não pede dado novo**: zero migration, zero rota. E
**herda** as correções da D1, não as desfaz.

### 58.2 "Premium" e "simetria" viraram números medidos no código

Hoje `web/app/chat/page.tsx` tem **18 tamanhos de fonte** (231 declarações),
**65 combinações de padding** (126 declarações), **15 raios**, **6 rampas de
sombra**, peso 800 espalhado e **44 emoji distintos** usados como ícone.

A proposta: 7 tokens de tipo · base-4 de espaço (7 degraus) · 3 raios · 3
alturas de controle por contexto · 2 elevações · 5 famílias de cor com um
trabalho cada.

Simetria virou coisa verificável — a mais concreta: **a sidebar tem três bordas
esquerdas hoje** (10 / 12 / 13 px, em `page.tsx:2269`, `:2663`, `:2754`) e a
conversa tem duas (bolhas 18, compositor 14). Vira uma goteira só.

### 58.3 Achados que valem independentemente do tema

1. **O número que é nossa vantagem sobre o RD está truncado.** Painel de 268px
   com três tiles iguais: sobram 55px de texto, e `R$ 12.480,00` a 17px/800 mede
   112px. Quanto maior a cliente, mais cedo o valor some. A D4 troca por um
   número herói e dois de apoio.
2. **A barra de chamada cobre o compositor** — `fixed bottom:0` em largura total
   (`ligacao.tsx:474`). Durante uma ligação não se digita.
3. **`#2f7fd4` não serve de fundo de botão com texto branco: 4,11:1.** O azul
   preenchido tem de ser `#1a5fa8` (6,47:1). `#2f7fd4` serve como cor de foco,
   onde a régua é 3:1.
4. **Nuance da skill `murano-brand`:** "púrpura como texto dá 2,3:1" vale sobre
   o cartão **escuro** do hub. Sobre branco, `#8a2a63` dá 8,10:1.

### 58.4 Dois defeitos achados e JÁ CORRIGIDOS

- **Botão "Cliente" morto na lupa.** Ele renderiza com `(!isMobile || compacto)`,
  o painel de desktop exige `!isMobile` e a folha exigia `d1`. Na lupa com o
  layout `original`, aparecia e não tinha para onde abrir. Não atingia ninguém
  (o layout em vigor é o D1), **mas `original` é o caminho de rollback** — e
  aterrissar nele com um botão morto anula o propósito da chave. A folha passou
  a aceitar `d1 || compacto`.
- **Um número de contraste que eu documentei errado.** O comentário do `muted`
  do D1 dizia "4,6:1". Medido: **4,25:1 sobre branco e 3,87:1 sobre o fundo real
  (`#f4f4f6`)** — reprova para texto normal (régua 4,5:1). Melhora o `#9a8098`
  antigo, mas não passa. Não escureci: mudaria a cara do D1 em produção sem
  ninguém pedir. Fica como dívida nomeada no próprio comentário.

### 58.5 O plano de implementação (quando alguém for construir)

`bancada` entra em `lib/chatLayout.ts` com **`implementado: false`** — vira
`true` só quando a tela existir (§29.3). Duas alavancas em `page.tsx`, ambas no
padrão que a casa já usa:

1. `PALETAS` ganha `bancada` (o objeto `M` já é mutável, §11.5);
2. nasce um `GRADES` para geometria, com **`GRADES.original` reproduzindo os
   literais de hoje** — é isso que torna o rollback exato, e não "quase igual".

A lista "isto vira aquilo" tem **31 itens** com arquivo:linha, em três entregas
que valem sozinhas.

⚠️ **O risco nomeado:** o título-dropdown das filas **some**, absorvido pela
faixa segmentada que a própria D1 criou — dois controles para a mesma escolha.
É memória muscular que se perde. A recomendação (que endosso) é **entregar no
piloto de uma pessoa** (`acesso.chat_layout`) antes de estabelecer para todos.

O protótipo também está publicado como página clicável:
`https://claude.ai/code/artifact/95e2ae58-5f11-45cf-8e94-d9478a99da66`

## 59. Estado da fila combinada (fim de 27/08/2026)

| | item | estado |
|---|---|---|
| 1 | localização e encaminhar | ✅ §49 |
| 2 | alerta de canal caído | ✅ §52 |
| 3 | devolver conversa para a fila | ✅ §56 |
| 4 | scroll infinito na thread | ✅ §57 |
| 5 | excluir do disparo quem já falhou | ✅ §61 |
| 6 | ~~apagar e editar mensagem~~ | cancelado pelo usuário (a API não tem) |

**Item 5, o que falta:** o disparo em massa não exclui quem já falhou antes. O
motivo está em `mensagens.erro` (0091) — número que não recebe no WhatsApp
(131026) continua sendo re-disparado, e cada template é cobrado. O corte entra
em `/api/admin/disparo-massa`, junto dos que já existem (§26.1).

**Migrations aplicadas:** 0107 a 0113, todas confirmadas no banco.

**Duas coisas do usuário, não de código:**
- **Endereços de localização estão vazios** (`crm_config.locais = []`): o botão
  📎 só mostra a opção depois que alguém cadastrar um em /admin → Mecanismos.
- **Aviso de cobrança no painel do Supabase** ("Outstanding invoices"). Se aquele
  projeto suspender, cai o CRM inteiro — board, chat, webhook e o `pg_cron` do
  WinThor. É o maior risco isolado do projeto, e não é técnico.

## 60. Bancada (Direção 4) — a primeira das três entregas está no ar (27/08/2026) — migration 0113

O tema premium do §58 saiu do protótipo. **Entrega 1 do plano de 31 itens**
(`prototipos/laudo-tema-premium.md` §11.4): paleta e escalas — itens 1-9, 13-14,
19 e 24-26. As entregas 2 (densidade e agrupamento) e 3 (ícones, estados,
acabamento) continuam pendentes.

`bancada` já é **selecionável no /admin**, global ou em piloto por usuário. O
global segue em `continuidade`: nada mudou para a equipe sem alguém decidir.

### 60.1 A segunda alavanca: `G` e `GRADES`

`M` resolve a cor; agora `G` resolve a **geometria**, com o mesmo padrão mutável
+ `Object.assign` que a paleta usa desde o board (§11.5). O motivo de existir
está medido no §58.2: 65 combinações de padding e 15 raios num arquivo só.

Duas regras que sustentam o rollback:

- **`GRADES.original` reproduz os literais de hoje.** Trocar um literal por `G.x`
  é uma mudança de zero pixel enquanto o layout for `original` — verificado no
  navegador: a lista mede 341 px (340 + borda) nos dois desenhos anteriores e
  321 em `bancada`.
- **`Object.assign(G, GRADES.original, GRADES[layout])`** — a base SEMPRE
  primeiro. As entradas são parciais; sem ela, o desenho novo herdaria as sobras
  do anterior no mesmo carregamento.

### 60.2 `d1` deixou de ser igualdade e virou conjunto

```ts
const CORRIGE = new Set(["continuidade", "bancada"]);
const d1 = CORRIGE.has(layout);
```

A tese da 4 é grade, não informação nova — ela **pressupõe** a 1. Com o teste de
igualdade anterior, escolher `bancada` apagaria a faixa da janela de 24h, a aba
Resumo e o mobile resolvido. O `bc` guarda só o que é dela.

`abaPadrao` foi reescrito pela negativa (`layout === "original" ? "perfil" :
"resumo"`): assim uma direção futura nasce no resumo comercial em vez de nascer
na aba do telefone por esquecimento.

### 60.3 Dois tokens novos em `M`, com valor neutro nos desenhos antigos

`lineStrong` (borda de **controle** — campo e botão, que a régua exige em 3:1 por
ser elemento não-textual) e `ok` (o verde de "concluído", que estava literal em
oito lugares). Em `original` e `continuidade` eles reproduzem o que o código já
fazia cravado, então acrescentá-los não move um pixel.

`bancada` paga também a **dívida de contraste registrada no §58.4**: o `muted`
dela é `#6b6577`, que passa nos três fundos (5,60 · 5,02 · 4,65:1), contra os
4,25/3,87:1 do `#7c7986` da D1 — sem mexer na D1, que está em produção.

### 60.4 ⚠️ `minHeight`, nunca `height`, no cabeçalho da conversa

O plano pedia `height: 56` para o cabeçalho da conversa alinhar com o da lista.
**No navegador isso quebrou:** com o painel do cliente 52 px mais largo (268 →
320, que é o ponto do item 26), a linha de metadados do nome passa a caber em
duas linhas em alguns contatos, e altura fixa espremia justamente esses.

Virou `minHeight` + 6 px de padding vertical. O alinhamento continua quando o
conteúdo é curto, e cede quando não é — que é a troca certa: não vale cortar o
telefone de quem tem nome comprido para ganhar uma régua.

**Só o screenshot pegou isso.** `tsc` e `next build` passaram limpos, e as sondas
numéricas diziam que estava tudo bem. É a mesma lição do §41.5.

### 60.5 Como ver um desenho sem escrever no banco de produção

O servidor local lê o Supabase real, então trocar `chat_layout` para olhar uma
tela mudaria a tela da equipe. E editar o código para forçar o valor é o tipo de
coisa que se esquece de reverter.

O caminho usado, que não tem nenhum dos dois problemas: **interceptar a resposta
de `/api/chat` no CDP** (`Fetch.enable` com `requestStage: "Response"`) e
reescrever só o campo `layout`. O resto passa intacto, o código testado é o
build de produção de verdade, e nada é escrito em lugar nenhum.
`scripts` descartáveis ficaram no scratchpad, fora do repo.

⚠️ Duas armadilhas de ambiente, ambas já pagas nesta sessão:
- **`.next` não aguenta dois processos.** Um `next build` concorrente com outro,
  ou um `next dev` sobre o `.next` de um build, produz `ENOENT` em manifesto
  (`pages-manifest.json`, `middleware-manifest.json`, `500.html`) — erro que não
  tem nada a ver com o código. Matar tudo, apagar `.next`, rodar um só.
- **`BUILD_ID` aparece ANTES de o build terminar.** Esperar por ele para subir o
  `next start` dá `ENOENT: prerender-manifest.json`. Esperar pelo
  `prerender-manifest.json`, ou pelo fim do processo.

### 60.6 O que ficou de fora desta entrega, e por quê

- **Item 10 (o título-dropdown das filas some).** É o único que mexe em memória
  muscular. Fica para o piloto por usuário, que existe exatamente para isso.
- **Item 30 (a barra de chamada cobre o compositor).** É bug real e vale para
  TODOS os desenhos, inclusive o `original` — não deve entrar escondido dentro
  de um tema. Sai como correção à parte.
- **Itens 11, 15-18, 27-29, 31**: entregas 2 e 3.

### 60.7 Entrega 2 — densidade e agrupamento (itens 12, 20-23, 27)

| Item | O que mudou em `bancada` |
|---|---|
| 12 | A linha da conversa comeca na goteira (16 px), tem 52 px, avatar 36 — e a **hora saiu da linha do nome** para uma coluna fixa de 38 px a direita, com o ponto de nao-lida embaixo dela |
| 20 | **Agrupamento por autor**: 2 px entre bolhas do mesmo grupo, 10 entre grupos |
| 21 | **Hora e tique so na ULTIMA bolha do grupo** — cinco mensagens seguidas mostravam cinco vezes o mesmo minuto |
| 22 | Bolha em `min(72%, 560px)`, raio 14, padding 8/12; a quina que aponta para o autor so na ultima do grupo |
| 23 | A linha da hora das bolhas do meio volta no `:hover` |
| 27 | Painel do cliente: **um numero heroi** (26 px, coluna inteira) + os de apoio embaixo |

#### O unico `<style>` do chat, e por que ele existe

A tela e estilo inline de ponta a ponta, e inline nao faz `:hover`. O item 21
esconde a linha da hora — mas o botao de **encaminhar** mora nessa mesma linha, e
some-lo tornaria metade das mensagens nao-encaminhaveis. Entao a linha volta no
hover, por uma regra CSS de verdade, e **em aparelho de toque ela fica sempre
visivel** (`@media(hover:none)`): ali o desenho e o de hoje e nada se perde.

Isso e um desvio consciente do laudo, que mandava esconder no toque assumindo
"toque longo, que e outra construcao". Toque longo nao existe, e ficar sem o
gesto no aparelho que vai virar o app e pior que a densidade que se ganharia.

Se o CSS nao carregar, a regra deixa de valer e a linha aparece sempre: degrada
para o desenho de hoje, nunca para uma bolha sem hora.

#### Mensagem que falhou fecha o grupo

Descoberto olhando a tela: a mensagem com `status='failed'` pendura abaixo de si
o recado "nao entregue", que e uma barra larga cortando a conversa. Sem regra, o
grupo atravessava essa barra e a hora ia parar longe das bolhas que datava.
`falhou()` entra no calculo de `abreGrupo`/`fechaGrupo`.

#### ⚠️ `minHeight` de novo, e o preco disso

O laudo pede altura FIXA na linha da conversa, por ser o pre-requisito barato da
virtualizacao que a lista vai precisar acima de 3.900 conversas. Ficou
`minHeight`: virtualizacao nao e esta entrega, e altura fixa espremeria quem tem
selo de transferencia ou de vendedor na segunda linha. **Quando a virtualizacao
entrar, isto precisa virar `height`.**

#### O que a coluna de horas custou

A regua vertical reserva 38 px + 12 de respiro em TODA a linha, inclusive na
segunda, onde mora a previa da conversa — que e o que o vendedor le para decidir
se abre. A previa encurta em cerca de uma dezena de caracteres. Foi mitigado
levando a coluna de 46 (o laudo) para 38, e o padding direito de 16 para 12 (a
goteira e da aresta ESQUERDA; cada pixel a direita e caractere na previa).

Fica registrado como troca, nao como defeito: se a leitura da previa pesar mais
que a regua, tirar a coluna e reverter tres blocos de JSX, sem tocar no resto.

#### O susto que nao era bug

Por meia hora as medicoes disseram que `continuidade` e `bancada` renderizavam
IGUAL. Passei por service worker (o chat e PWA e realmente guarda a resposta de
`/api/chat`), cache do navegador e sonda de DOM mal escrita — tudo hipotese, tudo
errado. A resposta veio de `curl` na propria rota: **o servidor estava mandando
`bancada` porque o usuario tinha marcado `bancada` no /admin no meio da sessao.**

Licao, que e a mesma da §35.1: quando a medicao contradiz o codigo, **perguntar
ao servidor antes de acusar o navegador.** Uma linha de `curl` teria poupado
quatro rodadas de build.

⚠️ **E o efeito colateral, que e o registro importante:** com `chat_layout` em
`bancada` e o codigo do `bancada` AINDA NAO no ar, o build da Vercel nao conhece
o valor e `layoutEfetivo` cai no padrao — a equipe inteira foi parar no
`original`, sem as correcoes da Direcao 1, **em silencio**. A rede de protecao
funcionou (tela degradada, nao quebrada), mas a ordem importa:

> **marcar um desenho novo no /admin so DEPOIS de o codigo estar em producao.**

Devolvido para `continuidade` no mesmo dia, com linha em `chat_layout_historico`.

### 60.8 Entrega 3 — icones, estados e acabamento (itens 17, 18, 28-31)

Com ela o plano de 31 itens do laudo fecha, menos o item 10, que continua fora
de proposito (§60.6).

| Item | O que mudou |
|---|---|
| 18 | Emoji de interface viram **traco monocromatico** em `app/chat/icones.tsx` — 15 icones, caixa de 24, `currentColor` |
| 17 | **Resolver fica VERDE** em `bancada`: verde e "concluido" nesta paleta, e cada familia de cor tem um trabalho so |
| 28 | Os quatro estados vazios viram **um componente `Estado`**, e o vazio passa a dizer a CAUSA |
| 29 | Ja estava coberto: a folha do ERP no celular aceita `d1 \|\| compacto`, e `d1` agora inclui `bancada` |
| 30 | **A barra de chamada sobe para o topo** — vale para TODOS os desenhos |
| 31 | Rolagem fina nas tres colunas, foco visivel, e `prefers-reduced-motion` |

#### Por que icone proprio, se emoji funciona

Emoji e desenhado pelo SISTEMA, nao por nos. Cada um tem peso, cor e alinhamento
optico proprios — 📊 e azul e cheio, ✋ e amarelo, ↪ e uma seta fina de texto — e
num cabecalho com sete acoes lado a lado o resultado sao sete pesos visuais
brigando. E o que o laudo chama de "improvisado mesmo mostrando a coisa certa".

Com traco em `currentColor`, quem decide a cor passa a ser o botao. E isso que
torna possivel a regra de **um acento por regiao**.

O dicionario e fechado: 15 nomes, os que a tela usa. Icone nao usado e peso morto
que ninguem percebe estar quebrado.

⚠️ **Nos outros desenhos os emoji continuam.** `icones.tsx` nao e importado por
eles. Trocar o icone de quem nao pediu quebraria o rollback exato.

#### O `BotaoLigar` quase ficou de fora — e isso teria anulado o item

Ele mora em `ligacao.tsx`, nao em `page.tsx`, entao escapou da troca do `rot()`.
O cabecalho ficou com quatro SVG monocromaticos e **um emoji colorido no meio** —
exatamente a inconsistencia que o item 18 existe para acabar. So apareceu no
recorte ampliado.

Licao: quando uma mudanca e "trocar todos os X da tela", conferir se algum X mora
em outro arquivo. `grep` no arquivo que se esta editando nao encontra o de fora.

#### Dois icones redesenhados depois de ver, nao de escrever

Ambos pareciam certos no codigo e errados na tela ampliada:

- **grafico** (Cliente): as barras estavam `alta no meio`, e o desenho lia como
  sinal de antena. Viraram ascendentes.
- **pausa**: duas linhas finas liam como cursor de texto. Viraram duas barras
  fechadas, que e o botao de pausa que todo mundo reconhece.

Vale a regra da §41.5: **para desenho, captura de tela decide.** Nenhuma sonda
numerica diria que um icone esta com a leitura errada.

#### Item 30 — a barra de chamada NAO e tema

Era `position: fixed; bottom: 0` em largura total, ou seja, ficava **em cima da
caixa de texto**: durante uma ligacao nao se digitava. E e justamente durante uma
ligacao que se anota o pedido, se manda o catalogo, se confirma o preco.

A correcao e trocar a ancora para `top`, e **vale para todos os desenhos** —
inclusive o `original`. Bug nao entra escondido dentro de um tema, senao quem
fizer rollback herda o bug de volta.

Efeito colateral aceito: no topo ela cobre a barra de navegacao do produto (e, na
lupa, o cabecalho da conversa). Durante uma chamada isso custa menos que perder o
compositor.

#### O que e acessibilidade nao ficou preso ao tema

`prefers-reduced-motion` vale para **todos** os desenhos: quem liga "reduzir
movimento" no sistema costuma faze-lo por enxaqueca ou vertigem — nao e
preferencia estetica e nao deve depender de qual tema esta ativo.

Ja a rolagem fina e o anel de foco ficaram so em `bancada`, porque mudam
aparencia. O anel usa **`#2f7fd4`**, que passa os 3:1 exigidos de elemento
nao-textual — e e justamente por isso que ele NAO serve de fundo de botao com
texto branco (4,11:1). A mesma cor, dois papeis, e so um deles valido.

#### Desvio conhecido, deixado a decisao

A regra do laudo diz **um preenchimento por regiao**. O cabecalho ficou com
**dois**: Cliente (purpura) e Resolver (verde). Tirar o preenchimento do Cliente
nao estava em nenhum item do plano, e mexer nele por conta propria seria
redesenhar fora do combinado. Fica anotado para quem for julgar a tela.

## 61. Item 5 e a tela de Envios (27/08/2026) — dois defeitos maiores que a feature

### 61.1 Todo contato do NOSSO número estava fora do disparo em massa

`idDeEnvio` fazia `!id.includes(":")`. Contato criado pelo nosso número tem id
`wa:<telefone>` — tem dois-pontos, virava `null`, era descartado e contado como
**"sem contato no RD Conversas"**, rótulo que ninguém questionaria.

Ou seja: **as pessoas que já conversam pelo Murano Professional nunca entraram
numa campanha**, e o relatório dizia que o motivo era o RD. Piora sozinho — todo
contato novo nasce `wa:`, e depois do corte serão todos.

É o mesmo bug do board (§50.2), no mesmo dia. Varri as sete ocorrências do
padrão, e a varredura deu a régua que faltava:

| a pergunta que o código faz | o teste por dois-pontos |
|---|---|
| *"o RD conhece este id?"* (`sync-cliente`, `negociacao-sync`, ↻ do card, ETL) | **acerta** — `wa:` de fato não existe no RD |
| *"isto é um contato?"* (`/api/funil`, disparo em massa) | **erra** — `wa:` é contato, e é o contato do futuro |

**Regra: ao excluir ids sintéticos, listar os prefixos (`winthor:`, `venda:`).**
Nunca testar por "tem dois-pontos".

### 61.2 O corte não disparava, e falhava em SILÊNCIO

A consulta de desfechos pedia **8.000 linhas em ordem crescente de um universo de
59.956**. O PostgREST devolveu as 8.000 mais antigas e **não avisou que truncou**
— as falhas, todas de agosto, ficaram de fora. O mapa era construído, o código
rodava, o corte nunca tinha o que cortar.

**Um `limit` sobre um universo que não se mediu antes é um filtro invisível.**
Refeito: só as falhas (32 linhas em 90 dias) mais uma consulta dirigida
perguntando quem voltou a receber depois — que é barata justamente porque os
candidatos são poucos.

### 61.3 O corte em si: nem toda falha é do número

Medido antes de escrever, sobre TODAS as falhas que existem no banco:

| código | clientes | decisão |
|---|---|---|
| 131047 janela fechada | 6 | **mantém** — é exatamente quem o template existe para alcançar |
| 131042 pagamento nosso | 2 | **mantém** — puniria o cliente por erro da nossa conta |
| 131026 não recebe | 2 | **corta** — é permanente |

Duas refinações: vale o **último desfecho**, não "já falhou alguma vez" (número
que falhou em junho e recebeu em agosto passou a existir — a pessoa instalou); e
a memória de falha tem **janela própria de 90 dias**, separada da anti-repetição,
porque número morto continua morto mesmo com `dias_recontato = 1`.

### 61.4 A tela de Envios mostrava 3.676 disparos do RD com a chave ligada

A §27.2 construiu aquela tela com uma tese: exibir *"quanto a equipe ainda
dispara pelo painel do RD"*, pela diferença entre os dois números. Era útil em
agosto. Com a chave de migração ligada, virou o oposto do pedido (§44).

Medido: **3.707 templates no mês, 33 pelo nosso número.**

**Esconder o terceiro quadro não bastava**, e o motivo só aparece olhando de onde
cada número vem:

| cartão | fonte | recortável por linha? |
|---|---|---|
| "chegaram à cliente" | `mensagens` | **sim** — `filtroLinhas` |
| "saíram por este CRM" | `disparos_template` | **não** — a tabela não tem coluna de linha |

O segundo seguia carregando RD e não havia como filtrá-lo. Mas isso apontou para
uma resposta melhor que filtrar: **no nosso número a comparação não pode
existir.** A WABA é nossa, não há BSP nem painel de terceiro — todo template que
sai por ali saiu por este CRM (o ramo Cloud do `send-template` grava nas duas
fontes). A subtração é estruturalmente zero.

Então, com o RD escondido, a tela vira **um número só** (20 no mês, na linha em
uso), e a tabela por consultora perde as duas colunas do RD. Com o RD visível
nada muda — seguem as views pré-agregadas, porque varrer 94 mil mensagens a cada
abertura seria caro sem ganho.

⚠️ Os 33 da medição não viram 20 por erro: 3 são da linha de teste antiga e 10 da
Murano Shop, nenhuma delas selecionada. `filtroLinhas` conta **o número em uso**,
não todo o histórico da Cloud.

### 61.5 O padrão dos três defeitos desta sessão

Nenhum dos três dava erro. O board caiu por `charAt` de null (§35.1), o corte não
cortava, e a tela mostrava o número errado — todos silenciosos, todos passando
por `tsc` e `next build`. O que os revelou foi **rodar contra dado real e
conferir o número**, nunca a leitura do código.


## 62. Localização na conversa (27/08/2026) — migrations 0115 e 0116

### 62.1 "Tempo real" não existe nesta API — e o que existe no lugar

O usuário pediu localização **fixa e em tempo real**. Verifiquei antes de
construir, e as duas fontes concordam:

- a referência de webhook da Meta para `location` descreve **só o pino
  estático**: `latitude`, `longitude`, `name`, `address`, `url`. Nenhuma menção
  a atualização contínua;
- a documentação de BSP (tyntec) afirma que a WhatsApp Business API **não
  recebe live location**.

A live location — a que fica atualizando sozinha por 15 min, 1 h ou 8 — é
recurso do app entre pessoas. Uma imitação mostraria um ponto parado com cara de
rastreamento, que é pior que não ter: mesma razão do "digitando…" e do apagar
mensagem (§54).

**O que a plataforma oferece, e foi o que entrou**, é o
`interactive.location_request_message`: um botão que abre no aparelho da cliente
a tela de compartilhar. Ela toca, e a **posição do momento** volta como um
`location` comum, com `context.id` apontando para o pedido. É sob demanda, não
contínuo — e a tela diz isso, em vez de prometer acompanhamento.

### 62.2 O ponto estava sendo jogado fora desde a 0079

O webhook JÁ recebia `type: location` e gravava o texto `[localização]`,
descartando latitude, longitude, nome e endereço, que vêm no mesmo payload.
Havia **1 mensagem** dessas no banco: a cliente mandou onde fica o salão dela e o
CRM guardou a palavra "localização".

Agora `mensagens.localizacao` (jsonb) guarda o ponto, e a bolha desenha um
cartão com nome, endereço e link para o mapa — **o mesmo cartão nos dois
sentidos**, senão a thread contaria duas histórias visuais para a mesma coisa.

Três decisões:

- **Uma coluna jsonb, não cinco soltas.** O contraponto é `midia_*` (0079), que
  é discreta — mas `midia_tipo` é FILTRADA, com índice parcial. Localização é
  sempre lida inteira, para desenhar um cartão; ninguém procura "mensagens com
  latitude > x". Cinco colunas que só andam juntas são cinco lugares para
  esquecer de preencher.
- **Sem imagem de mapa.** Um preview estático exigiria chave de um provedor de
  tiles, e cada bolha viraria uma requisição a terceiro numa tela que carrega
  200 mensagens. O cartão traz o que serve para agir.
- **Com cartão, o texto some da bolha.** `conteudo` é o mesmo endereço, escrito
  para quem lê a LISTA de conversas, onde não há cartão. Na bolha seria a mesma
  informação duas vezes.

### 62.3 ⚠️ O teste ponta a ponta pegou perda de mensagem

Mandei três webhooks de localização ao servidor local, no formato documentado.
Resultado: **três respostas HTTP 200, zero linhas gravadas.**

A causa: a coluna `localizacao` ainda não existia (0115 não aplicada), o upsert
inteiro falhava, e o webhook **engole erro para sempre responder 200** (§16.1,
e com razão: sem 200 a Meta reenvia eternamente). Ou seja — se o deploy chegasse
antes da migration, **toda mensagem de localização seria perdida em silêncio**.
Não degradada: perdida. A Meta reenvia, falha igual e desiste.

O conserto é uma segunda tentativa sem o campo, no webhook **e** na rota de
envio (onde é pior ainda: a mensagem já foi para a cliente, e sem espelho o
vendedor manda de novo). Mesmo padrão de `encaminhada_de` (§49.2).

**A regra que fica, e vale para toda coluna nova daqui em diante:** num caminho
que engole erro para responder 200, uma coluna que ainda não existe não é um
campo faltando — é a mensagem inteira no lixo. Ou a migration vai antes do
deploy, ou o código tolera a ausência. E só o teste ponta a ponta mostra isso:
`tsc` e `next build` passaram limpos.

### 62.4 O grupo E de Pendências (0116) — a pergunta que abriu um buraco

O usuário perguntou: *"quando se cadastra um cliente novo, neste momento ele
ainda não existe no WinThor, onde ele aparece em nosso sistema?"*

A resposta era **em lugar nenhum**, e foi conferida caso a caso:

| onde | por que não aparece |
|---|---|
| board | os três ramos da `vw_funil_visivel` exigem conversa (1), mensagem de operador em linha escondida (1b), ou cadastro no WinThor (2) |
| chat | a lista vem da mesma view |
| Pendências | os quatro grupos da 0101 também partem de conversa ou de carteira |

Medido: dos **116** contatos com id `wa:`, **2** estavam exatamente assim. Ficavam
visíveis só na aba de quem os criou e sumiam no primeiro recarregamento.

É a doença que a tela de Pendências existe para curar (§36.1): *um registro que
o sistema não sabe classificar não pode simplesmente não aparecer.* Daí o
**grupo E**.

Os outros 108 sem mensagem **não** entram: têm cadastro no WinThor e já aparecem
como prospecção, sob o id sintético `winthor:<codcli>`. O grupo E some sozinho —
basta a primeira mensagem, ou o CPF entrar no ERP.

### 62.5 "Murano Pro (RD Conversas)" num contato que nunca conversou

Relatado pelo usuário com print, em plena chave de migração ligada. O cabeçalho
da conversa exibia a etiqueta **MURANO PRO (RD CONVERSAS)** — o nome do sistema
que a chave manda esconder.

Diagnóstico: o contato **não tinha nenhuma mensagem**, em linha nenhuma. Estava
na tela pela aba *Minha carteira* (§38), que vem do ERP e não de conversa.

A causa era uma decisão com **dois casos onde precisava de três**:

```ts
c.linha_id = daLinha.get(c.cliente_id) ?? "rd"
```

O `?? "rd"` lê *"não tem mensagem na Cloud"* e conclui *"é conversa do RD"*.
Isso era verdade enquanto TODA conversa vinha do ETL. Deixou de ser quando
passamos a criar contato pelo botão + (§35.2) e a provisionar 108 da carteira do
WinThor (§37.4): gente que nunca trocou uma palavra conosco.

A régua correta:

| tem | linha |
|---|---|
| mensagem com `linha_id` | aquela linha |
| mensagem sem `linha_id` | Murano Pro (RD) |
| **nenhuma mensagem** | **nenhuma — sem etiqueta** |

Corrigido em `/api/chat/thread` (cabeçalho) e `/api/chat` (lista), mais os
contadores do seletor por número, nos dois lados — eles somavam esses contatos
ao balde do RD e inflavam uma fatia que a lista não mostrava. E o filtro por
número passou a excluí-los de qualquer linha, que é o certo: eles não correm por
nenhuma.

**É a terceira vez neste projeto que um `??` decide errado** (§22.6.1, §56,
agora). O padrão é sempre o mesmo: o operador transforma "não sei" em um valor
concreto, e alguém lê aquele valor como se fosse um fato apurado.

⚠️ **Achado de lambuja, não corrigido:** `/api/chat` devolve `modo_migracao` com
um comentário afirmando que a etiqueta de linha e o filtro por número somem — e
`app/chat/page.tsx` **nunca lê esse campo**. Hoje não vaza porque conversa do RD
já está escondida por `linhas_visiveis`; o vazamento vinha só pelo caminho
acima. Fica anotado como campo devolvido e ignorado.

### 62.6 Método

- **`python3` com heredoc come um nível de escape neste ambiente.** Um `\\n`
  virou quebra de linha real e o `assert` de âncora falhou. É a 4ª vez (§36.4,
  §40.4, §42.4). Caminho confiável: escrever o script com a ferramenta Write e
  rodar `python3 <arquivo>`.
- **O `/tmp` do Git Bash é `%TEMP%`; o do python no Windows é `C:\tmp`, que não
  existe.** Script python que escreve em `/tmp` e comando bash que lê `/tmp` não
  se encontram. Usar `os.environ['TEMP']`.
- **Um `select` com coluna inexistente NÃO devolve linhas sem o campo: devolve
  ERRO.** Isso derrubou duas coisas no mesmo dia, em lados opostos. No
  `lerCrmConfig`, pedir `sla_minutos` antes da 0114 faria a leitura inteira
  falhar e cair no padrão — o que traria o RD Conversas de volta em todas as
  telas, sem erro nenhum aparecer (corrigido com `select("*")`). E no meu
  próprio script de teste, pedir `localizacao` antes da 0115 fez a consulta
  voltar erro em vez de linha, e o teste acusou "não gravou" **três vezes**
  enquanto o webhook gravava certo. Duas horas atrás desse fantasma.
- **Extrair função de TS por regex para testar é briga perdida** — as anotações
  de tipo voltam de formas novas a cada tentativa. O teste que valeu foi subir o
  servidor e mandar o payload de verdade, que ainda por cima achou a perda de
  mensagem.

## 63. O assistente monta o publico do disparo conversando (28/08/2026)

`/admin` -> Templates -> Disparo em massa -> bloco **Montar conversando**. Nenhuma
migration: o publico sai das views que ja existem.

### 63.1 O caminho que isto encurta

O fluxo real da campanha saia do CRM no meio: a supervisao conversava com um chat
**fora** do sistema ("200 clientes de cada vendedor do inside sales que nao
compraram nesse mes, que nao receberam template hoje, que nao estao em conversa
aberta"), recebia uma **planilha**, e subia a planilha no painel do RD para
disparar.

Tres defeitos desapareceram com isso, e nenhum deles era a conversa:

| | na planilha | aqui |
|---|---|---|
| de onde vem o numero | consulta que ninguem revisa | a mesma peneira da previa |
| frescor | envelhece entre gerar e subir (o cliente compra, responde, ja recebeu template) | recontada a cada aplicacao |
| o que o disparo sabe | nada | anti-repeticao, lixeira, numero que nao recebe, extrato |

### 63.2 UMA peneira, dois chamadores -- e por isso ela saiu da rota

A logica do publico foi de `app/api/admin/disparo-massa/route.ts` para
**`lib/publicoDisparo.ts`**, porque passou a ter dois donos: a tela (campos) e o
assistente (conversa). Com duas peneiras, o numero que o assistente promete e o
numero da previa divergiriam -- e a divergencia so apareceria **depois do envio**,
que e exatamente o erro que este desenho existe para impedir.

⚠️ **O bug que provou a regra, achado no teste:** a primeira versao passava para a
contagem so o que o modelo pedia, e `canal` **nao vem do modelo** -- vem do
template marcado na tela. Com um template da Cloud escolhido, o assistente contava
sem o recorte de canal e a previa contava com ele. Corrigido injetando `canalTpl`
antes de `lerFiltros`.

### 63.3 O modelo PROPOE; quem aplica e o admin

Escolha do usuario. A resposta vem com um cartao ("Proposta de publico", em
portugues, nao em nome de campo) e um botao **Aplicar nos filtros**. Enquanto
ninguem clica, os campos ao lado nao se mexem; depois de aplicado ainda ha
**Revisar** e **Confirmar**. Mesmo freio do "marcar nao aplica" da §29.4, e pelo
mesmo motivo: 800 clientes custam ~R$ 344 e o envio e irreversivel.

**A unica ferramenta do modelo e `montar_publico`, que so LE.** Nao existe caminho
de codigo da rota do assistente ate `/api/send-template`, e o envio continua sendo
o laco do navegador (§26.2) -- a cota nao cabe no tempo de uma rota da Vercel.

### 63.4 ⚠️ NENHUM NOME DE CLIENTE VAI PARA O MODELO

O `tool_result` devolve **contagens**: total, selecionados, quanto de cada carteira,
canal, e os cortes por motivo. Conferido no payload real durante o teste. A lista
com nome e telefone e desenhada pela tela a partir da previa, que roda no nosso
servidor. O modelo nao precisa dos nomes para montar um publico.

### 63.5 Os filtros que faltavam (e de onde cada um sai)

| filtro | fonte | nota |
|---|---|---|
| **times** (IS/ISR/GC) | `carteira_config."time"` | atalho que vira carteira antes da peneira; soma com as escolhidas a dedo |
| **nao compraram no periodo** | `vw_pedido_bi_card` (bucket) | e a **nota fiscal**, o mesmo numero da coluna Pedido emitido. Contar compra pela conversa daria outro resultado e o disparo passaria a discordar do board |
| **fora quem esta em conversa aberta** | `mensagens` (recebida <24h, sob `filtroLinhas`) + `chat_conversa.status` | passa pelo filtro de linhas: com o RD escondido, conversa que so existe la nao conta (§44) |
| **cota por vendedor** | — | molda a **escolha**, nao a elegibilidade: quem sobra da cota segue no total e entra na proxima campanha em vez de sumir como inelegivel |

Teto do disparo subiu de 500 para **1000**, com o campo livre ao lado dos presets --
"200 de cada" com quatro carteiras da 800. A previa passou a dizer **~N min de aba
aberta** (1,8s por envio): com centenas de clientes isso deixa de ser detalhe.

Medido em 28/08 com o pedido literal do usuario: **1.504 elegiveis, 800
selecionados** (200 x anne/thiago/milene/thamires), cortes 130 ja compraram no mes,
59 sem contato, 1 em conversa aberta, 1 numero morto.

### 63.6 Pendencia -- e ela e do usuario, nao de codigo

**`ANTHROPIC_API_KEY` na Vercel** (Settings -> Environment Variables). Sem ela o
bloco aparece com um recado explicando o que falta e os filtros seguem funcionando;
a rota responde **501** com a mesma instrucao. `temAssistente` no GET existe para a
tela nao oferecer uma caixa de conversa que falha no primeiro envio.

⚠️ **A chamada real a Anthropic NAO foi exercitada** -- nao ha chave nesta maquina
e o `ant` nao esta instalado. O que foi provado ponta a ponta, contra um servidor
que imita `POST /v1/messages`: o laco de tool use, o pareamento
`tool_use`/`tool_result`, o replay do historico entre turnos, o payload enviado
(modelo, `thinking: adaptive`, `strict`, as 9 propriedades obrigatorias), e a tela
inteira no Chrome -- pergunta, cartao, Aplicar, previa recontada, zero erro no
console. O que falta validar com chave real e a **qualidade da traducao** do
portugues para os filtros.

### 63.7 Arquivos

| Arquivo | Papel |
|---|---|
| `web/lib/publicoDisparo.ts` | a peneira unica: tipos, `lerFiltros`, `montarPublico` |
| `web/app/api/admin/disparo-massa/chat/route.ts` | Claude Opus 5 + a ferramenta `montar_publico` (so leitura) |
| `web/app/api/admin/disparo-massa/route.ts` | passou a chamar a peneira; ganhou `temAssistente` e `limiteMax` |
| `web/app/admin/page.tsx` | `AssistenteCampanha`, os quatro filtros novos, tempo estimado e cota por carteira |

O historico da conversa mora no **navegador** e volta inteiro para a rota a cada
mensagem: e rascunho que acaba quando a campanha sai, nao merece tabela nem
limpeza. Quem devolve a lista pronta e a rota -- o pareamento tool_use/tool_result
tem de ser exato, e a tela so ecoa.

## 64. Recarregar dentro do hub deixou de jogar todo mundo no board (29/08/2026)

Sintoma: quem estava atendendo no `/chat`, dentro do hub, clicava em atualizar e
caía no board — que refaz a consulta de milhares de cards e ainda perde a
conversa aberta.

**Não era o chat, era o SSO.** No hub o CRM é um `<iframe>` cujo `src` é
`/auth/hub-sso?token=…` (§17). Recarregar a página do hub recarrega esse `src`,
e aquela rota redirecionava SEMPRE para `/`. Direto no domínio o problema não
existe — recarregar `/chat` fica em `/chat`; ele só aparece embutido, que é
como o time usa.

### 64.1 A memória tinha de ser um cookie

Quem decide o destino é o SERVIDOR, antes de qualquer JS rodar. Então
`app/lembrarTela.tsx` (no layout raiz) grava a tela atual no cookie `crm_tela`
a cada navegação, e a rota lê:

```
?destino=  >  cookie crm_tela  >  /
```

`sessionStorage` não serviria: obrigaria a redirecionar para uma página em
branco só para ler e redirecionar de novo. `SameSite=None; Secure` pela mesma
razão do `crm_sessao` — no iframe do hub o documento de topo é outro site.
Fora de https vale `Lax` (o par None/Secure é inválido sem TLS e o cookie
seria recusado no dev local).

O `?destino=` fica pronto para o hub um dia apontar direto para uma tela; **o
hub não precisou de nenhuma mudança** para o conserto funcionar.

### 64.2 ⚠️ A lupa não pode gravar

O board embute o `/chat` com `embed=1` (§41), na nossa própria origem — e o
layout raiz vale lá dentro também. Sem exceção, a lupa gravaria por último e a
volta do SSO cairia numa **conversa em tela cheia, sem a navegação do
produto**, que é justamente o que o modo embutido esconde. `embed=1` não grava.

### 64.3 Open redirect é o risco real desta rota

Redirect com destino vindo de fora aceita qualquer coisa se ninguém validar.
`telaSegura()` só deixa passar caminho relativo: `//host` e `/\host` são
absolutos disfarçados que o navegador trata como outro site, e `/auth/*` viraria
laço. Exercitado contra o servidor de produção local, com token válido:
`//evil.com`, `/\evil.com`, `https://evil.com` e `/auth/hub-sso` caem em `/`.

**O `/auth/callback` do Google continua indo para `/`, sem mudança** — §17 diz
que aquele fluxo fica como está, e ele não sofre do problema (não roda em
iframe).

### 64.4 Como foi verificado

Chrome headless por CDP contra o build de produção (receita da §35.1), com
sessão real: o cookie é escrito em `/`, `/chat`, `/relatorios` e
`/chat?cliente=…`, **não** é escrito pela lupa, e o fluxo inteiro — estar no
chat, passar pelo SSO, voltar ao chat — fecha. Mais os cinco casos de destino
inválido acima, por `curl`.

## 65. Mensagem chega uma a uma, e cada uma com sua hora (30/08/2026)

Relato do usuário: *"ao enviar várias mensagens do celular do cliente para o
nosso chat, as mensagens demoram cerca de 10 segundos para chegar, e elas chegam
todas de uma vez... parece que está sendo processado em lote."* E, junto: se a
cliente manda várias no mesmo minuto, só a última mostrava a hora.

### 65.1 Onde o lote NÃO estava — medido antes de mexer em nada

As duas primeiras suspeitas eram as óbvias, e as duas estavam limpas:

| etapa | medição (30/08, rajada real de 40 mensagens) |
|---|---|
| webhook da Meta → `mensagens` | **individual**, 1,3 a 4,8 s por mensagem (`sincronizado_em - criada_em`) |
| trigger → `realtime.send` → navegador | **individual**, **80 ms** (ouvinte próprio no canal `board`, com a chave anon) |

Ou seja: o servidor nunca agrupou nada. O enfileiramento era todo do navegador.

⚠️ O webhook **atrasa progressivamente** dentro de uma rajada — 1,6 s na primeira
mensagem e 3,6 s na décima — porque faz ~8 idas ao Supabase em série por
mensagem e a Meta entrega mais rápido do que ele digere. É atraso, não lote, e
não foi mexido aqui.

### 65.2 O que cada aviso do Realtime custava

Cada mensagem nova disparava **duas recargas completas**:

| rota | custo medido |
|---|---|
| `/api/chat` (lista de conversas) | **1,3 a 2,2 s** — vários passes paginados sobre `vw_funil_visivel`, mais `vw_chat_linha_cliente`, `chat_conversa`, `vw_chat_espera` |
| `/api/chat/thread` | **0,5 a 1 s**, **82 KB**, 200 mensagens + 6 consultas de apoio |

Dez mensagens em dez segundos = **vinte recargas concorrentes**, e a conversa só
se mexia quando aquilo desafogava — todas as bolhas de uma vez. Pior: a guarda
de in-flight da lista fazia `return` e **perdia** o evento, apesar do comentário
dela prometer a coalescência da §15.3.

### 65.3 A correção — perguntar outra coisa

`GET /api/chat/thread?desde=<criada_em>` devolve só o que existe depois daquela
data: **7,8 KB em vez de 82 KB**, um índice em vez de seis consultas. O aviso do
Realtime passa a usar esse caminho e pendura a bolha na hora; a recarga cara da
lista vai para um balde coalescido de 1,2 s, que faz a rajada inteira caber numa
recarga só.

**O caminho completo continua existindo e continua sendo o certo** ao abrir a
conversa, ao trocar de filtro e no poll de 60 s. É ele que traz notas,
transferências, ligações e o histórico — o lote incremental, por definição, só
olha para a frente.

Quatro armadilhas pagas na construção, todas de perda ou duplicação silenciosa:

1. **Os TIQUES não vêm no `?desde=`.** O aviso do Realtime dispara também quando
   o `status` de uma mensagem ANTIGA muda (o recibo da Meta). Sem tratar, o
   tique congelaria até o poll de 60 s, num lugar onde a equipe repara — "ela
   leu ou não?". A resposta incremental leva junto `estados`: id/status/erro das
   40 últimas, no mesmo índice.
2. **A recarga completa é uma FOTO.** Um `setMsgs(lista)` seco apagaria a
   mensagem que o incremental pendurou enquanto a foto viajava — e ela não
   voltaria no próximo aviso (que só traz o que é mais novo), só no poll de
   60 s. Daí `juntar()`: sobrevive à foto o que for estritamente mais novo que a
   linha mais recente dela.
3. **A bolha otimista apareceria em dobro**, entre o aviso do Realtime (que já
   traz a linha gravada) e a resposta do POST (que era quem a limpava). `juntar`
   mata a `tmp:` quando chega do servidor a mesma fala, do mesmo lado.
4. **A bolha otimista não serve de âncora**: a data dela é a do relógio do
   NAVEGADOR. Um relógio 30 s adiantado faria o `desde` pular as mensagens
   gravadas nesse intervalo, e elas não voltariam nunca — o pedido seguinte
   partiria de uma data ainda mais à frente. A âncora ignora ids `tmp:`.

Rolagem: segue as mensagens novas **só se a pessoa já estava no fim** (120 px de
folga). Quem subiu para reler um preço não é arrancado de lá — mesmo cuidado que
`carregarAntigas` toma na direção oposta.

### 65.4 A hora volta a TODA bolha — revertendo o item 21 da §60.7

Em `bancada` (o desenho em vigor) a hora aparecia só na última bolha do grupo,
para tirar repetição da coluna direita, e reaparecia no hover. **A troca se
mostrou errada no uso**, e o próprio relato do usuário é o argumento: quem
atende precisa saber a que horas cada fala chegou, e "cinco no mesmo minuto" é
justamente a rajada em que a ordem importa. Repetição que responde uma pergunta
não é ruído.

O agrupamento CONTINUA — 2 px dentro do grupo, 10 entre grupos, quina só na
última bolha — porque aquilo não esconde informação nenhuma. O que saiu foi só o
esconde-esconde da hora, e com ele a única regra de `:hover` do chat (a classe
`bc-meta` e o `<style>` que a sustentava, agora código morto).

### 65.5 Como isto foi verificado

`tsc` e `next build` passam — e não provam nada (§55). O que provou:

1. **Ouvinte próprio no canal `board`** (Node + chave anon) medindo a entrega
   evento a evento: 80 ms, sem agrupamento.
2. **Chrome headless por CDP** contra o build local, com a resposta de
   `?desde=` forjada por `Fetch.fulfillRequest` — assim nenhuma mensagem falsa
   foi escrita no banco de produção. Cinco `board_notificar_carteiras` disparados
   à mão: **5 avisos → 5 buscas incrementais → 5 bolhas**, uma por evento, sem
   duplicata e sem perda, cada uma com sua hora.
3. Captura de tela confirmando as sete bolhas reais das 10:15 mostrando `10:15`
   cada uma (§41.5: para desenho, screenshot decide).

### 65.6 O que NÃO foi feito

- **O atraso progressivo do webhook em rajada** (65.1) continua. Encurtá-lo é
  outra frente: mexe no caminho que responde 200 à Meta, onde erro engolido é
  mensagem perdida (§62.3).
- **Nada foi mexido no lado do RD** (§44).

## 66. O microfone falhava dizendo a causa errada (31/08/2026)

Relato com print: gravar áudio no chat devolvia *"Não consegui acessar o
microfone — verifique a permissão do navegador"* com o cadeado do site
mostrando **Microfone ligado**. A tela mandava conferir justamente o que já
estava conferido.

### 66.1 Um `catch` sozinho para causas que se consertam em lugares opostos

`alternarGravacao` tinha **um try para tudo** — `getUserMedia`, o construtor do
`MediaRecorder` e o `start()` — e um `catch {}` que descartava o erro e afirmava
a mesma causa sempre. Qualquer falha ali virava "verifique a permissão".

O `NotAllowedError` do `getUserMedia` chega idêntico em três situações:

| causa | onde se conserta |
|---|---|
| o quadro (iframe) não recebeu `allow="microphone"` | no **pai** — o hub (§22.5), ou a lupa do board (§41.3) |
| o usuário clicou em bloquear | no cadeado |
| a permissão do site JÁ está concedida | **fora do navegador** — privacidade do Windows, extensão, política da empresa |

O terceiro é o do relato, e era o único que a mensagem antiga não sabia
nomear — mandava ao cadeado quem já tinha liberado o cadeado.

`lib/microfone.ts` decide entre eles com o que dá para apurar: o estado da
política do quadro (`quadroDoMicrofone()`, em quatro valores — nunca "sim ou
não", porque **em iframe sem a API de política não dá para cravar**) e o estado
guardado da permissão (`navigator.permissions`, assíncrono — foi por isso que
`explicarErroMicrofone` virou `async`).

**O nome técnico do erro nunca é jogado fora**, vai entre parênteses no fim de
toda mensagem. Perder o texto do erro já custou horas neste projeto (§22.6.1,
§53), e boa parte destes códigos não está documentada.

### 66.2 Microfone e gravador são coisas diferentes

Separados em dois `try`. E a falha do gravador **solta o stream**: sem isso a luz
do microfone fica acesa depois do erro e a pessoa acha — com razão — que ainda
está sendo ouvida. É a armadilha da §22.2, do outro lado. `MediaRecorder`
ausente é checado **antes** de pedir o microfone: não vale acender a luz para
falhar na linha seguinte.

### 66.3 Medido, não deduzido

Chrome 151 headless com microfone falso, contra o **build de produção** e a
tela real do chat, com o /chat embutido num iframe cross-origin (pai em
`127.0.0.1:8899`, CRM em `:3210` — porta diferente é outra **origem**, mas o
mesmo **site**, então o cookie de sessão chega e a política de permissões
morde):

| cenário | resultado |
|---|---|
| iframe **sem** `allow` | política `false`, `NotAllowedError` → recado do quadro, com a saída de abrir o CRM direto |
| iframe **com** `allow="microphone"` | política `true`, grava, nenhum aviso |
| política ok + permissão `granted` + recusa forjada | recado apontando Windows/extensão/outro programa — **o caso do relato** |
| gravador que lança | recado do gravador, e as tracks conferidas em `readyState === "ended"` |

⚠️ Iframe **same-site** não vira target próprio no CDP. Avaliar dentro dele exige
o `contextId` de `Runtime.executionContextCreated` — procurar por target, que é o
caminho da §35.1, devolve "não achei o frame" e parece bug da página.

### 66.4 O que NÃO foi corrigido, porque não está quebrado

O `allow="clipboard-write; microphone; autoplay"` do hub está no lugar
(`murano-app`, `src/app/crm-externo/page.tsx`, hoje passando pelo
`PoolEmbeds`), e a lupa do board também delega. **A causa raiz do relato segue
desconhecida** — a mensagem nova é que vai nomeá-la na próxima tentativa. Se
disser "o navegador JÁ tem permissão", o conserto é no Windows ou em uma
extensão, não neste repositório.


## 67. O chat no celular tinha metade da tela fora da tela (01/09/2026)

Relato do usuário: *"analise a responsividade, para celular. algumas coisas
estão fora da tela"*, e logo em seguida *"prioritariamente o chat"*.

### 67.1 Os números, antes de mexer em nada

Chrome headless por CDP com `Emulation.setDeviceMetricsOverride` em 390×844
(a receita da §35.1, agora com viewport de aparelho). A lista estava correta;
o estrago aparecia ao ABRIR uma conversa:

| | medido |
|---|---|
| largura da página × largura da tela | **685px em 390px** |
| fora da tela | Transferir (293→393), Resolver (403→496), WhatsApp (506→589), 📊 Cliente (599→684) |
| caixa de mensagem | **16px** — a pílula tinha 298 de largura para 348 de conteúdo |
| lista de templates | 151→**485**, ancorada em `left: 0` de um botão que vive no meio da barra |

Nenhum dos três dava erro: `tsc` e `next build` passavam limpos, e não havia
exceção no console. É o padrão da §61.5 — **o que revela isso é medir
`scrollWidth` contra `clientWidth`, não ler o código.**

### 67.2 A causa era uma só, e já tinha nome no projeto

O cabeçalho da conversa monta as ações com `display: "contents"` dentro de uma
linha `flexWrap: "nowrap"`, e cada botão é `whiteSpace: "nowrap"`. Com o texto
inteiro ("↪ Transferir", "WhatsApp ↗"), a soma não cabe e o flex não tem como
encolher — a página inteira estica.

**A lupa do board já tinha passado por isso** (§41.5) e o remédio existia:
`compacto` troca o rótulo pelo ícone e deixa o `title` como legenda. Faltava
alguém ligar o mesmo interruptor para o celular. O mesmo vale para o
compositor: a §51 mediu a conta da pílula na lupa e mandou os três secundários
para trás do "⋯" — no celular ninguém fez.

Daí as duas constantes novas, e a distinção entre elas é o que importa:

| | quem | por quê |
|---|---|---|
| `acoesSoIcone = compacto \|\| isMobile` | rótulo vira ícone | falta largura nos dois |
| `acoesEmFaixa = isMobile && !compacto` | as ações ganham LINHA PRÓPRIA | na lupa o que falta é altura (§41.5); no celular sobra altura e falta largura |

Ou seja: a lupa continua com as ações na linha do nome, e o celular ganha uma
faixa de 40px com os cinco ícones inteiros. **Faixa que rola escondendo botão é
pior que faixa que custa 40px de uma tela de 844.**

`barraEnxuta = compacto || isMobile` faz o mesmo pelo compositor. Dá o mesmo
valor de `acoesSoIcone` hoje, e fica separado de propósito: governam regiões
diferentes, e mexer numa régua não deve arrastar a outra.

### 67.3 A ficha do cliente abria por cima da conversa

`painelAberto` nasce `true` — e no desktop está certo, porque ali ele é a
COLUNA ao lado do diálogo, que é justamente o que o RD não tem (§18/P1). No
celular o MESMO estado vira uma folha modal: abrir um atendimento mostrava o
ERP e escondia as mensagens que a pessoa foi ler.

Fecha uma vez, quando a tela se descobre estreita (`useRef` de guarda, não a
cada resize — senão reabrir seria desfeito ao girar o aparelho). Depois disso
quem manda é o botão 📊.

⚠️ Isso alcançava **a lupa também**: lá `isMobile` é verdadeiro porque o iframe
tem 500px, então a condição `(d1 || compacto) && isMobile && sel && painelAberto`
era satisfeita na primeira abertura.

### 67.4 Efeitos colaterais que a foto pegou e a sonda não

- **O `BotaoLigar` escapou de novo.** Mora em `ligacao.tsx`, então a troca do
  `rot()` não o alcançou e o cabeçalho ficou com cinco ícones e um botão com
  texto no meio. É literalmente a armadilha registrada na §60.8 — *quando a
  mudança é "trocar todos os X da tela", conferir se algum X mora em outro
  arquivo*. Ganhou `pad`/`fonte` opcionais, passados **só** no celular, para a
  lupa continuar byte por byte o que era.
- **A sub-linha do nome quebrava em três linhas.** Carteira e selo da linha
  saem no celular pela mesma razão já escrita ali para o compacto: as duas
  aparecem no rodapé da conversa.
- **O rodapé passou a poder quebrar.** Ele era `nowrap` sem guarda e cortava
  "↪ de Romulo" no meio a 360px — e, com o cabeçalho não repetindo mais
  carteira e linha, ele virou o ÚNICO lugar onde elas aparecem. Cortar deixou
  de ser redundância e virou perda.

### 67.5 O teste — `testes/casos/regressao-responsivo-celular.mjs`

Seis passos: 390 e 360 (o Android mais apertado da equipe), lista, conversa e
**os menus abertos**, que é onde o transbordo se esconde — foi assim que a
lista de templates apareceu.

Uma ressalva importante na sonda: **elemento largo dentro de uma faixa que rola
na horizontal não é transbordo** (a régua de abas da ficha do cliente é assim).
Sem isso o teste vira flaky e ensina a ignorar o próprio alarme.

Estado depois: `scrollWidth == clientWidth` nas duas larguras, caixa de texto
122px a 390 e 92px a 360, zero exceção. Desktop conferido inalterado (rótulos
com texto, painel do ERP à direita, campo de 440px) e `ciclo9` verde.

### 67.6 O que NÃO foi feito

- **A faixa de filas aparece duas vezes no celular** — os quatro contadores no
  alto da lista e a barra fixa embaixo, com os mesmos números. São ~72px de
  altura repetidos, mas nada sai da tela, e tirar um controle que a equipe usa
  é decisão de desenho, não conserto de bug.
- A 360px a caixa de texto fica com 92px. Passa, e é 5,7× o que era, mas é o
  ponto a atacar se alguém quiser mais folga — o caminho seria o TEMPLATE sair
  da pílula, e ele já tem o botão próprio na faixa de janela fechada.
