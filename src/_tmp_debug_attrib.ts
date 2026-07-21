import "dotenv/config";
import { RdConversasClient, RdConversasApiError } from "./lib/rdConversasClient";

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
async function probe(path: string, params: any = {}) {
  await sleep(300);
  try {
    const r: any = await withRetry(() => client.get(path, params));
    console.log(`[OK] ${path} ${JSON.stringify(params)} -> ${JSON.stringify(r).slice(0, 300)}`);
  } catch (e: any) {
    console.log(`[${e instanceof RdConversasApiError ? e.status : e?.message}] ${path} ${JSON.stringify(params)}`);
  }
}

async function main() {
  // 1) pull dos clientes que apareceram sob employee=Romulo e olha as tags "carteira *"
  let page = 1;
  const byCustomer = new Map<string, any>();
  while (true) {
    const r: any = await withRetry(() =>
      client.get("/v4/reports", { start_date: "2026-05-01", end_date: "2026-07-21", employee: ROMULO_ID, page, limit: 49 }),
    );
    for (const d of r.docs ?? []) if (d.customer?.id) byCustomer.set(d.customer.id, d.customer);
    if (page >= (r.pages ?? 1)) break;
    page++;
    await sleep(200);
  }
  console.log(`Clientes sob employee=Romulo: ${byCustomer.size}`);

  const carteiraCount: Record<string, number> = {};
  let comCarteiraRomulo = 0, semTagCarteira = 0;
  let carteiraRomuloTagId = "";
  for (const c of byCustomer.values()) {
    const carteiras = (c.tags ?? []).filter((t: any) => (t.name ?? "").toLowerCase().startsWith("carteira"));
    if (carteiras.length === 0) semTagCarteira++;
    for (const t of carteiras) {
      carteiraCount[t.name] = (carteiraCount[t.name] ?? 0) + 1;
      if ((t.name ?? "").toLowerCase().includes("romulo") || (t.name ?? "").toLowerCase().includes("rômulo")) {
        comCarteiraRomulo++;
        carteiraRomuloTagId = t.id;
      }
    }
  }
  console.log(`\nDistribuicao de tags "carteira *" entre os clientes sob employee=Romulo:`);
  console.log(JSON.stringify(carteiraCount, null, 2));
  console.log(`\nCom tag carteira do Romulo: ${comCarteiraRomulo}`);
  console.log(`Sem nenhuma tag de carteira: ${semTagCarteira}`);
  console.log(`tag id carteira romulo: ${carteiraRomuloTagId}`);

  // 2) tenta descobrir endpoint que lista contatos por tag/carteira
  console.log(`\nSondando endpoints de contatos por tag/carteira:`);
  await probe(`/v2/contacts`, { page: 1, limit: 5 });
  await probe(`/v4/contacts`, { page: 1, limit: 5 });
  await probe(`/v2/contacts`, { tag: carteiraRomuloTagId, page: 1, limit: 5 });
  await probe(`/v2/contacts`, { tags: carteiraRomuloTagId, page: 1, limit: 5 });
  await probe(`/v2/wallets/Romulo`);
  await probe(`/v2/wallets/Romulo/contacts`);
  await probe(`/v1/segmentation/contacts`, { wallets: "Romulo" });
}
main();
