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

async function pullReports(): Promise<any[]> {
  let page = 1;
  const docs: any[] = [];
  while (true) {
    const r: any = await withRetry(() =>
      client.get("/v4/reports", { start_date: START, end_date: END, employee: ROMULO_ID, page, limit: 49 }),
    );
    docs.push(...(r.docs ?? []));
    if (page >= (r.pages ?? 1)) break;
    page++;
    await sleep(300);
  }
  return docs;
}

async function probe(path: string, params: any = {}) {
  try {
    const r: any = await withRetry(() => client.get(path, params));
    const keys = r && typeof r === "object" ? Object.keys(r) : typeof r;
    console.log(`  [OK] ${path} -> keys/tipo: ${JSON.stringify(keys)}`);
    console.log(`       amostra: ${JSON.stringify(r).slice(0, 300)}`);
  } catch (e: any) {
    const st = e instanceof RdConversasApiError ? `${e.status}: ${e.body.slice(0, 120)}` : e?.message;
    console.log(`  [ERRO] ${path} -> ${st}`);
  }
}

async function main() {
  console.log(`Janela: ${START} a ${END} | Vendedor: Romulo\n`);
  const docs = await pullReports();
  console.log(`Protocolos retornados: ${docs.length}`);

  // distintas tabulacoes
  const tabs: Record<string, number> = {};
  for (const d of docs) { const t = d.to_tabulation || "(vazio)"; tabs[t] = (tabs[t] ?? 0) + 1; }
  console.log("\nTabulacoes distintas encontradas:");
  console.log(JSON.stringify(tabs, null, 2));

  // metricas (por cliente unico)
  const contacted = new Set<string>();
  const replied = new Set<string>();
  let vendas = 0;
  const vendaTabs = new Set<string>();
  for (const d of docs) {
    const cid = d.customer?.id;
    if (cid && (d.total_send_messages ?? 0) > 0) contacted.add(cid);
    if (cid && (d.total_receive_messages ?? 0) > 0) replied.add(cid);
    const t = (d.to_tabulation || "").toLowerCase();
    if (t.includes("venda")) { vendas++; vendaTabs.add(d.to_tabulation); }
  }
  console.log(`\n--- METRICAS (parciais, base reports) ---`);
  console.log(`1) Clientes contactados (send>0): ${contacted.size}`);
  console.log(`2) Clientes que responderam (receive>0): ${replied.size}`);
  console.log(`3) Vendas (tabulacao ~"venda"): ${vendas}  ${[...vendaTabs].length ? "tabs: " + [...vendaTabs].join(", ") : ""}`);

  // procura qualquer campo com "template" nos docs
  const doc0 = docs.find((d) => Object.keys(d).some((k) => k.toLowerCase().includes("templ")));
  console.log(`\nAlgum campo 'template' nos reports? ${doc0 ? "SIM" : "nao"}`);

  // sonda endpoints candidatos p/ templates enviados
  console.log(`\nSondando endpoints candidatos para TEMPLATES:`);
  await probe("/v2/templates");
  await probe("/v4/templates");
  await probe("/v1/analytics/templates", { start_date: START, end_date: END });
  await probe("/v1/analytics/messages/templates", { start_date: START, end_date: END });
  await probe("/v2/messages/templates");
}
main();
