# 04 — Playbook (operação e manutenção)

Runbook para quem **opera e mantém** o CRM de Conversas: deploy, sincronização, agendamentos,
rotação de chaves e resolução dos incidentes mais comuns. Sempre que um procedimento tocar o
banco, lembre da regra de ouro: **escrita só no `murano-conversas`; o `v2` é read-only.**

Projetos Supabase: `murano-conversas` = `wtunzezigncwjpcqsfzk` · `murano-clientes-v2` =
`jjvbmqycgjgkwidgcmif`.

---

## Variáveis de ambiente e segredos

| Variável | Onde | Para quê |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Vercel + Actions | Acesso de servidor ao murano-conversas |
| `RD_CONVERSAS_BASE_URL`, `RD_CONVERSAS_TOKEN` | Vercel + Actions | API do RD Conversas |
| `RD_CONVERSAS_PRIVATE_JWK` | Vercel + Actions | Chave privada p/ descriptografar JWE (JSON completo, começa com `{"kty":"RSA"...`) |
| `GITHUB_ETL_TOKEN` | Vercel | `/api/sync-etl` controlar os workflows |
| `ADMIN_USER`, `ADMIN_PASSWORD` | Vercel | Login admin usuário/senha |
| `v2_service_key`, `v2_rest_url` | tabela `wth_config` (no banco) | Funções `pg_cron` lerem o v2 |
| `gh_etl_token`, `gh_etl_repo` | tabela `wth_config` | `pg_cron` disparar o workflow do ETL |

> **Gotcha do JWK na Vercel:** ao colar o valor, garanta que ele começa com `{`. Já aconteceu
> de o `{` inicial se perder na colagem e o `JSON.parse` falhar ("position 5").

## Deploy

- **Web (Vercel):** deploy automático no `git push` para `master`. Mudanças em `web/` só valem
  depois do deploy. Não há passo manual.
- **Banco (Supabase):** aplicar uma **migration nova** numerada em `supabase/migrations/`
  (via MCP `apply_migration` ou o fluxo de migrations). Nunca edite migrations antigas.
- **Edge Functions:** deploy pelo MCP/Supabase (`bi-ranking-vendas`).

## Sincronização de mensagens (ETL)

### Como está agendado
- `etl.yml` — **incremental** `*/10 * * * *` (24/7) + **full** `5 6 * * *` (~03:05 BRT).
- `etl-fast.yml` — **fast** `*/15 * * * *` (com loop interno ~13 min → cobertura quase contínua).
- Como o cron do GitHub, na prática, roda ~1×/hora, quem garante a cadência é o **`pg_cron`
  `etl-disparar`** (`*/10`), que chama a API do GitHub para disparar o `etl.yml`.

### Botões de tuning (env no `etl.yml`)
Ajuste pensando na **cota do RD (~48 req/min)** — o incremental é _throttled_ de propósito
para deixar cota livre ao tempo real e aos envios:

| Env | Valor atual | Efeito |
|---|---|---|
| `ETL_SCAN_DAYS` | `3` | Janela da varredura barata `/exists` |
| `ETL_CALL_BUDGET` | `200` | Teto de checagens por run (~7 min) |
| `ETL_SCAN_CONC` | `1` | Concorrência (1 = taxa previsível) |
| `ETL_SCAN_SLEEP` | `700` | Pausa entre checagens (ms) → ~30 req/min |
| `ETL_DISPARO_DAYS` | `5` | Re-sincroniza quem recebeu template há N dias |
| `ETL_DISPARO_FRESCO_H` | `6` | Disparo recente vai direto p/ fetch caro |

> Subir `ETL_SCAN_CONC`/baixar `ETL_SCAN_SLEEP` acelera o ETL **mas rouba cota do tempo real**
> e pode causar **429 no envio de template do usuário**. Mexa com cuidado.

### Pausar / retomar a sincronização
- **Pelo app (admin):** botão **Sinc | Pause** no topo. Pausar desabilita `etl.yml` e
  `etl-fast.yml` e cancela runs em andamento (libera 100% da cota). **Sempre retome depois.**
- **Pela API:** `POST /api/sync-etl {acao:"pausar"|"retomar"}` (admin).
- **Direto no GitHub:** os workflows podem ficar `disabled_manually`. Reative em Actions ou via
  `gh api` (`workflow enable`). **Sintoma clássico de "não atualiza nada": workflow pausado.**

## Rotação da chave JWE (quando o histórico para de descriptografar)

