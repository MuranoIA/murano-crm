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
async function main() {
  const list: any = await withRetry(() => client.get("/v1/campaigns", { start_date: "2026-07-01", end_date: "2026-07-21" }));
  const camps: any[] = list.campaigns ?? [];
  console.log(`Campanhas no periodo: ${camps.length}\n`);

  const keysUnion = new Set<string>();
  let totalSuccess = 0, totalCustomers = 0;
  const walletUse: string[] = [];
  let comWallet = 0;
  const attrFields = new Set<string>();

  let erros = 0;
  for (const c of camps) {
    await sleep(250);
    let d: any;
    try { d = await withRetry(() => client.get(`/v1/campaigns/${c.id}`)); }
    catch { erros++; continue; }
    Object.keys(d).forEach((k) => keysUnion.add(k));
    ["employee", "created_by", "owner", "user", "author"].forEach((k) => { if (k in d) attrFields.add(k); });
    totalSuccess += d?.stats?.success ?? 0;
    totalCustomers += d?.total_customers ?? 0;
    const w = d?.segmentation?.filters?.wallets ?? [];
    if (Array.isArray(w) && w.length) { comWallet++; walletUse.push(`${c.title}: ${JSON.stringify(w)}`); }
  }

  console.log(`Templates enviados com sucesso (conta toda, soma stats.success): ${totalSuccess}`);
  console.log(`Total de destinatarios (total_customers somado): ${totalCustomers}`);
  console.log(`\nCampos de campanha (uniao): ${[...keysUnion].join(", ")}`);
  console.log(`Campos de atribuicao a pessoa encontrados: ${attrFields.size ? [...attrFields].join(", ") : "NENHUM"}`);
  console.log(`Campanhas com filtro por carteira (wallet): ${comWallet}`);
  walletUse.forEach((x) => console.log("  " + x));
  console.log(`\nCampanhas que falharam ao detalhar: ${erros}`);
}
main();
