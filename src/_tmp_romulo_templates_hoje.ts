import "dotenv/config";
import { RdConversasClient } from "./lib/rdConversasClient";
import { decryptJwe } from "./lib/decryptMessages";

const client = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const ROMULO_ID = "6a3a97bbb94e6ad472ee9d02";
const CARTEIRA = "carteira romulo"; // atribuicao correta = tag de carteira, nao o employee do protocolo

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
function naCarteira(customer: any): boolean {
  return (customer?.tags ?? []).some((t: any) => (t.name ?? "").toLowerCase() === CARTEIRA);
}

async function main() {
  const { startMs, endMs, todayStr } = todayBoundsBRT();
  console.log(`Templates enviados pelo Romulo (carteira) em ${todayStr} (BRT)\n`);

  // 1) reune clientes e FILTRA pela tag de carteira do Romulo
  let page = 1;
  const byCustomer = new Map<string, any>();
  while (true) {
    const r: any = await withRetry(() =>
      client.get("/v4/reports", { start_date: "2026-05-01", end_date: todayStr, employee: ROMULO_ID, page, limit: 49 }),
    );
    for (const d of r.docs ?? []) {
      if (d.customer?.id && naCarteira(d.customer)) byCustomer.set(d.customer.id, d.customer);
    }
    if (page >= (r.pages ?? 1)) break;
    page++;
  }
  console.error(`Clientes na carteira romulo a checar: ${byCustomer.size}`);

  // 2) conta templates de HOJE
  const achados: { name: string; hora: string; content: string }[] = [];
  const falhas: string[] = [];
  let done = 0;
  for (const [cid, cust] of byCustomer) {
    done++;
    if (done % 40 === 0) console.error(`  progresso: ${done}/${byCustomer.size} (templates: ${achados.length})`);
    await sleep(300);
    try {
      const history: any = await withRetry(() => client.get("/v2/messages/history", { customer_id: cid, page: 1, limit: 50 }));
      if (typeof history?.messages !== "string") continue;
      const dec: any = await decryptJwe(history.messages, process.env.RD_CONVERSAS_PRIVATE_JWK!);
      const msgs: any[] = Array.isArray(dec) ? dec : [];
      for (const m of msgs) {
        const t = new Date(m.created_at).getTime();
        if (t >= startMs && t < endMs && m.sent_by === "operator" && m.is_template_message === true) {
          const hora = new Date(t - 3 * 3600 * 1000).toISOString().slice(11, 16);
          achados.push({ name: cust.full_name, hora, content: String(m.content ?? "").replace(/\s+/g, " ").slice(0, 60) });
        }
      }
    } catch { falhas.push(cid); }
  }

  achados.sort((a, b) => a.hora.localeCompare(b.hora));
  const porCliente = new Map<string, number>();
  achados.forEach((a) => porCliente.set(a.name, (porCliente.get(a.name) ?? 0) + 1));
  console.log(`\n=== TEMPLATES DO ROMULO HOJE (${todayStr}): ${achados.length} ===`);
  achados.forEach((a, i) => console.log(`${String(i + 1).padStart(2)}. ${a.hora} BRT — ${a.name}  ::  "${a.content}"`));
  console.log(`\nClientes distintos (carteira romulo) que receberam template hoje: ${porCliente.size}`);
  if (falhas.length) console.error(`\n(${falhas.length} clientes falharam no fetch/decrypt: ${falhas.join(",")})`);
}
main();
