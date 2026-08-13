import "dotenv/config";
import { RdConversasClient } from "../lib/rdConversasClient";
import { decryptJwe } from "../lib/decryptMessages";

// ---------------------------------------------------------------------------
// Procura um endpoint do RD que devolva MÍDIA e/ou TRANSCRIÇÃO de áudio.
//
// Contexto: o painel do RD mostra o áudio do cliente COM transcrição em texto
// (verificado em tela, conversa de 06/08). O /v2/messages/history não devolve
// nada disso — só texto digitado. Logo, o dado existe na conta e o painel o
// busca por outro caminho. Este script tenta variações plausíveis.
//
// Só leitura. Imprime status/forma da resposta, nunca conteúdo de cliente.
// Uso: PROBE_CLIENTE_ID=<id> PROBE_PROTOCOLO=<protocolo> npm run probe:endpoints
// ---------------------------------------------------------------------------

const rd = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const JWK = process.env.RD_CONVERSAS_PRIVATE_JWK!;
const ID = String(process.env.PROBE_CLIENTE_ID ?? "").trim();
const PROTO = String(process.env.PROBE_PROTOCOLO ?? "").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// candidatos: (a) outras versões do mesmo recurso, (b) parâmetros que possam
// destravar mídia, (c) sub-recursos de mensagem/atendimento.
const CANDIDATOS: { path: string; params?: Record<string, any> }[] = [
  { path: "/v2/messages/history", params: { customer_id: ID, page: 1, limit: 50, include_media: true } },
  { path: "/v2/messages/history", params: { customer_id: ID, page: 1, limit: 50, media: true } },
  { path: "/v2/messages/history", params: { customer_id: ID, page: 1, limit: 50, type: "all" } },
  { path: "/v4/messages/history", params: { customer_id: ID, page: 1, limit: 50 } },
  { path: "/v1/messages/history", params: { customer_id: ID, page: 1, limit: 50 } },
  { path: "/v2/messages", params: { customer_id: ID, page: 1, limit: 50 } },
  { path: "/v2/messages/transcriptions", params: { customer_id: ID } },
  { path: `/v2/customers/${ID}/messages`, params: { page: 1, limit: 50 } },
  { path: `/v2/contacts/${ID}/messages`, params: { page: 1, limit: 50 } },
  ...(PROTO ? [{ path: `/v2/attendances/${PROTO}/messages`, params: { page: 1, limit: 50 } }] : []),
];

// 429 é devolvido ANTES do roteamento, então sem retry um 429 não distingue
// "endpoint não existe" de "cota estourada" — que é justamente o que queremos saber.
async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e?.status === 429 && a < 12) { await sleep(3000 + 2500 * a); return withRetry(fn, a + 1); }
    throw e;
  }
}

async function tentar(c: { path: string; params?: Record<string, any> }) {
  const rotulo = `${c.path} ${JSON.stringify(c.params ?? {}).replace(ID, "<id>")}`;
  try {
    const r: any = await withRetry(() => rd.get(c.path, c.params as any));
    const chaves = r && typeof r === "object" ? Object.keys(r) : [];
    let extra = "";
    if (typeof r?.messages === "string" && r.messages.length) {
      extra = ` | messages=<${r.messages.length} chars>`;
      try {
        const dec: any = await decryptJwe(r.messages, JWK);
        if (Array.isArray(dec)) {
          const campos = new Set<string>();
          for (const m of dec) for (const k of Object.keys(m ?? {})) campos.add(k);
          const cust = dec.filter((m: any) => m?.sent_by === "customer").length;
          extra += ` -> ${dec.length} msgs (customer=${cust}) campos=[${[...campos].sort().join(",")}]`;
        }
      } catch { extra += " (decrypt falhou)"; }
    }
    console.log(`  200  ${rotulo}\n       chaves=[${chaves.join(",")}]${extra}`);
  } catch (e: any) {
    console.log(`  ${e?.status ?? "ERR"}  ${rotulo}`);
  }
}

async function main() {
  if (!ID) throw new Error("defina PROBE_CLIENTE_ID");
  console.log(`buscando endpoint com mídia/transcrição | cliente <id>\n`);
  for (const c of CANDIDATOS) { await tentar(c); await sleep(1500); }
  console.log("\nLembrete: 404 aqui não prova que o dado não existe — prova que ESTE caminho não é o do painel.");
}

main().catch((e) => { console.error("ERRO:", e?.message ?? e); process.exit(1); });
