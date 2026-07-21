import "dotenv/config";
import { RdConversasClient } from "./lib/rdConversasClient";

const client = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});

const THAMIRES_ID = "69d6b06613af1985c95efa62";

function todayBoundsBRT() {
  const brtNow = new Date(Date.now() - 3 * 3600 * 1000);
  const y = brtNow.getUTCFullYear(), m = brtNow.getUTCMonth(), d = brtNow.getUTCDate();
  const startMs = Date.UTC(y, m, d, 3, 0, 0, 0);
  return { startMs, endMs: startMs + 24 * 3600 * 1000, todayStr: brtNow.toISOString().slice(0, 10) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e?.status === 429 && a < 8) { await sleep(3000 * (a + 1)); return withRetry(fn, a + 1); } throw e; }
}

async function main() {
  const { startMs, endMs, todayStr } = todayBoundsBRT();

  // 1) carteira de clientes da Thamires (janela ampla)
  let page = 1;
  const allDocs: any[] = [];
  while (true) {
    const r: any = await withRetry(() =>
      client.get("/v4/reports", { start_date: "2026-05-01", end_date: todayStr, employee: THAMIRES_ID, page, limit: 49 }),
    );
    allDocs.push(...(r.docs ?? []));
    if (page >= (r.pages ?? 1)) break;
    page++;
  }
  const byCustomer = new Map<string, any>();
  for (const d of allDocs) if (d.customer?.id) byCustomer.set(d.customer.id, d);
  console.error(`Carteira Thamires: ${byCustomer.size} clientes. Checando última mensagem de cada...`);

  // 2) via /exists (texto puro, sem criptografia): quem tem última mensagem HOJE
  const hoje: { name: string; at: string; content: string }[] = [];
  let checked = 0;
  for (const [, doc] of byCustomer) {
    const phone = doc.customer?.cel_phone;
    if (!phone) continue;
    checked++;
    if (checked % 50 === 0) console.error(`  ${checked}...`);
    await sleep(150);
    try {
      const c: any = await withRetry(() => client.get(`/v2/contacts/${phone}/exists`));
      const lm = c?.data?.last_message_data;
      if (!lm?.created_at) continue;
      const t = new Date(lm.created_at).getTime();
      if (t >= startMs && t < endMs) {
        hoje.push({ name: doc.customer.full_name, at: lm.created_at, content: String(lm.content ?? "").replace(/\s+/g, " ").slice(0, 80) });
      }
    } catch { /* ignora lookup individual */ }
  }

  hoje.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  console.log(`\n=== CLIENTES QUE A THAMIRES CONVERSOU HOJE (${todayStr}): ${hoje.length} ===`);
  hoje.forEach((h, i) => {
    const hora = new Date(new Date(h.at).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
    console.log(`${String(i + 1).padStart(2)}. ${h.name}  [última msg ${hora} BRT] "${h.content}"`);
  });
}
main();
