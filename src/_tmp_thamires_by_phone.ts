import "dotenv/config";
import { RdConversasClient } from "./lib/rdConversasClient";
import { decryptJwe } from "./lib/decryptMessages";

const client = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});

const THAMIRES_ID = "69d6b06613af1985c95efa62";

function todayBoundsBRT() {
  const startUtcMs = Date.UTC(2026, 6, 20, 3, 0, 0, 0);
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return { startMs: startUtcMs, endMs: endUtcMs };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err?.status === 429 && attempt < 6) {
      await sleep(2000 * (attempt + 1));
      return withRetry(fn, attempt + 1);
    }
    throw err;
  }
}

const ALREADY_REVIEWED = new Set([
  "ALESSANDRA DE SOUZA MORAIS DOS SANTOS",
  "DINA NILZA DA SILVA PENICHE",
  "SIMONE FAUSTINO",
  "RUTINEIA BALIEIRO MONTEIRO",
  "ANGELICA AMARAL DA SILVA",
  "LIDIA CRISTINA MOURA",
  "ROSIMEIRE CAETANO DOS SANTOS",
  "SUELY FERREIRA NUNES",
  "ZARLENE DE LIMA ALBUQUERQUE",
]);

async function main() {
  const { startMs, endMs } = todayBoundsBRT();

  let page = 1;
  let allDocs: any[] = [];
  while (true) {
    const reports: any = await client.get("/v4/reports", {
      start_date: "2026-05-01",
      end_date: "2026-07-20",
      employee: THAMIRES_ID,
      page,
      limit: 49,
    });
    allDocs = allDocs.concat(reports.docs ?? []);
    if (page >= (reports.pages ?? 1)) break;
    page++;
  }
  const byCustomer = new Map<string, any>();
  for (const d of allDocs) {
    if (d.customer?.id) byCustomer.set(d.customer.id, d);
  }
  console.log(`Total únicos: ${byCustomer.size}`);

  const candidatesToday: { id: string; name: string; phone: string }[] = [];
  let checked = 0;
  let noPhone = 0;
  let lookupErrors = 0;

  for (const [customerId, doc] of byCustomer) {
    const name = (doc.customer.full_name ?? "").trim().toUpperCase();
    if (ALREADY_REVIEWED.has(name)) continue;
    const phone = doc.customer.cel_phone;
    if (!phone) {
      noPhone++;
      continue;
    }
    checked++;
    if (checked % 50 === 0) console.error(`progresso: ${checked}`);
    await sleep(150);
    try {
      const contact: any = await withRetry(() => client.get(`/v2/contacts/${phone}/exists`));
      const lastMsg = contact?.data?.last_message_data;
      if (!lastMsg?.created_at) continue;
      const t = new Date(lastMsg.created_at).getTime();
      if (t >= startMs && t < endMs) {
        candidatesToday.push({ id: customerId, name: doc.customer.full_name, phone });
        console.log(`HOJE: ${doc.customer.full_name} | última msg: "${lastMsg.content}" | ${lastMsg.created_at}`);
      }
    } catch (err) {
      lookupErrors++;
    }
  }

  console.log(`\nChecados por telefone: ${checked} | sem telefone: ${noPhone} | erros de lookup: ${lookupErrors}`);
  console.log(`\n=== CANDIDATOS COM ATIVIDADE HOJE: ${candidatesToday.length} ===`);

  for (const cand of candidatesToday) {
    console.log(`\n----- ${cand.name} (id: ${cand.id}) -----`);
    try {
      const history: any = await withRetry(() => client.get("/v2/messages/history", { customer_id: cand.id, page: 1, limit: 50 }));
      if (!history?.messages) {
        console.log("(sem histórico completo disponível)");
        continue;
      }
      const decrypted: any = await decryptJwe(history.messages, process.env.RD_CONVERSAS_PRIVATE_JWK!);
      const msgs: any[] = Array.isArray(decrypted) ? decrypted : [];
      const sorted = msgs.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      for (const m of sorted) {
        console.log(`[${m.created_at}] (${m.sent_by}) ${(m.content ?? "").replace(/\n/g, " / ")}`);
      }
    } catch (err) {
      console.log("ERRO ao decriptar:", err);
    }
    await sleep(300);
  }
}
main();
