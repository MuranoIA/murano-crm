import "dotenv/config";
import { RdConversasClient } from "./lib/rdConversasClient";
import { decryptJwe } from "./lib/decryptMessages";

const client = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});

const ROMULO_ID = "6a3a97bbb94e6ad472ee9d02";

function todayBoundsUtc() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const { startMs, endMs } = todayBoundsUtc();

  // Janela ampla o suficiente pra pegar qualquer atendimento antigo ainda em aberto.
  let page = 1;
  let allDocs: any[] = [];
  while (true) {
    const reports: any = await client.get("/v4/reports", {
      start_date: "2026-05-01",
      end_date: today,
      employee: ROMULO_ID,
      page,
      limit: 49,
    });
    allDocs = allDocs.concat(reports.docs ?? []);
    if (page >= (reports.pages ?? 1)) break;
    page++;
  }
  // remove duplicados por customer.id (pode haver múltiplos protocolos pro mesmo cliente)
  const byCustomer = new Map<string, any>();
  for (const d of allDocs) {
    if (d.customer?.id) byCustomer.set(d.customer.id, d);
  }
  console.log(`Atendimentos únicos (jan-jul) atribuídos ao Romulo: ${byCustomer.size}`);

  let contactedToday = 0;
  let respondedToday = 0;
  let salesClosed = 0;
  const contactedList: string[] = [];
  const respondedList: string[] = [];

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function fetchHistoryWithRetry(customerId: string, attempt = 0): Promise<any> {
    try {
      return await client.get("/v2/messages/history", { customer_id: customerId, page: 1, limit: 50 });
    } catch (err: any) {
      if (err?.status === 429 && attempt < 5) {
        await sleep(2000 * (attempt + 1));
        return fetchHistoryWithRetry(customerId, attempt + 1);
      }
      throw err;
    }
  }

  let done = 0;
  for (const [customerId, doc] of byCustomer) {
    done++;
    if (done % 25 === 0) console.error(`progresso: ${done}/${byCustomer.size}`);
    await sleep(350);
    try {
      const history: any = await fetchHistoryWithRetry(customerId);
      if (!history?.messages) continue;
      const decrypted: any = await decryptJwe(history.messages, process.env.RD_CONVERSAS_PRIVATE_JWK!);
      const msgs: any[] = Array.isArray(decrypted) ? decrypted : [];

      const todayMsgs = msgs.filter((m) => {
        const t = new Date(m.created_at).getTime();
        return t >= startMs && t < endMs;
      });
      if (todayMsgs.length === 0) continue;

      const operatorSentToday = todayMsgs.some((m) => m.sent_by === "operator");
      const customerRepliedToday = todayMsgs.some((m) => m.sent_by === "customer");

      if (operatorSentToday) {
        contactedToday++;
        contactedList.push(`${doc.customer.full_name} (${todayMsgs.length} msgs hoje)`);
      }
      if (customerRepliedToday) {
        respondedToday++;
        respondedList.push(doc.customer.full_name);
      }
    } catch (err) {
      console.error(`erro no cliente ${customerId}:`, err);
    }
  }

  console.log(`\n=== RESULTADO ===`);
  console.log(`Clientes contactados hoje (Romulo enviou msg): ${contactedToday}`);
  contactedList.forEach((c) => console.log(`  - ${c}`));
  console.log(`\nClientes que responderam hoje: ${respondedToday}`);
  respondedList.forEach((c) => console.log(`  - ${c}`));
}
main();
