/**
 * Probe descartável — mapeia a chave de contato do `PATCH /v2/wallets/{nome}`.
 *
 * Medido até aqui (19/08/2026):
 *   POST  /v2/wallets  {}                    -> 403 "Contato Inválido"
 *   POST  /v2/wallets  {customer:"<_id>"}    -> 404 "Carteira não localizada."  (contato OK)
 *   POST  /v2/wallets  {customer:"<tel>"}    -> 403 "Contato Inválido"          (é o _id, não o telefone)
 *   PATCH /v2/wallets/{qualquer} {customer}  -> 403 "Contato Inválido"          (outra chave!)
 *   POST/PUT /v2/wallets/{nome}              -> 404 cru (não existem)
 *   DELETE /v2/wallets[/{nome}]              -> 404 cru (NÃO há rota de desfazer)
 *
 * SEM RISCO: o nome no path é sempre uma carteira INEXISTENTE, então mesmo que
 * a chave de contato esteja certa a chamada morre em "Carteira não localizada"
 * — nunca atribui ninguém.
 *
 * Rodar: npx tsx src/etl/probe_carteira_contrato.ts
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
const FALSA = "___PROBE_CARTEIRA_INEXISTENTE___";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function req(metodo: string, path: string, body: unknown) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(new URL(path, BASE), {
      method: metodo,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    if (r.status === 429) { await sleep(8000 * (i + 1)); continue; }
    return { status: r.status, texto: t.replace(/\s+/g, " ").slice(0, 160) };
  }
  return { status: 429, texto: "429 persistente" };
}

async function main() {
  if (!TOKEN) throw new Error("RD_CONVERSAS_TOKEN ausente no .env");
  if (!ALVO.id || !ALVO.telefone) throw new Error("PROBE_CONTATO_ID/PROBE_CONTATO_TEL ausentes no .env");

  const chaves: [string, Record<string, unknown>][] = [
    ["contact", { contact: ALVO.id }],
    ["customer_id", { customer_id: ALVO.id }],
    ["customerId", { customerId: ALVO.id }],
    ["customers[]", { customers: [ALVO.id] }],
    ["contacts[]", { contacts: [ALVO.id] }],
    ["_id", { _id: ALVO.id }],
    ["id", { id: ALVO.id }],
  ];

  console.log(`[PATCH /v2/wallets/{FALSA}] procurando a chave do contato:`);
  for (const [rotulo, body] of chaves) {
    const r = await req("PATCH", `/v2/wallets/${FALSA}`, body);
    const avancou = !/contato/i.test(r.texto);
    console.log(`  ${String(r.status).padEnd(4)} ${rotulo.padEnd(14)} ${avancou ? "AVANCOU ->" : "          "} ${r.texto}`);
    if (avancou) { console.log(`  >>> chave de contato do PATCH: ${JSON.stringify(body)}`); break; }
    await sleep(2500);
  }

  // POST sem nenhuma chave de carteira: a mensagem distingue "campo ausente" de
  // "nome não encontrado"? Se for idêntica, o nome da chave não dá para deduzir
  // sem uma atribuição real.
  console.log(`\n[POST /v2/wallets] {customer} sem nenhuma chave de carteira:`);
  const r = await req("POST", "/v2/wallets", { customer: ALVO.id });
  console.log(`  ${String(r.status).padEnd(4)} ${r.texto}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
