# 01 — Arquitetura

Documento técnico de alto nível do CRM de Conversas (Murano). Descreve os componentes,
o fluxo de dados, o modelo de dados, as integrações, as decisões de arquitetura e a
postura de segurança. Público: desenvolvedores e tech leads.

---

## 1. Visão de contexto

O sistema resolve um problema de operação de vendas: os vendedores atendem clientes por
WhatsApp através do **RD Station Conversas**, mas o RD sozinho não diz **para quem ligar
primeiro**, **quem parou de comprar**, **qual o ciclo de recompra** nem cruza a conversa
com a venda real do ERP. Este CRM junta tudo num **funil de 5 colunas** e vira a
ferramenta diária do time.

```
   Cliente (WhatsApp)
         │
         ▼
  RD Station Conversas  ──(API, JWE)──►  ETL (GitHub Actions)  ──►  Supabase: murano-conversas
   (api.tallos.com.br)                                                  (mensagens, clientes,
         ▲                                                               atendimentos, ...)
         │ envio de template / msg                                          │
         │                                                                   │  vw_* (views)
  ERP WinThor ──► murano-clientes-v2 ──(pg_cron: wth_sync_*)──► wth_* ───────┤
   (vendas/estoque)    (espelho, RO)                             (espelho)    │
                                                                              ▼
                                             Next.js na Vercel (crm.muranoprofessional.com.br)
                                                                board + ~18 rotas de API
                                                                              │
                                                                              ▼
                                                                  Vendedor / Home / Admin
```

## 2. Componentes

### 2.1 Aplicação web (Next.js na Vercel)
- **Board** (`web/app/page.tsx`): um único componente client-side grande (~2.4 mil linhas)
  que renderiza o funil, faz polling a cada 5 s (`/api/funil`) e a cada 10 s na coluna
  Negociação (`/api/negociacao-sync`).
- **Rotas de API** (`web/app/api/*/route.ts`, ~18): o backend. Rodam como funções
  serverless. Toda a autorização é feita **no código** lendo o cookie `crm_sessao`
  (as rotas usam a `service_role` do Supabase, que ignora RLS).
- Detalhes de cada rota: ver [03 — Guia do Código](03-GUIA-DO-CODIGO.md).

### 2.2 Banco e jobs (Supabase `murano-conversas`)
- **Postgres**: tabelas nativas (`mensagens`, `clientes`, `atendimentos`, `acesso`,
  `carteira_config`, `disparos_template`, `crm_templates`, `wth_descartados`, `bi_config`…)
  e várias `views` que o board consome (`vw_funil`, `vw_pedido_bi_card`, `vw_ciclo_card`,
  `vw_vendas_bi_total`, `vw_templates_diario`…).
- **Tabelas-espelho `wth_*`**: cópias somente-leitura de dados do WinThor (via v2):
  `wth_carteira`, `wth_faturamento`, `wth_itens`, `wth_ciclo`, `wth_vendas_bi`, e as do
  orçamento `wth_catalogo`/`wth_estoque`/`wth_campanhas`.
- **Edge Function** `bi-ranking-vendas` (Deno): calcula o ranking de vendas ao vivo lendo
  o v2 e gravando snapshots (`bi_ranking_snapshots`).
- **`pg_cron`**: agenda os jobs de fundo (ver §6).

### 2.3 ETL (GitHub Actions)
- Job TypeScript `src/etl/run.ts` (`ts-node`), executado por dois workflows:
  `etl.yml` (incremental a cada 10 min + full diário) e `etl-fast.yml` (modo `fast`,
  quase tempo real). Detalhe operacional em [04 — Playbook](04-PLAYBOOK.md).

## 3. Fluxo de dados

### 3.1 Entrada de conversas (RD → banco)
1. O ETL chama o RD: `GET /v4/reports` (enumera contatos/atendimentos por vendedor),
   `GET /v2/contacts/{phone}/exists` (checagem barata: mudou algo?) e, quando precisa do
   conteúdo, `GET /v2/messages/history` (histórico **criptografado em JWE**).
