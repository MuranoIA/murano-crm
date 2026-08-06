# CRM de Conversas — Murano (`rd-conversas-etl`)

CRM de vendas em formato de **funil (kanban)** que puxa as conversas de WhatsApp do
**RD Station Conversas** (ex-Tallos), atribui cada conversa a um vendedor (carteira),
cruza com os dados de venda/ciclo do ERP **WinThor**, e permite ao time atender os
clientes (templates + texto livre dentro da janela de 24 h), acompanhar o funil,
gerar relatórios, montar orçamentos e ver um ranking de vendas ao vivo.

> **App em produção:** https://crm.muranoprofessional.com.br
> (domínio próprio via Cloudflare → Vercel; o projeto Vercel ainda se chama `funil-murano`
> e a URL `funil-murano.vercel.app` está desativada — responde 402)
> **Banco/back-office:** Supabase `murano-conversas`

---

## Documentação

A documentação oficial fica em [`docs/`](docs/). Comece pelo documento que corresponde ao seu papel:

| Documento | Para quem | O que cobre |
|---|---|---|
| [01 — Arquitetura](docs/01-ARQUITETURA.md) | Devs, tech leads | Visão de alto nível: componentes, fluxo de dados, modelo de dados, integrações, decisões e segurança. |
| [02 — Manual de Uso](docs/02-MANUAL-DE-USO.md) | Vendedores, gestão, admin | Como usar o sistema no dia a dia, por papel: board, colunas, atendimento, orçamento, relatório, ranking. |
| [03 — Guia do Código](docs/03-GUIA-DO-CODIGO.md) | Dev júnior | Onde está cada coisa, o que cada arquivo/rota faz, como rastrear um fluxo, como rodar localmente. |
| [04 — Playbook](docs/04-PLAYBOOK.md) | Quem opera/mantém | Deploy, sincronização, crons, rotação de chave, incidentes comuns e como resolver. |

---

## Stack em uma tela

- **Front + back:** Next.js 14 (App Router) na **Vercel** — um board client-side (`web/app/page.tsx`) + ~18 rotas de API serverless (`web/app/api/*`).
- **Banco + jobs:** **Supabase** `murano-conversas` — Postgres, Edge Functions e `pg_cron`.
- **ETL:** job TypeScript (`src/etl/run.ts`) rodando em **GitHub Actions** (`etl.yml`, `etl-fast.yml`), disparado por `pg_cron`.
- **Integração externa:** API do **RD Station Conversas** (`api.tallos.com.br`) — histórico de mensagens criptografado em **JWE** (`node-jose`).
- **Dados de venda:** espelho do WinThor no projeto **`murano-clientes-v2`** (somente leitura), copiado para tabelas `wth_*` dentro do `murano-conversas`.

## Rodando localmente

```bash
# ETL (raiz do repo)
npm install
npm run etl            # usa .env na raiz (nunca commitado)

# Web (pasta web/)
cd web
npm install
npm run dev            # http://localhost:3000
```

Variáveis de ambiente e segredos: veja [docs/04-PLAYBOOK.md](docs/04-PLAYBOOK.md#variáveis-de-ambiente-e-segredos).

## Regras de ouro (leia antes de mexer)

1. **Escrita SOMENTE no `murano-conversas`.** O `murano-clientes-v2` é **read-only**: para usar um dado dele, espelhe para dentro do `murano-conversas` (padrão `wth_*`). Nunca escreva no v2.
2. **Segredos ficam no servidor.** Token do RD, chave JWE e `service_role` nunca vão para o navegador.
3. **A cota do RD é o recurso escasso** (~48 req/min). O ETL de fundo é _gentil_ de propósito para reservar cota ao tempo real e aos envios do usuário.
