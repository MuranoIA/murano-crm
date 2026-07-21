import "dotenv/config";
import { RdConversasClient } from "./lib/rdConversasClient";
import { decryptJwe } from "./lib/decryptMessages";

const client = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const ROMULO_ID = "6a3a97bbb94e6ad472ee9d02";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e?.status === 429 && a < 8) { await sleep(3000 * (a + 1)); return withRetry(fn, a + 1); } throw e; }
}
function jweHeader(jwe: string) {
  return JSON.parse(Buffer.from(jwe.split(".")[0], "base64url").toString("utf-8"));
}

async function main() {
  const jwk = JSON.parse(process.env.RD_CONVERSAS_PRIVATE_JWK!);
  console.log("kid da chave privada no .env:", jwk.kid);

  // pega um cliente recente do Romulo
  const reports: any = await withRetry(() =>
    client.get("/v4/reports", { start_date: "2026-07-01", end_date: "2026-07-21", employee: ROMULO_ID, page: 1, limit: 10 }),
  );
  const doc = (reports.docs ?? []).find((d: any) => d.customer?.id);
  if (!doc) { console.log("nenhum cliente encontrado"); return; }
  console.log(`Cliente de teste: ${doc.customer.full_name} (${doc.customer.id})`);

  await sleep(500);
  const history: any = await withRetry(() =>
    client.get("/v2/messages/history", { customer_id: doc.customer.id, page: 1, limit: 20 }),
  );
  if (typeof history?.messages !== "string") { console.log("sem messages"); return; }

  console.log("kid da mensagem (hoje):", jweHeader(history.messages).kid);
  console.log("kids batem?", jweHeader(history.messages).kid === jwk.kid ? "SIM ✅" : "NAO ❌");

  try {
    const dec: any = await decryptJwe(history.messages, process.env.RD_CONVERSAS_PRIVATE_JWK!);
    const arr = Array.isArray(dec) ? dec : [];
    console.log(`\n✅ DECRYPT OK — ${arr.length} mensagens`);
    arr.slice(0, 5).forEach((m: any) =>
      console.log(`  [${m.created_at}] (${m.sent_by}) template=${m.is_template_message} :: ${(m.content ?? "").replace(/\s+/g, " ").slice(0, 70)}`),
    );
  } catch (e: any) {
    console.log(`\n❌ DECRYPT FALHOU: ${e?.message ?? e}`);
  }
}
main();
