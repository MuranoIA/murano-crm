# 03 — Guia do Código (para dev júnior)

Este guia te ensina **onde está cada coisa**, **o que ela faz** e **como seguir um fluxo do
começo ao fim**. Se você nunca abriu este repositório, comece por aqui. Leia também
[01 — Arquitetura](01-ARQUITETURA.md) para o panorama.

---

## 1. Como o projeto está dividido

O repositório tem **dois "apps" no mesmo git**:

```
rd-conversas-etl/
├── src/                      # O ETL (job de fundo que puxa o RD) — roda em Node/ts-node
│   ├── etl/run.ts            #   entrypoint do ETL (modos incremental/full/fast/mensagens)
│   └── lib/                  #   rdConversasClient, decryptMessages, supabaseClient, transform
├── web/                      # O app Next.js (o que o usuário usa) — roda na Vercel
│   ├── app/
│   │   ├── page.tsx          #   O BOARD (componente client gigante) + tela de Login
│   │   ├── api/**/route.ts   #   ~18 rotas de API (o backend)
│   │   ├── OrcamentoFlutuante.tsx  # janela de orçamento
│   │   └── auth/callback/    #   retorno do login Google
│   └── lib/
│       ├── papel.ts          #   modelo de papéis (admin/home/vendedor)
│       └── rdSync.ts         #   sync de UMA conversa (usado pelas rotas de tempo real)
├── supabase/migrations/*.sql # DDL do banco + funções pg_cron (numeradas 00xx_)
└── .github/workflows/*.yml   # agendamento do ETL (etl.yml, etl-fast.yml)
```

Regra mental rápida:
- **Mexeu em tela ou rota?** É em `web/`. Deploy = push → Vercel.
- **Mexeu em como os dados entram do RD?** É em `src/etl/` (e `web/lib/rdSync.ts` para o tempo real).
- **Mexeu em tabela/função do banco?** É uma migration em `supabase/migrations/`.

## 2. Conceitos que aparecem o tempo todo

- **`crm_sessao`** — cookie com o papel do usuário: `"admin"`, `"home"` ou o `slug` do
  vendedor. Toda rota de dados lê esse cookie para autorizar.
- **`service_role`** — chave "de servidor" do Supabase. As rotas usam ela, então **ignoram
  RLS**; a segurança é feita no código (pelo cookie). Nunca exponha essa chave no navegador.
- **`carteira` / `slug`** — a "pasta" de clientes de um vendedor. `slug` = 1ª palavra do nome
  em minúsculo. É a chave de escopo (um vendedor só vê a própria).
- **`cliente_id` sintético** — se começa com `winthor:` ou `venda:`, é um card que veio do
  ERP e **ainda não tem conversa** no RD. Não dá para mandar texto livre nele.
- **Janela de 24 h** — regra do WhatsApp; fora dela só template.
- **Idempotência** — o `id` da mensagem é um SHA1 de `cliente|data|conteúdo`. Por isso o ETL
  e o tempo real podem gravar a mesma mensagem sem duplicar (`upsert onConflict: id`).

## 3. O board (`web/app/page.tsx`)

É um componente **client** (`"use client"`) de ~2.4 mil linhas. Não se assuste: ele é grande,
mas repetitivo. Mapa mental:

- **Estado** (topo da função `Page`): `cards`, `pedidoCards`, `sessao`, filtros (`filtro`,
  `busca`, `periodoPorColuna`…), estado da lupa (`cardZoom`, `zoomMsgs`), do disparo em massa
  (`massa*`), etc.
- **`load()`**: faz `GET /api/funil` e preenche os cards. Um `setInterval(load, 5000)` recarrega
  a cada 5 s.
- **`COLUNAS`**: array com as 5 colunas. O board faz um `.map` sobre ele para desenhar as colunas.
- **Regras de input** (`dentro24h`, `mostraInput`): decidem se um card mostra o campo de texto.
- **Tempo real da Negociação**: um `useEffect` com `setInterval(tick, 10000)` que chama
  `POST /api/negociacao-sync`. Só roda se `sessao.role !== "admin"`.