2. As mensagens JWE são descriptografadas com `node-jose` (chave `RD_CONVERSAS_PRIVATE_JWK`)
   e o texto é lido como **Latin-1** (o RD envia ISO-8859-1, não UTF-8).
3. Faz `upsert` idempotente em `mensagens` (id = SHA1 de `cliente|criada_em|conteúdo`),
   `clientes`, `atendimentos`.

### 3.2 Atribuição por carteira
A conversa é atribuída ao vendedor pela **primeira palavra do `current_wallet`** do contato
no RD, em minúsculas (ex.: "Milene Pamplona" → `milene`). Contatos cujo `current_wallet`
não está em `carteira_config` (ativos) são **ignorados** (nunca entram no banco).

### 3.3 Dados de venda (WinThor → v2 → espelho)
O ERP alimenta o projeto **`murano-clientes-v2`** (fora do nosso controle de escrita). O
`pg_cron` roda funções `wth_sync_*_http()` que **leem o v2 via HTTP (PostgREST)** e fazem
`upsert` nas tabelas `wth_*` do `murano-conversas`. A partir daí, o board e o orçamento leem
só o espelho local. **A Vercel nunca lê o v2 diretamente.**

### 3.4 Tempo real na Negociação
O board mantém uma lista dos `cliente_id` da coluna Negociação e, a cada 10 s, chama
`POST /api/negociacao-sync`, que faz o **mesmo _full fetch_** do botão ↻ (busca no RD as
mensagens novas e grava em `mensagens`). Roda só para **vendedor e home** (admin usa o ↻ do
card ampliado). O ETL incremental é _throttled_ para deixar cota livre a esse polling.

### 3.5 Saída (envio de mensagem)
- **Template** (`POST /api/send-template` → RD `POST /v3/messages/template/send`): funciona
  mesmo com a conversa fechada (>24 h). Registra em `disparos_template`.
- **Texto livre** (`POST /api/send-message` → RD `POST /v2/messages/{id}/send`): só dentro da
  janela de 24 h do WhatsApp.

## 4. Modelo de papéis (autorização)

Token no cookie `crm_sessao`: `"admin"`, `"home"` ou o `slug` do vendedor. Helpers em
`web/lib/papel.ts`:

| Função | Regra |
|---|---|
| `papelDe(sessao)` | `admin` \| `home` \| `vendedor` \| `null` |
| `veTudo(sessao)` | `true` para admin **e** home (enxergam todas as carteiras) |
| `carteiraDe(sessao)` | `null` se vê tudo; senão o slug (filtro de escopo no servidor) |
| `podeAdmin(sessao)` | **só admin** (Sincronizar, Disparo em massa, B.I., Ranking) |

Login: usuário/senha (admin) **ou** Google OAuth (`@supabase/ssr` → `/auth/callback`), que
grava `crm_email`; a tabela `acesso` lista os papéis assumíveis de cada e-mail (troca de
papel via `/api/trocar-papel`). Ex.: Romulo = `admin|vendedor`, Joas = `admin|home`.

## 5. Integrações externas

| Integração | Uso | Observações |
|---|---|---|
| **RD Station Conversas** (`api.tallos.com.br`) | Ler histórico, checar contatos, enviar template/mensagem | Cota ~48 req/min (recurso escasso). Histórico em JWE. Sem webhook por mensagem — a atualização é por _polling_. |
| **murano-clientes-v2** (Supabase) | Vendas, ciclo, catálogo, estoque, campanhas | **Somente leitura.** Consumido via espelho `wth_*`. |
| **GitHub Actions API** | Disparar/pausar/retomar o ETL | `/api/sync-etl` (admin) e `pg_cron` (`etl_disparar_workflow`). |
| **Netlify** (sites de B.I./ranking) | Painéis externos abertos por link no menu | Ranking: `murano-bi-ranking-vendas.netlify.app`; B.I. Conversas: `bi-conversas-murano.netlify.app`. |

