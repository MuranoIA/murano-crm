/**
 * Probe descartável — última varredura: existe alguma rota de ATRIBUIÇÃO de
 * carteira pelo lado da carteira/atendente (e não do contato)?
 *
 * Método: corpo VAZIO em cada candidata. O que distingue as duas respostas:
 *   · 404 com "Not Found" em TEXTO CRU  -> rota inexistente
 *   · qualquer JSON (400/422/404 com {"error":...}) -> rota EXISTE e validou
 * Corpo vazio evita criar/alterar qualquer coisa caso a rota exista.
 *
 * Rodar: npx tsx src/etl/probe_carteira_rotas.ts
 */
import "dotenv/config";

const BASE = process.env.RD_CONVERSAS_BASE_URL ?? "https://api.tallos.com.br";
const TOKEN = String(process.env.RD_CONVERSAS_TOKEN ?? "").replace(/[^\x21-\x7E]/g, "");
const EMP = "6a3a97bbb94e6ad472ee9d02"; // romulo

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
    return { status: r.status, texto: t };
  }
  return { status: 429, texto: "429 persistente" };
}

async function main() {
  const alvos: [string, string][] = [
    ["POST", "/v2/wallets"],
    ["PATCH", "/v2/wallets/Romulo"],
    ["POST", "/v2/wallets/Romulo/customers"],
    ["PATCH", `/v2/employees/${EMP}`],
    ["POST", `/v2/employees/${EMP}/customers`],
    ["POST", "/v2/customers"],
  ];

  for (const [m, p] of alvos) {
    const r = await req(m, p, {});
    const cru = r.texto.trim() === "Not Found";
    console.log(
      `${String(r.status).padEnd(4)} ${m.padEnd(6)} ${p.padEnd(36)} ${cru ? "rota INEXISTENTE (404 cru)" : "ROTA EXISTE ->"} ${cru ? "" : r.texto.replace(/\s+/g, " ").slice(0, 160)}`,
    );
    await sleep(2500);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
