import "dotenv/config";
import { RdConversasClient } from "../lib/rdConversasClient";
import { decryptJwe } from "../lib/decryptMessages";
import { getSupabase } from "../lib/supabaseClient";
import { tipoMensagem, idMensagem, ts } from "../lib/transform";

const rd = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const sb = getSupabase();
const JWK = process.env.RD_CONVERSAS_PRIVATE_JWK!;

// --- escopo desta carga: 3 carteiras (atribuição por current_wallet) ---
const TARGETS = [
  { wallet: "romulo", empId: "6a3a97bbb94e6ad472ee9d02" },
  { wallet: "kamilly", empId: "6a3a9851e785f9118ec9141d" },
  { wallet: "luana", empId: "6a3a99836da6dc52edf34c5a" },
];
const TARGET_WALLETS = new Set(TARGETS.map((t) => t.wallet)); // comparado com current_wallet (lowercase)
const START = "2026-04-24"; // dentro do limite de 90 dias do /v4/reports
const END = "2026-07-22";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if ((e?.status === 429 || e?.status === 500) && a < 8) { await sleep(2500 * (a + 1)); return withRetry(fn, a + 1); } throw e; }
}
function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
async function upsert(table: string, rows: any[], onConflict = "id") {
  for (const c of chunks(rows, 500)) {
    const { error } = await sb.from(table).upsert(c, { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
}
async function limpar() {
  // ordem: filhos -> pais (respeita FKs)
  for (const t of ["mensagens", "atendimentos", "clientes", "vendedores"]) {
    const { error } = await sb.from(t).delete().not("id", "is", null);
    if (error) throw new Error(`limpar ${t}: ${error.message}`);
  }
  console.error("[limpar] tabelas zeradas");
}

// ---------------------------------------------------------------------------
// 1) VENDEDORES  (/v2/employees + enriquecimento /v1/employees/{id})
// ---------------------------------------------------------------------------
async function loadVendedores(): Promise<Set<string>> {
  const list: any = await withRetry(() => rd.get("/v2/employees"));
  const arr: any[] = Array.isArray(list) ? list : [];
  const rows: any[] = [];
  for (const e of arr) {
    const id = e._id ?? e.id;
    let role: string | null = null, dept: string | null = null;
    try {
      await sleep(120);
      const d: any = await withRetry(() => rd.get(`/v1/employees/${id}`));
      role = d?.role ?? null;
      dept = d?.departments?.[0]?.name ?? null;
    } catch { /* opcional */ }
    rows.push({ id, nome: e.name ?? null, email: e.email ?? null, role, departamento: dept });
  }
  await upsert("vendedores", rows);
  console.error(`[vendedores] ${rows.length} carregados`);
  return new Set(rows.map((r) => r.id));
}

// ---------------------------------------------------------------------------
// 2) CLIENTES + ATENDIMENTOS
//    Enumera todos os contatos atendidos pelo Romulo, enriquece via /exists
//    e FILTRA por current_wallet == 'romulo' (atribuição estruturada, confiável).
// ---------------------------------------------------------------------------
async function loadReports(vendIds: Set<string>) {
  // 2a) union dos contatos atendidos pelos vendedores-alvo (sem filtro de tag)
  const custDocs = new Map<string, { cust: any; docs: any[] }>();
  for (const t of TARGETS) {
    let page = 1;
    while (true) {
      const r: any = await withRetry(() =>
        rd.get("/v4/reports", { start_date: START, end_date: END, employee: t.empId, page, limit: 49 }));
      for (const d of r.docs ?? []) {
        if (!d.customer?.id) continue;
        const e = custDocs.get(d.customer.id) ?? { cust: d.customer, docs: [] as any[] };
        e.cust = d.customer;
        e.docs.push(d);
        custDocs.set(d.customer.id, e);
      }
      if (page >= (r.pages ?? 1)) break;
      page++;
      await sleep(250);
    }
    console.error(`[reports] ${t.wallet}: acumulado ${custDocs.size} contatos`);
  }
  console.error(`[reports] ${custDocs.size} contatos (union dos 3); enriquecendo via /exists...`);

  // 2b) enriquece via /exists e mantém só current_wallet == 'romulo'
  const clientes = new Map<string, any>();
  const atends = new Map<string, any>();
  let checked = 0;
  for (const [id, { cust, docs }] of custDocs) {
    checked++;
    if (checked % 50 === 0) console.error(`  /exists ${checked}/${custDocs.size} (na carteira: ${clientes.size})`);
    const phone = cust.cel_phone;
    if (!phone) continue;
    let data: any = {};
    try {
      await sleep(150);
      const ex: any = await withRetry(() => rd.get(`/v2/contacts/${phone}/exists`));
      data = ex?.data ?? {};
    } catch { continue; }

    const wallet = String(data.current_wallet ?? "").trim().toLowerCase();
    if (!TARGET_WALLETS.has(wallet)) continue; // atribuição por current_wallet

    clientes.set(id, {
      id,
      nome_completo: data.full_name ?? cust.full_name ?? null,
      telefone: phone,
      cpf: data.cpf ?? null,
      email: data.email ?? null,
      carteira: wallet,
      employee_id: data.employee && vendIds.has(data.employee) ? data.employee : null,
      canal: cust.channel ?? null,
      tags: data.tags ?? cust.tags ?? [],
    });
    for (const d of docs) {
      const vend = d.employee?.id && vendIds.has(d.employee.id) ? d.employee.id : null;
      atends.set(d.id, {
        id: d.id,
        protocolo: d.protocol ?? null,
        cliente_id: id,
        vendedor_id: vend,
        canal: d.channel ?? null,
        tabulacao: d.to_tabulation || null,
        departamento: d.to_department || null,
        total_enviadas: d.total_send_messages ?? null,
        total_recebidas: d.total_receive_messages ?? null,
        aberto: d.opened ?? null,
        fechado: d.closed ?? null,
        criado_em: ts(d.created_at),
        aberto_em: ts(d.opened_at),
        fechado_em: ts(d.closed_at),
        iniciado_em: ts(d.started_at),
        finalizado_em: ts(d.finished_at),
      });
    }
  }
  await upsert("clientes", [...clientes.values()]);
  await upsert("atendimentos", [...atends.values()]);
  console.error(`[clientes] ${clientes.size} | [atendimentos] ${atends.size}`);
  return [...clientes.values()];
}

// ---------------------------------------------------------------------------
// 3) MENSAGENS  (/v2/messages/history, decriptado)
// ---------------------------------------------------------------------------
async function loadMensagens(clientes: any[]) {
  let done = 0, vazios = 0, erros = 0, total = 0;
  for (const cli of clientes) {
    done++;
    if (done % 40 === 0) console.error(`[mensagens] ${done}/${clientes.length} (${total} msgs)`);
    await sleep(300);
    try {
      const h: any = await withRetry(() => rd.get("/v2/messages/history", { customer_id: cli.id, page: 1, limit: 50 }));
      if (typeof h?.messages !== "string" || h.messages.length === 0) { vazios++; continue; }
      const dec: any = await decryptJwe(h.messages, JWK);
      const msgs: any[] = Array.isArray(dec) ? dec : [];
      const seen = new Set<string>();
      const rows: any[] = [];
      for (const m of msgs) {
        const id = idMensagem(cli.id, m.created_at, m.content ?? "");
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push({
          id,
          cliente_id: cli.id,
          vendedor_carteira: cli.carteira,
          enviada_por: m.sent_by ?? null,
          tipo: tipoMensagem(m),
          conteudo: m.content ?? null,
          is_reply: m.is_reply ?? null,
          status: m.status ?? null,
          criada_em: ts(m.created_at),
        });
      }
      if (rows.length) { await upsert("mensagens", rows); total += rows.length; }
    } catch { erros++; }
  }
  console.error(`[mensagens] ${total} msgs | vazios: ${vazios} | erros: ${erros}`);
}

// ---------------------------------------------------------------------------
// 4) VALIDAÇÃO
// ---------------------------------------------------------------------------
async function validar() {
  const problemas: string[] = [];
  const count = async (t: string) => (await sb.from(t).select("*", { count: "exact", head: true })).count ?? 0;
  const nCli = await count("clientes");
  const nAt = await count("atendimentos");
  const nMsg = await count("mensagens");
  const { count: msgSemCliente } = await sb.from("mensagens").select("*", { count: "exact", head: true }).is("cliente_id", null);
  if ((msgSemCliente ?? 0) > 0) problemas.push(`${msgSemCliente} mensagens sem cliente_id`);
  console.log(`\n=== VALIDAÇÃO ===`);
  console.log(`clientes=${nCli} | atendimentos=${nAt} | mensagens=${nMsg}`);
  console.log(problemas.length ? `⚠️ ${problemas.join("; ")}` : `✅ sem inconsistências detectadas`);
}

async function main() {
  console.error(`ETL — carteiras [${[...TARGET_WALLETS].join(", ")}] (por current_wallet) | janela ${START}..${END}\n`);
  await limpar();
  const vendIds = await loadVendedores();
  const clientes = await loadReports(vendIds);
  await loadMensagens(clientes);
  await validar();
  console.error(`\n✅ ETL concluído.`);
}
main().catch((e) => { console.error("ERRO FATAL:", e); process.exit(1); });
