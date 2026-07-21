import "dotenv/config";
import { RdConversasClient } from "./lib/rdConversasClient";

const client = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e?.status === 429 && a < 8) { await sleep(3000 * (a + 1)); return withRetry(fn, a + 1); } throw e; }
}
const AMOSTRA = ["69ea93bdafa14254c5b8eab7", "69ea84372658bbf3a9e1967d", "6a048929456296e21fe6243c"];

async function main() {
  for (const cid of AMOSTRA) {
    await sleep(700);
    try {
      const h: any = await withRetry(() => client.get("/v2/messages/history", { customer_id: cid, page: 1, limit: 3 }));
      const m = h?.messages;
      console.log(`${cid}: keys=${JSON.stringify(Object.keys(h ?? {}))} | typeof messages=${typeof m} | len=${typeof m === "string" ? m.length : "-"} | dots=${typeof m === "string" ? (m.match(/\./g) || []).length : "-"} | preview="${typeof m === "string" ? m.slice(0, 40) : JSON.stringify(m)}"`);
    } catch (e: any) {
      console.log(`${cid}: erro ${e?.status ?? e?.message}`);
    }
  }
}
main();
