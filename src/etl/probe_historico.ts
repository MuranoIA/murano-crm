import "dotenv/config";
import { RdConversasClient } from "../lib/rdConversasClient";
import { decryptJwe } from "../lib/decryptMessages";
import { getSupabase } from "../lib/supabaseClient";
import { tipoMensagem, idMensagem, ts } from "../lib/transform";

// ---------------------------------------------------------------------------
// SONDAGEM DE PAGINAÇÃO do /v2/messages/history, para UMA conversa.
//
// Por que existe: o ETL sempre chamou o histórico com `page:1&limit:50` e nunca
// paginou (run.ts, backfill_carteira.ts, web/lib/rdSync.ts). Só as 50 mensagens
// mais recentes de cada cliente entram — quem passa disso perde o começo da
// conversa. Sintoma no banco: 126 clientes com EXATAMENTE 50 mensagens contra
// 12-19 em cada valor vizinho, e conversas cujo atendimento abriu meses antes
// da primeira mensagem que temos.
//
// Antes de escrever o backfill é preciso saber o contrato da API, que nunca foi
// testado: (1) o envelope diz quantas páginas existem? (2) `page=2,3,...`
// funciona ou é ignorada? (3) a página 1 é a mais recente ou a mais antiga?
// (4) `limit` aceita mais que 50 (= menos chamadas no backfill)?
//
// PRIVACIDADE — este script roda no GitHub Actions de um repositório PÚBLICO,
// onde os logs também são públicos (seção 15.5 do CLAUDE.md). Por isso ele
// imprime SOMENTE metadados: contagens, datas e quem enviou. Nunca conteúdo de
// mensagem, nome ou telefone. O conteúdo vai direto para o Supabase.
//
// Uso:  PROBE_CLIENTE_ID=<customer_id> npm run probe
//       PROBE_GRAVAR=1  -> também faz upsert em `mensagens` (idempotente)
// ---------------------------------------------------------------------------

const rd = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const JWK = process.env.RD_CONVERSAS_PRIVATE_JWK!;
const sb = getSupabase();

const CLIENTE = String(process.env.PROBE_CLIENTE_ID ?? "").trim();
const MAX_PAGES = Number(process.env.PROBE_MAX_PAGES ?? 20);
const GRAVAR = process.env.PROBE_GRAVAR === "1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// mesma política do ETL (run.ts): a cota do RD é compartilhada com o job agendado
// e com os envios do board, então 429 é esperado e transitório.
async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if ((e?.status === 429 || e?.status === 500) && a < 8) {
      console.log(`  (${e.status} — aguardando ${2.5 * (a + 1)}s, tentativa ${a + 1})`);
      await sleep(2500 * (a + 1));
      return withRetry(fn, a + 1);
    }
    throw e;
  }
}

type Msg = { sent_by?: string; content?: string; created_at?: string; status?: string; is_reply?: boolean; is_template_message?: boolean };

async function pagina(page: number, limit: number): Promise<{ env: any; msgs: Msg[]; erro?: string }> {
  const env: any = await withRetry(() => rd.get("/v2/messages/history", { customer_id: CLIENTE, page, limit }));
  if (typeof env?.messages !== "string" || env.messages.length === 0) return { env, msgs: [] };
  try {
    const dec: any = await decryptJwe(env.messages, JWK);
    // decryptJwe devolve string quando o JSON não parseia. É exatamente o caso em que
    // o ETL grava ZERO sem contabilizar erro (falha silenciosa) — precisa aparecer aqui.
    if (!Array.isArray(dec)) return { env, msgs: [], erro: `decrypt não devolveu array (typeof=${typeof dec})` };
    return { env, msgs: dec as Msg[] };
  } catch (e: any) {
    // `kid` antigo (chave rotacionada) cai aqui: histórico permanentemente ilegível
    return { env, msgs: [], erro: `decrypt falhou: ${e?.message ?? e}` };
  }
}

// só metadado — nada de conteúdo (log público)
function resumo(msgs: Msg[]) {
  const datas = (msgs.map((m) => m.created_at).filter(Boolean) as string[]).sort();
  const por = (q: string) => msgs.filter((m) => m.sent_by === q).length;
  return {
    n: msgs.length,
    de: datas[0]?.slice(0, 19) ?? "-",
    ate: datas[datas.length - 1]?.slice(0, 19) ?? "-",
    operator: por("operator"),
    customer: por("customer"),
    bot: por("bot"),
    template: msgs.filter((m) => m.is_template_message === true).length,
  };
}

const chave = (m: Msg) => `${m.created_at}|${m.content ?? ""}`;