- **Ações**: `recontatar()` (template), `enviarResposta()` (texto livre), `abrirZoom()`/
  `atualizarZoom()` (lupa), `enviarMassa()` (disparo), `descartarCard()` (lixeira).

> Dica para achar código no `page.tsx`: procure pelo **nome do estado** ou pela **string do
> botão** (ex.: `"Disparo massa"`) — leva direto à parte que você quer.

## 4. As rotas de API (`web/app/api/*/route.ts`)

Todas começam com `export const dynamic = "force-dynamic"` e criam o cliente Supabase com a
`service_role`. Padrão de autorização: lê `crm_sessao`; usa `carteiraDe`/`veTudo` para escopo
e `podeAdmin` para features de admin.

### Referência rápida

| Rota | Método | O que faz | Auth | Escreve? |
|---|---|---|---|---|
| `/api/session` | GET | Retorna papel/carteira/e-mail e papéis assumíveis | cookie | não |
| `/api/login` `/api/logout` | POST | Login admin (usuário/senha) / limpa cookie | — | não |
| `/api/trocar-papel` | POST | Troca o papel ativo (valida contra `acesso`) | `crm_email` | só cookie |
| `/api/funil` | GET | **Agrega o board inteiro** (as 5 colunas) | cookie, escopo por carteira | não |
| `/api/mensagens` | GET | Histórico recente de UM cliente (para a lupa) | cookie | não |
| `/api/negociacao-sync` | POST | Puxa mensagens novas dos cards em Negociação (tempo real) | cookie | `mensagens` |
| `/api/sync-cliente` | POST | Puxa mensagens de UMA conversa (após template / botão ↻) | cookie + carteira | `mensagens` |
| `/api/send-template` | POST | Envia template pelo RD; registra o disparo | ⚠ só env | `disparos_template` |
| `/api/send-message` | POST | Envia texto livre pelo RD (dentro de 24 h) | ⚠ só env | não |
| `/api/relatorio` | POST | Gera Excel (`exceljs`) dos clientes filtrados | cookie, escopo | não |
| `/api/orcamento` | GET | Catálogo + preço + estoque + campanhas (lê `wth_*`) | cookie | não |
| `/api/produtos` | GET | Lista de produtos para o filtro | cookie | não |
| `/api/clientes-por-produto` | GET | Quem comprou produto X no período (RPC) | cookie | não |
| `/api/descartados` | GET/POST/DELETE | Lixeira (listar/descartar/restaurar) | cookie, escopo | `wth_descartados` |
| `/api/meta` | GET/POST | Meta do dia do ranking (`bi_config`) | POST só admin | `bi_config` |
| `/api/templates` | GET/POST | Catálogo de templates (`crm_templates`) | POST só admin | `crm_templates` |
| `/api/sync-etl` | GET/POST | Status/pausar/retomar/disparar o ETL (GitHub API) | **só admin** | não |