## 6. Jobs agendados (`pg_cron` no murano-conversas)

| jobid | Nome | Schedule | O que faz |
|---|---|---|---|
| 3 | `wth-sync-tudo` | `*/10 * * * *` | Espelha carteira/faturamento/itens/ciclo/vendas do v2 |
| 4 | `bic-refresh-diario` | `43 6 * * *` | Recalcula o B.I. de Conversas (`bic_*`) |
| 5 | `etl-disparar` | `*/10 * * * *` | Dispara o workflow `etl.yml` (GitHub cron é pouco confiável) |
| 6 | `wth-orc-estoque` | `17,47 * * * *` | Atualiza o **estoque** do orçamento (a cada 30 min) |
| 7 | `wth-orc-full` | `7 */6 * * *` | Atualiza catálogo + campanhas + estoque do orçamento (6/6 h) |

## 7. Decisões de arquitetura (o "porquê")

- **Next.js full-stack, não SPA + backend separado.** O peso do sistema é backend (JWE,
  Excel, cota do RD, papéis, tempo real). Manter front e backend no mesmo projeto reduz
  fronteiras e mantém os segredos no servidor. (Análise completa em `docs/` interno — comparação com Lovable.)
- **Espelhar o WinThor em vez de ler ao vivo.** O v2 é read-only e instável em disponibilidade;
  espelhar dá desempenho, resiliência e um único ponto de leitura do v2.
- **`pg_cron` dispara o ETL.** O cron do GitHub, na prática, roda ~1×/hora mesmo configurado
  para `*/10`. O `pg_cron` no banco garante a cadência real.
- **_Polling_, não webhook.** O RD Conversas **não** oferece webhook por mensagem; a única via
  para frescor é otimizar o polling dentro da cota (tiers de prioridade + tempo real na Negociação).
- **Idempotência em tudo.** `id` de mensagem determinístico (SHA1) faz ETL de fundo e sync em
  tempo real conviverem sem duplicar.

## 8. Segurança e dívidas conhecidas

> Estes pontos estão documentados de propósito para revisão — não são segredo.

- **RLS desligado** em 9 tabelas (`clientes`, `mensagens`, `atendimentos`, `acesso`,
  `carteira_config`, `wth_descartados`, `crm_templates`, `disparos_template`, `vendedores`).
  As rotas usam `service_role` (não a `anon`), então o app funciona; o risco é a `anon key`
  poder ler/escrever se vazar. Ligar RLS exige criar policies compatíveis antes.
- **`/api/send-template` e `/api/send-message` não checam o cookie** `crm_sessao` (só validam
  envs). Qualquer chamada com um `cliente_id` válido dispararia um envio. Candidato a correção.
- **Rotação da chave JWE**: se o RD rotaciona o `kid`, a descriptografia quebra até atualizar
  `RD_CONVERSAS_PRIVATE_JWK`. Procedimento no [Playbook](04-PLAYBOOK.md).
- **Escrita restrita ao `murano-conversas`** (regra de operação): o v2 é read-only.

## 9. Glossário

- **Carteira**: conjunto de clientes de um vendedor. O `slug` (1ª palavra do nome, minúsculo)
  é a chave de escopo.
- **Card sintético**: card cujo `cliente_id` tem prefixo `winthor:` ou `venda:` — vem do ERP,
  ainda **sem conversa** no RD (não dá para enviar texto livre, só template quando houver contato).
- **Janela de 24 h**: regra do WhatsApp — fora dela a conversa é "fechada" e só aceita template.
- **Espelho (`wth_*`)**: cópia local, no murano-conversas, de dados do WinThor/v2.
- **`vw_*`**: views que compõem os dados do board.
