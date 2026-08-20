/**
 * Probe descartável — descobre COMO mudar a CARTEIRA de um contato no RD
 * Conversas pela API.
 *
 * O que já se sabe (medido 19/08/2026):
 *  · `PATCH /v2/customers/{id}` -> 404 "Not Found" em TEXTO CRU = rota inexistente
 *  · `PATCH /v2/contacts/{_id}` -> 404 {"error":"Customer not found"} mesmo com o
 *    _id correto -> a chave da rota NÃO é o _id
 *  · `PATCH /v2/contacts/{telefone}` -> 200 {"customerId":"..."} = rota certa,
 *    identifica o contato certo... mas IGNOROU EM SILÊNCIO `current_wallet`,
 *    `wallet` e `employee`. Falha silenciosa, o padrão da casa (§9 do CLAUDE.md).
 *  · "carteira" no RD é `current_wallet`, NÃO `employee` (§4, §10.3).
 *
 * Este probe faz duas coisas, nesta ordem:
 *  1. ETAPA DE CONTROLE — muda `email` (hoje null) para provar que a rota muta
 *     ALGUMA coisa e que a verificação por /exists enxerga a mudança. Sem isso,
 *     "não mudou" é ambíguo entre "campo errado" e "rota não escreve nada".
 *  2. VARREDURA — testa nomes candidatos de campo de carteira, um por vez.
 * Tudo é revertido ao valor original no fim.
 *
 * SEGURANÇA: age SOMENTE no contato de teste da allowlist (nunca por argumento).
 * Rodar: npx tsx src/etl/probe_carteira_patch.ts
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
const ROTA = `/v2/contacts/${ALVO.telefone}`;

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
    if (r.status === 429) { await sleep(8000 * (i + 1)); continue; }
    let j: any = null;
    try { j = JSON.parse(t); } catch { /* corpo não-JSON */ }
    return { status: r.status, texto: t, json: j };
  }
  return { status: 429, texto: "429 persistente", json: null };
}

/** Estado visível do contato. `/exists` devolve tudo em texto puro (§2). */
async function estado() {
  const r = await req("GET", `/v2/contacts/${ALVO.telefone}/exists`);
  const d = r.json?.data ?? {};
  if (!d._id) throw new Error(`leitura de estado falhou (HTTP ${r.status}) — abortando`);
  return {
    current_wallet: d.current_wallet ?? null,
    employee: d.employee ?? null,
    email: d.email ?? null,
    code: d.code ?? null,
    tags: (d.tags ?? []).map((t: any) => t?.name),
  };
}

type Estado = Awaited<ReturnType<typeof estado>>;

/** Aplica um corpo e devolve o estado resultante + se mudou algo. */
async function tentar(rotulo: string, body: Record<string, unknown>, base: Estado) {
  const r = await req("PATCH", ROTA, body);
  await sleep(2500);
  const depois = await estado();
  const mudou = JSON.stringify(depois) !== JSON.stringify(base);
  console.log(`  ${mudou ? "MUDOU  " : "ignorou"} ${rotulo.padEnd(28)} HTTP ${r.status} | ${r.texto.replace(/\s+/g, " ").slice(0, 90)}`);
  if (mudou) console.log(`          -> ${JSON.stringify(depois)}`);
  return { mudou, depois };
}

async function main() {
  if (!TOKEN) throw new Error("RD_CONVERSAS_TOKEN ausente no .env");
  if (!ALVO.id || !ALVO.telefone) throw new Error("PROBE_CONTATO_ID/PROBE_CONTATO_TEL ausentes no .env");

  const antes = await estado();
  console.log("ANTES:", JSON.stringify(antes), "\n");
  await sleep(2500);

  // ---- ETAPA 1: controle. A rota escreve alguma coisa? ----
  console.log("[controle] campo inócuo e reversível:");
  const CTRL = "probe-carteira@murano.test";
  const ctrl = await tentar("email", { email: CTRL }, antes);
  if (ctrl.mudou) {
    await sleep(2500);
    await req("PATCH", ROTA, { email: antes.email });
    await sleep(2500);
    const volta = await estado();
    console.log(`  reversão do email -> ${JSON.stringify(volta.email)} | ok=${JSON.stringify(volta) === JSON.stringify(antes)}\n`);
  } else {
    console.log("  >>> a rota respondeu 200 mas NÃO escreveu nem o email.\n");
  }

  // ---- ETAPA 2: varredura de nomes de campo de carteira ----
  console.log("[carteira] nomes candidatos:");
  const EMP = "6a3a97bbb94e6ad472ee9d02"; // employee_id do romulo (carteira_config)
  const candidatos: [string, Record<string, unknown>][] = [
    ["employee_id", { employee_id: EMP }],
    ["employee (obj)", { employee: { _id: EMP } }],
    ["wallet_id", { wallet_id: EMP }],
    ["currentWallet", { currentWallet: "Romulo" }],
    ["current_wallet (obj)", { current_wallet: { name: "Romulo" } }],
    ["operator", { operator: EMP }],
    ["user", { user: EMP }],
  ];

  let vencedor: string | null = null;
  for (const [rotulo, body] of candidatos) {
    const r = await tentar(rotulo, body, antes);
    if (r.mudou) { vencedor = rotulo; break; }
    await sleep(2000);
  }

  console.log("\n>>> CAMPO DE CARTEIRA:", vencedor ?? "NENHUM dos candidatos");

  // ---- reversão final incondicional ----
  await sleep(2500);
  const fim = await estado();
  const intacto = JSON.stringify(fim) === JSON.stringify(antes);
  console.log("ESTADO FINAL:", JSON.stringify(fim));
  console.log("CONTATO INTACTO?", intacto);
  if (!intacto) console.log("!! DIVERGÊNCIA — reverter manualmente para:", JSON.stringify(antes));
}

main().catch((e) => { console.error(e); process.exit(1); });