> ⚠ **`send-template` e `send-message` não checam o cookie hoje** (só validam envs). Está
> anotado como dívida de segurança em [01 — Arquitetura §8](01-ARQUITETURA.md#8-segurança-e-dívidas-conhecidas).

### `web/lib/` (helpers compartilhados)
- **`papel.ts`** — funções puras do modelo de papéis (`papelDe`, `veTudo`, `carteiraDe`,
  `podeAdmin`, `tokenDePapel`). É a fonte da verdade de "quem pode o quê".
- **`rdSync.ts`** — porta o pipeline de mensagens do ETL para **uma** conversa: descriptografa
  JWE (`node-jose`), busca `GET /v2/messages/history`, faz `upsert` em `mensagens`. É o que as
  rotas de tempo real (`sync-cliente`, `negociacao-sync`) chamam.

## 5. O ETL (`src/etl/run.ts`)

Job Node que popula `mensagens`/`clientes`/`atendimentos`. O **modo** vem de `ETL_MODE`:

- **`incremental`** (padrão): janela curta, checagem barata `/exists`, só busca o histórico
  caro de quem mudou. É o que roda a cada 10 min.
- **`full`**: janela de 89 dias, revisita todos os atendimentos abertos (cobre a "cauda longa").
  Roda 1×/dia de madrugada.
- **`fast`**: varredura em _loop_ do "conjunto quente" com **tiers de prioridade** (A ≤ 30 min,
  B ≤ 3 h, C resto) — a coluna **Negociação é sempre tier A**. Quase tempo real.
- **`mensagens`**: backfill histórico resumível.

Peças-chave: `src/lib/rdConversasClient.ts` (cliente HTTP do RD, com `withRetry` em 429/500),
`src/lib/decryptMessages.ts` (JWE → texto Latin-1), `src/lib/supabaseClient.ts` (`service_role`),
`src/lib/transform.ts` (normalização + `idMensagem` = SHA1).

Detalhe de operação (cota, throttle, agendamento) fica no [04 — Playbook](04-PLAYBOOK.md).

## 6. O banco (Supabase `murano-conversas`)

- **Migrations** em `supabase/migrations/00xx_*.sql` — DDL e funções `pg_cron`. Sempre crie uma
  **nova** migration numerada; não edite as antigas.
- **Views** que o board consome: `vw_funil` (conversas por etapa), `vw_pedido_bi_card`
  (pedidos), `vw_ciclo_card` (oportunidade/ciclo), `vw_vendas_bi_total` (ranking),
  `vw_templates_diario`/`vw_templates_auto_diario` (contagens).
- **Espelho `wth_*`**: alimentado por funções `wth_sync_*_http()` via `pg_cron` (lê o v2 por
  HTTP). Exemplo recente: orçamento (`wth_catalogo`/`wth_estoque`/`wth_campanhas` +
  `wth_sync_catalogo_http`/`_estoque_http`/`_campanhas_http`).

## 7. Como rastrear um fluxo (exemplos)

**"O que acontece quando um vendedor responde um cliente?"**
1. `page.tsx` → `enviarResposta(cliente_id)` faz `POST /api/send-message {cliente_id, texto}`.
2. A rota lê `clientes`/`carteira_config` (para não expor o telefone), monta a chamada e envia
   para o RD `POST /v2/messages/{id}/send`.
3. O board mostra a mensagem de forma otimista; no próximo ciclo de `negociacao-sync`/`load()`,
   a mensagem real volta do RD e substitui a otimista.

**"Como um pedido do ERP vira card 'Pedido emitido'?"**
1. `pg_cron wth-sync-tudo` espelha as vendas do v2 para `wth_*`.
2. As views (`vw_pedido_bi_card`, `vw_vendas_bi_total`) expõem esses dados.
3. `/api/funil` junta o card de venda com a conversa (por `cliente_id`, `codcli` **ou** últimos
   8 dígitos do telefone) e o coloca na coluna Pedido emitido.

## 8. Como rodar localmente

```bash
# ETL
npm install
npm run etl            # lê .env na raiz

# Web
cd web && npm install && npm run dev   # http://localhost:3000
```

Você precisa das variáveis de ambiente (Supabase, RD, JWK). Veja a lista em
[04 — Playbook](04-PLAYBOOK.md#variáveis-de-ambiente-e-segredos). Sem o JWK válido, o histórico
de mensagens não descriptografa.

## 9. Convenções ao contribuir

- **Nunca escreva no `murano-clientes-v2`** (é read-only). Precisa de um dado dele? Espelhe
  para `wth_*` via `pg_cron` e leia o espelho.
- **Segredos ficam no servidor** (rotas de API / envs), nunca no `page.tsx`.
- **Respeite a cota do RD**: qualquer novo polling deve caber nos ~48 req/min; prefira reusar
  `rdSync.ts`.
- **Banco muda por migration numerada nova**, nunca editando uma antiga.
- **Estilos** no board são inline (objeto `RD` de paleta); não há `globals.css`.
