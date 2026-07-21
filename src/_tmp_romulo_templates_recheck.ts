import "dotenv/config";
import { RdConversasClient } from "./lib/rdConversasClient";
import { decryptJwe } from "./lib/decryptMessages";

const client = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const ROMULO_ID = "6a3a97bbb94e6ad472ee9d02";

const FALHAS = [
  "69ea93bdafa14254c5b8eab7","69ea84372658bbf3a9e1967d","69ea93b79e8d150232935b1e",
  "69ea93c09e8d150232936b46","69ea93c02658bbf3a9e1c43d","69ea93bf9e8d150232936af0",
  "6a048929456296e21fe6243c","69ea93bf9e8d150232936ae7","69ea93bf9e8d150232936ac8",
  "69ea93bf9e8d150232936a69","69ea93bc9e8d1502329362ae","69ea93bf9e8d1502329369fc",
  "69ea93b9afa14254c5b8e36c","69ea93bdb96d4ad4010efb9c","69e92902b96d4ad4010c577e",
];

function todayBoundsBRT() {
  const brtNow = new Date(Date.now() - 3 * 3600 * 1000);
  const y = brtNow.getUTCFullYear(), m = brtNow.getUTCMonth(), d = brtNow.getUTCDate();
  const startMs = Date.UTC(y, m, d, 3, 0, 0, 0);
  return { startMs, endMs: startMs + 24 * 3600 * 1000, todayStr: brtNow.toISOString().slice(0, 10) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// backoff mais generoso pra vencer o rate limit nos que falharam antes
async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e?.status === 429 && a < 10) { await sleep(4000 * (a + 1)); return withRetry(fn, a + 1); } throw e; }
}

async function main() {
  const { startMs, endMs, todayStr } = todayBoundsBRT();

  // mapa id->nome a partir dos reports do Romulo
  const nome = new Map<string, string>();
  let page = 1;
  while (true) {
    const r: any = await withRetry(() =>
      client.get("/v4/reports", { start_date: "2026-05-01", end_date: todayStr, employee: ROMULO_ID, page, limit: 49 }),
    );
    for (const d of r.docs ?? []) if (d.customer?.id) nome.set(d.customer.id, d.customer.full_name);
    if (page >= (r.pages ?? 1)) break;
    page++;
    await sleep(300);
  }

  console.log(`Re-checando ${FALHAS.length} clientes que falharam antes (${todayStr})\n`);
  const achados: { name: string; hora: string; content: string }[] = [];
  const aindaFalha: string[] = [];
  for (const cid of FALHAS) {
    await sleep(900);
    try {
      const h: any = await withRetry(() => client.get("/v2/messages/history", { customer_id: cid, page: 1, limit: 50 }));
      if (typeof h?.messages !== "string") { console.error(`${cid}: sem messages`); continue; }
      const dec: any = await decryptJwe(h.messages, process.env.RD_CONVERSAS_PRIVATE_JWK!);
      const msgs: any[] = Array.isArray(dec) ? dec : [];
      let tpl = 0;
      for (const m of msgs) {
        const t = new Date(m.created_at).getTime();
        if (t >= startMs && t < endMs && m.sent_by === "operator" && m.is_template_message === true) {
          tpl++;
          const hora = new Date(t - 3 * 3600 * 1000).toISOString().slice(11, 16);
          achados.push({ name: nome.get(cid) ?? cid, hora, content: String(m.content ?? "").replace(/\s+/g, " ").slice(0, 60) });
        }
      }
      console.error(`OK ${nome.get(cid) ?? cid}: ${msgs.length} msgs, ${tpl} template(s) hoje`);
    } catch (e: any) {
      aindaFalha.push(cid);
      console.error(`FALHOU ${cid}: ${e?.status ?? e?.message}`);
    }
  }

  achados.sort((a, b) => a.hora.localeCompare(b.hora));
  console.log(`\n=== TEMPLATES ADICIONAIS ENCONTRADOS NOS 15: ${achados.length} ===`);
  achados.forEach((a, i) => console.log(`${i + 1}. ${a.hora} BRT — ${a.name} :: "${a.content}"`));
  console.log(`\nClientes ainda com falha: ${aindaFalha.length}${aindaFalha.length ? " (" + aindaFalha.join(",") + ")" : ""}`);
  console.log(`\n>>> TOTAL FINAL DE TEMPLATES DO ROMULO HOJE = 3 (base) + ${achados.length} (recheck) = ${3 + achados.length}`);
}
main();
