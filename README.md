# rd-conversas-etl

ETL para extrair dados da API do RD Station Conversas (ex-Tallos) e, futuramente,
carregar num banco Supabase para relatórios/BI.

## Fase 0 — Exploração

Objetivo: descobrir o formato real dos dados antes de desenhar qualquer schema.

```bash
npm install
npm run explore
```

O script `src/explore.ts`:
- lê o token em `RD_CONVERSAS_TOKEN` (arquivo `.env`, nunca commitado);
- consulta os principais endpoints (funcionários, relatórios do dia anterior,
  analytics de atendimento, origem de contatos, e uma amostra de histórico de
  mensagens);
- imprime um resumo no console e salva o JSON bruto de cada resposta em
  `data/<timestamp>/*.json` (pasta ignorada pelo git) para inspeção manual.

## Fase 2 — ETL para Supabase (próxima etapa)

Depois de mapear os campos reais retornados na Fase 0, o próximo passo é:
- desenhar as tabelas no Supabase;
- escrever o job de UPSERT idempotente por dia (`D-1`);
- agendar via GitHub Actions (`.github/workflows/`).

Ainda não implementado — aguardando resultado da exploração.
