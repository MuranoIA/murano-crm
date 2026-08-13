import "dotenv/config";
import { decryptJwe } from "../lib/decryptMessages";

// Despeja UMA conversa com todos os tipos e janela ampla, para inspeção manual.
//
// ⚠️ IMPRIME CONTEÚDO DE MENSAGEM (dado de cliente). Rodar SOMENTE local. Não ligar em
// workflow do GitHub: o repositório é público e os logs do Actions também (seção 15.5).
//
// Uso: PROBE_CLIENTE_ID=<id> PROBE_START=2026-01-01 npm run probe:dump
const BASE = process.env.RD_CONVERSAS_BASE_URL!;
const TOKEN = String(process.env.RD_CONVERSAS_TOKEN ?? "").replace(/[^\x21-\x7E]/g, "");
const JWK = process.env.RD_CONVERSAS_PRIVATE_JWK!;
const ID = String(process.env.PROBE_CLIENTE_ID ?? "").trim();
const START = process.env.PROBE_START ?? "2026-01-01";
const END = process.env.PROBE_END ?? new Date().toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TIPOS = ["text", "audio", "image", "video", "document", "doc", "contact", "location",
  "interactive", "list", "list_reply", "button_reply", "quick_reply", "buttons_image",
  "buttons_video", "buttons_document", "call-to-action", "email"];

async function pag(page: number): Promise<any[]> {
  const qs = `customer_id=${ID}&page=${page}&limit=100&start_date=${START}&end_date=${END}&`
    + TIPOS.map((t) => `type=${encodeURIComponent(t)}`).join("&");
  for (let t = 0; ; t++) {
    const r = await fetch(`${BASE}/v2/messages/history?${qs}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    });
    const txt = await r.text();
    if (r.status === 429 && t < 12) { await sleep(3000 + 2500 * t); continue; }
    if (!r.ok) throw new Error(`${r.status}: ${txt.slice(0, 120)}`);
    const env: any = txt ? JSON.parse(txt) : {};
    if (typeof env?.messages !== "string" || !env.messages.length) return [];
    const dec: any = await decryptJwe(env.messages, JWK);
    return Array.isArray(dec) ? dec : [];
  }
}

async function main() {
  if (!ID) throw new Error("defina PROBE_CLIENTE_ID");
  const todas = new Map<string, any>();
  for (let p = 1; p <= 20; p++) {
    const msgs = await pag(p);
    const antes = todas.size;
    for (const m of msgs) todas.set(`${m.created_at}|${m.content ?? ""}`, m);
    if (!msgs.length || todas.size === antes) break;
    await sleep(1400);
  }
  const ord = [...todas.values()].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  console.log(`\n${ord.length} mensagens | janela ${START}..${END}\n`);
  for (const m of ord) {
    const quem = m.sent_by === "customer" ? "CLIENTE  " : m.sent_by === "operator" ? "vendedor " : String(m.sent_by ?? "?").padEnd(9);
    const dt = String(m.created_at ?? "").slice(0, 16).replace("T", " ");
    const bruto = String(m.content ?? "");
    // mídia chega como JSON url-encoded no próprio `content` — decodifica p/ ver
    // TODAS as chaves (é onde a transcrição do áudio estaria, se vier pela API).
    if (bruto.startsWith("%7B")) {
      try {
        const o = JSON.parse(decodeURIComponent(bruto));
        console.log(`${dt} ${quem} [MÍDIA] chaves=${JSON.stringify(Object.keys(o))}`);
        for (const [k, v] of Object.entries(o)) {
          console.log(`${" ".repeat(27)}  ${k}: ${String(v).slice(0, 160)}`);
        }
        continue;
      } catch { /* cai no print normal */ }
    }
    console.log(`${dt} ${quem} ${bruto.replace(/\s+/g, " ").slice(0, 120)}`);
  }
}

main().catch((e) => { console.error("ERRO:", e?.message ?? e); process.exit(1); });