Sintoma: mensagens novas não aparecem / erro de decrypt. Causa comum: o RD rotacionou o `kid`
da chave.
1. Obtenha o novo JWK privado (JSON completo, `{"kty":"RSA","kid":"...`).
2. Atualize `RD_CONVERSAS_PRIVATE_JWK` na **Vercel** e nos **secrets do GitHub Actions**.
3. Confirme que o valor começa com `{` (gotcha da colagem).
4. Teste pelo botão **↻** de um card ampliado (`/api/sync-cliente`).

## Disparo em massa (template)

1. (Opcional) o próprio fluxo **pausa a sincronização** para liberar cota; ele **retoma no final**.
2. Filtre o board no público-alvo → **📣 Disparo massa** → escolha a quantidade (10–100).
3. Confira **custo (R$ 0,43/template)** e confirme (**irreversível**).
4. O envio é sequencial com _throttle_ de ~1,8 s entre mensagens (anti-429); há barra de progresso
   e lista de falhas. Envios reintentam em 429/5xx.

> Se algo interromper no meio, confirme que a sincronização **voltou** (o `finally` retoma com
> retries, mas verifique o botão Sinc | Pause).

## Orçamento — espelho de catálogo/estoque/campanhas

O `/api/orcamento` lê **só** as tabelas `wth_catalogo` / `wth_estoque` / `wth_campanhas` no
murano-conversas, alimentadas por `pg_cron` a partir do v2:
- `wth-orc-estoque` (`17,47 * * * *`) → `wth_sync_estoque_http()` (estoque a cada 30 min).
- `wth-orc-full` (`7 */6 * * *`) → `wth_sync_orcamento_http()` (catálogo + campanhas + estoque, 6/6 h).

**Forçar atualização agora:** `select public.wth_sync_orcamento_http();` (ou `_estoque_http()`
só para estoque). Esse job **não** usa a cota do RD (lê o v2), então não atrapalha as mensagens.

## Jobs `pg_cron` (referência)

```sql
select jobid, schedule, jobname from cron.job order by jobid;
```

| jobid | Nome | Schedule | Função |
|---|---|---|---|
| 3 | `wth-sync-tudo` | `*/10 * * * *` | `wth_sync_tudo()` — espelho de vendas/carteira/ciclo |
| 4 | `bic-refresh-diario` | `43 6 * * *` | `bic_refresh()` — B.I. de Conversas |
| 5 | `etl-disparar` | `*/10 * * * *` | `etl_disparar_workflow('etl.yml')` |
| 6 | `wth-orc-estoque` | `17,47 * * * *` | `wth_sync_estoque_http()` |
| 7 | `wth-orc-full` | `7 */6 * * *` | `wth_sync_orcamento_http()` |

## Monitoramento e logs

- **ETL:** aba **Actions** do GitHub (runs de `etl.yml`/`etl-fast.yml`); tabela `etl_trigger_log`
  (cada dispatch do `pg_cron`); tabela `wth_sync_log` (sync do WinThor).
- **Web:** logs de função na Vercel.
- **Banco:** logs/Advisors do Supabase (inclui o alerta de RLS).

## Incidentes comuns

### "A coluna Negociação não atualiza em tempo real"
1. O usuário é **admin**? O tempo real roda só para **vendedor/home**; admin usa o **↻**.
2. Os **workflows do ETL estão pausados** (`disabled_manually`)? Retome.
3. **429** por cota saturada? Confirme o throttle do incremental (`ETL_SCAN_CONC=1`,
   `ETL_SCAN_SLEEP=700`). O `negociacao-sync` reintenta sozinho (retry no `rdSync`).

### "Template/histórico não descriptografa"
Provável rotação do JWE → siga **Rotação da chave JWE**.

### "Divergência no ranking" (ERP vs. nosso número)
O ranking oficial é o de **fundo branco** (ERP). Divergências pequenas costumam ser
timing/definição entre o espelho v2 e o ERP. Investigue no nível do pedido (`data_emissao`,
estados ativos, `bi_cancelados_dia`) antes de mudar a regra.

### "Card do próprio funcionário não recebe mensagem"
Contato existe no RD mas com `current_wallet` vazio → o ETL **pula** (sem carteira). É esperado
pela regra de atribuição; requer ajuste do contato no RD.

## Dívidas de segurança a acompanhar

- **RLS desligado** em 9 tabelas — ligar exige policies compatíveis (não ligar "no seco").
- **`send-template`/`send-message` sem checagem de cookie** — adicionar validação de `crm_sessao`.
- Detalhes em [01 — Arquitetura §8](01-ARQUITETURA.md#8-segurança-e-dívidas-conhecidas).
