import "dotenv/config";
import { decryptJwe } from "../lib/decryptMessages";

// ---------------------------------------------------------------------------
// Testa o parâmetro `type` do /v2/messages/history.
//
// A doc oficial (developers.rdstation.com/reference/conversas-v2-list-messages-history)
// declara `type` como array com DEFAULT = "text". Ou seja: todo o ETL sempre
// recebeu só texto porque nunca pediu outra coisa — o áudio do cliente nunca
// esteve ausente, estava filtrado.
//
// Como a doc não diz a serialização do array, testa as formas usuais:
//   type=audio | type=a,b,c | type[]=a&type[]=b | type=a&type=b (repetido)
//
// Também testa start_date/end_date (documentados) contra a janela de ~30 dias.
// Só leitura. Não imprime conteúdo de cliente — só contagens e campos.
// ---------------------------------------------------------------------------

const BASE = process.env.RD_CONVERSAS_BASE_URL!;
const TOKEN = String(process.env.RD_CONVERSAS_TOKEN ?? "").replace(/[^\x21-\x7E]/g, "");
const JWK = process.env.RD_CONVERSAS_PRIVATE_JWK!;
const ID = String(process.env.PROBE_CLIENTE_ID ?? "").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TIPOS = ["text", "audio", "image", "video", "document", "doc", "contact", "location",
  "interactive", "list", "list_reply", "button_reply", "quick_reply", "buttons_image",
  "buttons_video", "buttons_document", "call-to-action", "email"];

async function bruto(qs: string): Promise<{ status: number; msgs: any[]; chars: number }> {
  const url = `${BASE}/v2/messages/history?${qs}`;
  for (let t = 0; ; t++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } });
    const texto = await r.text();
    if (r.status === 429 && t < 12) { await sleep(3000 + 2500 * t); continue; }
    if (!r.ok) return { status: r.status, msgs: [], chars: 0 };
    const env: any = texto ? JSON.parse(texto) : {};
    if (typeof env?.messages !== "string" || !env.messages.length) return { status: 200, msgs: [], chars: 0 };
    try {
      const dec: any = await decryptJwe(env.messages, JWK);
      return { status: 200, msgs: Array.isArray(dec) ? dec : [], chars: env.messages.length };
    } catch { return { status: 200, msgs: [], chars: env.messages.length }; }
  }
}

function resumo(msgs: any[]) {
  const campos = new Set<string>();
  for (const m of msgs) for (const k of Object.keys(m ?? {})) campos.add(k);
  const por = (q: string) => msgs.filter((m) => m?.sent_by === q).length;
  const datas = (msgs.map((m) => m?.created_at).filter(Boolean) as string[]).sort();
  return `${String(msgs.length).padStart(3)} msgs (op ${por("operator")} / cli ${por("customer")})` +
    ` ${datas[0]?.slice(0, 10) ?? "-"}..${datas[datas.length - 1]?.slice(0, 10) ?? "-"}` +
    ` campos=[${[...campos].sort().join(",")}]`;
}

async function testar(rotulo: string, qs: string) {
  const r = await bruto(`customer_id=${ID}&page=1&limit=100&${qs}`);
  console.log(`  ${String(r.status).padEnd(4)} ${rotulo.padEnd(46)} ${r.status === 200 ? resumo(r.msgs) : ""}`);
  await sleep(1500);
  return r;
}

async function main() {
  if (!ID) throw new Error("defina PROBE_CLIENTE_ID");
  console.log(`\ncustomer_id = <id>\n`);

  console.log("BASE (como o ETL faz hoje — sem `type`):");
  await testar("(sem type)", "");

  console.log("\nSERIALIZAÇÕES DO ARRAY `type`:");
  await testar("type=audio", "type=audio");
  await testar("type=text,audio", "type=text,audio");
  await testar("type[]=text&type[]=audio", "type%5B%5D=text&type%5B%5D=audio");
  await testar("type=text&type=audio (repetido)", "type=text&type=audio");

  console.log("\nTODOS OS TIPOS (na serialização que funcionar acima):");
  await testar("type=<todos> (vírgula)", `type=${TIPOS.join(",")}`);
  await testar("type=<todos> (repetido)", TIPOS.map((t) => `type=${t}`).join("&"));
  await testar("type[]=<todos>", TIPOS.map((t) => `type%5B%5D=${t}`).join("&"));

  console.log("\nJANELA (start_date/end_date documentados):");
  await testar("start_date=2026-05-01", "start_date=2026-05-01&end_date=2026-08-12");
  await testar("start_date=2026-05-01 + todos os tipos", `start_date=2026-05-01&end_date=2026-08-12&${TIPOS.map((t) => `type=${t}`).join("&")}`);
}

main().catch((e) => { console.error("ERRO:", e?.message ?? e); process.exit(1); });
