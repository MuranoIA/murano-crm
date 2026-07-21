import "dotenv/config";
import { RdConversasClient, RdConversasApiError } from "./lib/rdConversasClient";

const client = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const ROMULO_ID = "6a3a97bbb94e6ad472ee9d02";
const START = "2026-07-01";
const END = "2026-07-21";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e?.status === 429 && a < 8) { await sleep(3000 * (a + 1)); return withRetry(fn, a + 1); } throw e; }
}
async function probe(path: string, params: any = {}) {
  await sleep(250);
  try {
    const r: any = await withRetry(() => client.get(path, params));
    const keys = r && typeof r === "object" ? Object.keys(r) : typeof r;
    console.log(`[OK] ${path} ${JSON.stringify(params)} -> ${JSON.stringify(keys)}`);
    console.log(`     ${JSON.stringify(r).slice(0, 400)}`);
  } catch (e: any) {
    const st = e instanceof RdConversasApiError ? e.status : e?.message;
    console.log(`[${st}] ${path}`);
  }
}
async function main() {
  const p = { start_date: START, end_date: END };
  const pe = { ...p, employee: ROMULO_ID };
  // campanhas
  await probe("/v2/campaigns", p);
  await probe("/v4/campaigns", p);
  await probe("/v1/campaigns", p);
  await probe("/v1/analytics/campaigns", p);
  // mensagens ativas / HSM / templates enviados
  await probe("/v2/active-messages", p);
  await probe("/v2/messages/active", p);
  await probe("/v4/active-messages", p);
  await probe("/v2/active_messages", p);
  // analytics de mensagens
  await probe("/v1/analytics/messages/summary", p);
  await probe("/v1/analytics/messages", p);
  await probe("/v1/analytics/attendances/messages", pe);
  // templates diversos
  await probe("/v2/messages/templates/sent", p);
  await probe("/v2/whatsapp/templates", p);
  await probe("/v4/reports/templates", pe);
}
main();
