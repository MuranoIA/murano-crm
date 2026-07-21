import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RdConversasApiError, RdConversasClient } from "./lib/rdConversasClient";
import { decryptJwe } from "./lib/decryptMessages";

const token = process.env.RD_CONVERSAS_TOKEN;
const baseUrl = process.env.RD_CONVERSAS_BASE_URL ?? "https://api.tallos.com.br";
const privateJwk = process.env.RD_CONVERSAS_PRIVATE_JWK;

if (!token) {
  console.error("Defina RD_CONVERSAS_TOKEN no .env antes de rodar a exploração.");
  process.exit(1);
}

const client = new RdConversasClient({ token, baseUrl });

function yesterdayWindow() {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 1);
  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
  return { start_date: toDateStr(start), end_date: toDateStr(end) };
}

function summarize(name: string, data: unknown) {
  const preview = JSON.stringify(data, null, 2).slice(0, 800);
  console.log(`\n--- ${name} ---`);
  if (Array.isArray((data as any)?.data)) {
    console.log(`registros em "data": ${(data as any).data.length}`);
  }
  if (Array.isArray((data as any)?.docs)) {
    console.log(`registros em "docs": ${(data as any).docs.length}`);
  }
  console.log(preview + (preview.length >= 800 ? "\n... (truncado, ver arquivo salvo)" : ""));
}

async function tryFetch(name: string, run: () => Promise<unknown>, outDir: string) {
  try {
    const data = await run();
    summarize(name, data);
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(data, null, 2), "utf-8");
    return data;
  } catch (err) {
    if (err instanceof RdConversasApiError) {
      console.error(`\n--- ${name} (ERRO ${err.status}) ---\n${err.body}`);
    } else {
      console.error(`\n--- ${name} (ERRO) ---`, err);
    }
    return undefined;
  }
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(__dirname, "..", "data", stamp);
  mkdirSync(outDir, { recursive: true });
  console.log(`Salvando respostas brutas em: ${outDir}`);

  const { start_date, end_date } = yesterdayWindow();
  console.log(`Janela consultada: ${start_date} a ${end_date}`);

  await tryFetch("employees", () => client.get("/v2/employees"), outDir);

  const reports = await tryFetch(
    "reports",
    () => client.get("/v4/reports", { start_date, end_date, page: 1, limit: 20 }),
    outDir,
  );

  const timezone = "America/Sao_Paulo";
  await tryFetch(
    "analytics-attendances-summary",
    () => client.get("/v1/analytics/attendances/summary", { start_date, end_date, timezone }),
    outDir,
  );
  await tryFetch(
    "analytics-attendances-retention",
    () => client.get("/v1/analytics/attendances/retention", { start_date, end_date, timezone }),
    outDir,
  );
  await tryFetch(
    "analytics-attendances-reviews-average",
    () => client.get("/v1/analytics/attendances/reviews-average", { start_date, end_date, timezone }),
    outDir,
  );
  await tryFetch(
    "analytics-contacts-origin",
    () => client.get("/v1/analytics/contacts/origin", { start_date, end_date, timezone }),
    outDir,
  );

  const firstDoc = (reports as any)?.docs?.[0];
  const customerId = firstDoc?.customer?.id;
  if (customerId) {
    const history = await tryFetch(
      `messages-history-${customerId}`,
      () => client.get("/v2/messages/history", { customer_id: customerId, page: 1, limit: 20 }),
      outDir,
    );

    const encrypted = (history as any)?.messages;
    if (typeof encrypted === "string" && privateJwk) {
      try {
        const decrypted = await decryptJwe(encrypted, privateJwk);
        summarize(`messages-history-${customerId}-DECRYPTED`, decrypted);
        writeFileSync(
          join(outDir, `messages-history-${customerId}-decrypted.json`),
          JSON.stringify(decrypted, null, 2),
          "utf-8",
        );
      } catch (err) {
        console.error("\nFalha ao decriptar mensagens:", err);
      }
    } else if (typeof encrypted === "string" && !privateJwk) {
      console.log("\nCampo 'messages' veio criptografado, mas RD_CONVERSAS_PRIVATE_JWK não está definido no .env.");
    }
  } else {
    console.log("\nNenhum customer_id encontrado em reports para testar /v2/messages/history — rode de novo em outra janela de datas ou informe um customer_id manualmente.");
  }

  console.log("\nExploração concluída. Confira os arquivos JSON salvos em", outDir);
}

main();