async function main() {
  if (!CLIENTE) throw new Error("defina PROBE_CLIENTE_ID");
  for (const k of ["RD_CONVERSAS_TOKEN", "RD_CONVERSAS_BASE_URL", "RD_CONVERSAS_PRIVATE_JWK"]) {
    if (!process.env[k]) throw new Error(`falta ${k} no ambiente`);
  }
  console.log(`customer_id = ${CLIENTE} | max_pages = ${MAX_PAGES} | gravar = ${GRAVAR}\n`);

  const { data: cli } = await sb.from("clientes").select("carteira").eq("id", CLIENTE).maybeSingle();
  const carteira = (cli?.carteira as string | null) ?? null;
  const { count: antes } = await sb.from("mensagens")
    .select("*", { count: "exact", head: true }).eq("cliente_id", CLIENTE);
  console.log(`no banco hoje: ${antes ?? 0} mensagens | carteira: ${carteira ?? "(sem)"}\n`);

  // ---- 1) o envelope informa total/páginas? ----
  const p1 = await pagina(1, 50);
  console.log("ENVELOPE (page=1, limit=50):");
  for (const [k, v] of Object.entries(p1.env ?? {})) {
    console.log(`  ${k}: ${typeof v === "string" ? `<string, ${v.length} chars>` : JSON.stringify(v)}`);
  }
  if (p1.erro) console.log(`  AVISO: ${p1.erro}`);
  console.log(`  decriptado -> ${JSON.stringify(resumo(p1.msgs))}\n`);

  // ---- 2 e 3) `page` avança de verdade? em que ordem? ----
  console.log("PAGINAÇÃO (limit=50):");
  const todas = new Map<string, Msg>();
  for (const m of p1.msgs) todas.set(chave(m), m);
  console.log(`  page 1 -> ${JSON.stringify(resumo(p1.msgs))}`);
  for (let page = 2; page <= MAX_PAGES; page++) {
    await sleep(1300); // teto do RD ~48 req/min (seção 14.5)
    const { msgs, erro } = await pagina(page, 50);
    const novas = msgs.filter((m) => !todas.has(chave(m))).length;
    for (const m of msgs) todas.set(chave(m), m);
    console.log(`  page ${page} -> ${JSON.stringify(resumo(msgs))} | novas=${novas}${erro ? ` | AVISO: ${erro}` : ""}`);
    if (!msgs.length) { console.log("  (página vazia -> fim do histórico)"); break; }
    if (novas === 0) { console.log("  (repetiu a página anterior -> `page` parece ser IGNORADA)"); break; }
    if (page === MAX_PAGES) console.log("  (parou no teto PROBE_MAX_PAGES, pode haver mais)");
  }

  // ---- 4) qual o teto do `limit`? cada degrau corta chamadas do backfill ----
  console.log("\nTETO DO LIMIT (page=1):");
  let melhor = 50;
  for (const lim of [100, 200, 500, 1000]) {
    await sleep(1300);
    const p = await pagina(1, lim);
    for (const m of p.msgs) todas.set(chave(m), m);
    const teto = p.msgs.length < lim; // devolveu menos que pediu -> ou acabou o histórico, ou capou
    console.log(`  limit=${lim} -> ${p.msgs.length} mensagens${teto ? " (menos que o pedido)" : ""}`);
    if (p.msgs.length > melhor) melhor = p.msgs.length;
    if (teto) break;
  }
  console.log(`  maior página obtida: ${melhor}`);

  const coletadas = [...todas.values()];
  console.log(`\nCONSOLIDADO: ${coletadas.length} mensagens distintas na API -> ${JSON.stringify(resumo(coletadas))}`);
  console.log(`comparação: banco tinha ${antes ?? 0}`);

  if (!GRAVAR) { console.log("\n(PROBE_GRAVAR != 1 — nada foi gravado)"); return; }

  // ---- grava (idempotente: mesmo idMensagem do ETL, upsert por id) ----
  const seen = new Set<string>();
  const rows = coletadas.flatMap((m) => {
    const id = idMensagem(CLIENTE, m.created_at as string, m.content ?? "");
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      cliente_id: CLIENTE,
      vendedor_carteira: carteira,
      enviada_por: m.sent_by ?? null,
      tipo: tipoMensagem(m),
      conteudo: m.content ?? null,
      is_reply: m.is_reply ?? null,
      status: m.status ?? null,
      criada_em: ts(m.created_at),
    }];
  });
  const { error } = await sb.from("mensagens").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`upsert mensagens: ${error.message}`);
  const { count: depois } = await sb.from("mensagens")
    .select("*", { count: "exact", head: true }).eq("cliente_id", CLIENTE);
  console.log(`\ngravado: ${rows.length} linhas enviadas | banco: ${antes ?? 0} -> ${depois ?? 0} (+${(depois ?? 0) - (antes ?? 0)})`);
}

main().catch((e) => { console.error("ERRO:", e?.message ?? e); process.exit(1); });
