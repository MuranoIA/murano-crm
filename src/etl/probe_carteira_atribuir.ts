/**
 * Probe descartável — parte 2 do contrato de carteira no RD Conversas.
 *
 * Já fechado (19/08/2026, atribuição real autorizada no contato de teste):
 *   POST /v2/wallets { customer: "<_id>", wallet: "<nome>" } -> HTTP 204
 *   e `current_wallet` do contato passou de null para "Romulo".
 *
 * Falta responder duas perguntas que o módulo de gestão de carteira depende:
 *   1. SOBRESCREVE? (contato que já tem carteira aceita ser reatribuído = a
 *      "transferência" de fato, não só a primeira atribuição)
 *   2. REMOVE? (`DELETE /v2/wallets` não existe — resta tentar valor vazio/nulo)
 *
 * A ordem é proposital: termina tentando devolver o contato ao estado ORIGINAL
 * (`current_wallet: null`). Se a remoção não existir, ele fica em "Romulo" —
 * carteira do próprio usuário — e o probe diz isso explicitamente.
 *
 * Rodar: npx tsx src/etl/probe_carteira_atribuir.ts
 */
import "dotenv/config";

const BASE = process.env.RD_CONVERSAS_BASE_URL ?? "https://api.tallos.com.br";
const TOKEN = String(process.env.RD_CONVERSAS_TOKEN ?? "").replace(/[^\x21-\x7E]/g, "");

// O contato de teste vem do AMBIENTE, não do código: este repositório é
// público (§15.5) e telefone de contato real não entra em arquivo versionado —
// é a mesma pendência que o §19.3 registra sobre o `send-test`. Continua sendo
// allowlist: o probe age só neste contato e nunca aceita alvo por argumento.
// Defina PROBE_CONTATO_ID e PROBE_CONTATO_TEL no .env antes de rodar.
const ALVO = { id: process.env.PROBE_CONTATO_ID ?? "", telefone: process.env.PROBE_CONTATO_TEL ?? "" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function req(metodo: string, path: string, body?: unknown) {
  for (let i = 0; i < 8; i++) {
    const init: RequestInit = {
      method: metodo,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    const r = await fetch(new URL(path, BASE), init);
    const t = await r.text();
    if (r.status === 429) { await sleep(10000 * (i + 1)); continue; }
    let j: any = null;
    try { j = JSON.parse(t); } catch { /* corpo não-JSON */ }
    return { status: r.status, texto: t.replace(/\s+/g, " ").slice(0, 160), json: j };
  }
  return { status: 429, texto: "429 persistente", json: null };
}

async function carteiraAtual(): Promise<string | null | undefined> {
  const r = await req("GET", `/v2/contacts/${ALVO.telefone}/exists`);
  if (!r.json?.data?._id) return undefined;
  return r.json.data.current_wallet ?? null;
}

/** Manda um corpo e devolve o current_wallet resultante. */
async function aplicar(rotulo: string, body: Record<string, unknown>) {
  const r = await req("POST", "/v2/wallets", { customer: ALVO.id, ...body });
  await sleep(3000);
  const agora = await carteiraAtual();
  console.log(`  ${rotulo.padEnd(26)} HTTP ${String(r.status).padEnd(4)} ${r.texto.padEnd(40)} -> current_wallet=${JSON.stringify(agora)}`);
  await sleep(2500);
  return agora;
}

async function main() {
  if (!TOKEN) throw new Error("RD_CONVERSAS_TOKEN ausente no .env");
  if (!ALVO.id || !ALVO.telefone) throw new Error("PROBE_CONTATO_ID/PROBE_CONTATO_TEL ausentes no .env");

  const inicio = await carteiraAtual();
  console.log(`INICIO: current_wallet = ${JSON.stringify(inicio)}\n`);
  await sleep(2500);

  console.log("[1] sobrescreve carteira existente? (Romulo -> Kamilly)");
  const depoisTransf = await aplicar("wallet=Kamilly", { wallet: "Kamilly" });
  const sobrescreve = depoisTransf === "Kamilly";
  console.log(`  >>> TRANSFERÊNCIA ${sobrescreve ? "FUNCIONA" : "NÃO funciona"}\n`);

  console.log("[2] existe remoção? (tenta devolver ao estado original: null)");
  let atual = depoisTransf;
  for (const [rotulo, body] of [
    ["wallet=null", { wallet: null }],
    ["wallet=''", { wallet: "" }],
    ["sem wallet", {}],
  ] as [string, Record<string, unknown>][]) {
    atual = await aplicar(rotulo, body);
    if (atual === null) break;
  }
  const removeu = atual === null;
  console.log(`  >>> REMOÇÃO ${removeu ? "FUNCIONA" : "NÃO existe pela API"}\n`);

  if (!removeu) {
    console.log("[3] sem remoção — devolvendo para a carteira do usuário (Romulo)");
    atual = await aplicar("wallet=Romulo", { wallet: "Romulo" });
  }

  console.log(`\nESTADO FINAL: current_wallet = ${JSON.stringify(atual)}`);
  console.log(`ORIGINAL ERA: null`);
  if (atual !== null) {
    console.log("AÇÃO MANUAL: tirar 'TESTE MARKETING' da carteira pelo painel do RD, se quiser o estado original.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
