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

// ---------------------------------------------------------------------------
// MODOS
//   incremental (padrão): janela curta (ETL_INCREMENTAL_DAYS, default 2 dias),
//     NÃO chama /exists para clientes já conhecidos, carrega mensagens só das
//     conversas ativas na janela. Rápido -> serve para rodar de X em X min.
//   full: janela de ~89 dias, /exists em todos os contatos, enriquece vendedores.
//     Pesado -> recarga manual/ocasional (ETL_MODE=full).
// Overrides: ETL_START / ETL_END (YYYY-MM-DD). ETL_LIMPAR=1 zera as tabelas antes
//   (use com cuidado; por padrão o upsert idempotente dispensa isso).
// ---------------------------------------------------------------------------
const MODE = (process.env.ETL_MODE || "incremental").toLowerCase();
const FULL = MODE === "full";
const INCREMENTAL_DAYS = Number(process.env.ETL_INCREMENTAL_DAYS || 2);
const hojeISO = new Date().toISOString().slice(0, 10);
const janelaDias = FULL ? 89 : INCREMENTAL_DAYS; // full respeita o limite de 90 dias do /v4/reports
const startAuto = new Date(Date.now() - janelaDias * 86400000).toISOString().slice(0, 10);
const START = process.env.ETL_START || startAuto;
const END = process.env.ETL_END || hojeISO;

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

// Lê todos os clientes em escopo (carteiras-alvo) já presentes na base.
async function clientesEmEscopoDoBanco(): Promise<{ id: string; carteira: string }[]> {
  const out: { id: string; carteira: string }[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await sb
      .from("clientes").select("id,carteira")
      .in("carteira", [...TARGET_WALLETS])
      .range(from, from + page - 1);
    if (error) throw new Error(`select clientes: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) if (r.carteira) out.push({ id: r.id, carteira: r.carteira });
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

// Conversas que precisam ser recarregadas todo incremental, descobertas pelo NOSSO
// banco (não pelo /v4/reports, que só devolve atendimentos novos):
//   (a) "aguardando" — cliente foi o último a falar (qualquer idade): é onde a
//       resposta do vendedor precisa ser detectada p/ limpar o alerta;
//   (b) ativas nos últimos `dias` dias — conversas em andamento.
// Conjunto pequeno e certeiro (~150-200), mantendo o run em ~2 min.
async function clientesParaRefrescar(dias: number): Promise<{ id: string; carteira: string }[]> {
  const cutoff = new Date(Date.now() - dias * 86400000).toISOString();
  const out: { id: string; carteira: string }[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await sb
      .from("vw_funil").select("cliente_id,vendedor")
      .or(`ultima_enviada_por.eq.customer,ultima_atividade.gte.${cutoff}`)
      .range(from, from + page - 1);
    if (error) throw new Error(`select vw_funil refrescar: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const cart = String(r.vendedor ?? "");
      if (r.cliente_id && TARGET_WALLETS.has(cart)) out.push({ id: r.cliente_id, carteira: cart });
    }
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

// Ids de clientes que JÁ têm ao menos uma mensagem (p/ backfill resumível).
async function idsComMensagens(): Promise<Set<string>> {
  const set = new Set<string>();
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await sb.from("mensagens").select("cliente_id").range(from, from + page - 1);
    if (error) throw new Error(`select mensagens: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) if (r.cliente_id) set.add(r.cliente_id);
    if (rows.length < page) break;
    from += page;
  }
  return set;
}

// Busca as carteiras já conhecidas (clientes na base) para um conjunto de ids.
// Permite pular /exists de quem já está atribuído — o grande ganho do incremental.
async function carteirasConhecidas(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const c of chunks(ids, 300)) {
    const { data, error } = await sb.from("clientes").select("id,carteira").in("id", c);
    if (error) throw new Error(`select clientes: ${error.message}`);
    for (const r of data ?? []) if (r.carteira) map.set(r.id, r.carteira);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 1) VENDEDORES  (/v2/employees + enriquecimento /v1/employees/{id} só no full)
// ---------------------------------------------------------------------------
async function loadVendedores(): Promise<Set<string>> {
  const list: any = await withRetry(() => rd.get("/v2/employees"));
  const arr: any[] = Array.isArray(list) ? list : [];
  const rows: any[] = [];
  for (const e of arr) {
    const id = e._id ?? e.id;
    let role: string | null = null, dept: string | null = null;
    if (FULL) {
      try {
        await sleep(120);
        const d: any = await withRetry(() => rd.get(`/v1/employees/${id}`));
        role = d?.role ?? null;
        dept = d?.departments?.[0]?.name ?? null;
      } catch { /* opcional */ }
    }
    rows.push({ id, nome: e.name ?? null, email: e.email ?? null, role, departamento: dept });
  }
  // no incremental não sobrescreve role/departamento já preenchidos (upsert só do básico)
  await upsert("vendedores", FULL ? rows : rows.map((r) => ({ id: r.id, nome: r.nome, email: r.email })));
  console.error(`[vendedores] ${rows.length} carregados${FULL ? " (com enriquecimento)" : ""}`);
  return new Set(rows.map((r) => r.id));
}

// ---------------------------------------------------------------------------
// 2) CLIENTES + ATENDIMENTOS
//    Enumera contatos atendidos pelos vendedores-alvo na janela; atribui por
//    current_wallet. No incremental, só chama /exists para contatos NOVOS.
//    Retorna os clientes EM ESCOPO ativos na janela (p/ carregar mensagens).
// ---------------------------------------------------------------------------
async function loadReports(vendIds: Set<string>) {
  // 2a) union dos contatos atendidos pelos vendedores-alvo na janela
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
    console.error(`[reports] ${t.wallet}: acumulado ${custDocs.size} contatos (janela ${START}..${END})`);
  }

  // carteiras já conhecidas -> pula /exists de quem já está na base
  const conhecidas = await carteirasConhecidas([...custDocs.keys()]);
  const novos = [...custDocs.keys()].filter((id) => !conhecidas.has(id));
  console.error(`[reports] ${custDocs.size} ativos | ${conhecidas.size} já conhecidos | ${novos.length} novos p/ /exists`);

  const clientes = new Map<string, any>();       // novos/atualizados a inserir
  const emEscopo = new Map<string, string>();     // id -> carteira (todos em escopo, p/ mensagens)
  const atends = new Map<string, any>();

  // já conhecidos: entram em escopo direto (sem /exists)
  for (const [id, cart] of conhecidas) {
    if (custDocs.has(id)) emEscopo.set(id, cart);
  }

  // novos: enriquece via /exists e mantém só current_wallet ∈ alvos
  let checked = 0;
  for (const id of novos) {
    checked++;
    if (checked % 50 === 0) console.error(`  /exists ${checked}/${novos.length} (em escopo: ${clientes.size})`);
    const { cust } = custDocs.get(id)!;
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
    emEscopo.set(id, wallet);
  }

  // atendimentos: só das conversas cujo cliente está em escopo
  for (const [id, { docs }] of custDocs) {
    if (!emEscopo.has(id)) continue;
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

  if (clientes.size) await upsert("clientes", [...clientes.values()]);
  if (atends.size) await upsert("atendimentos", [...atends.values()]);
  console.error(`[clientes] +${clientes.size} novos | [atendimentos] ${atends.size} | em escopo (ativos): ${emEscopo.size}`);
  return [...emEscopo.entries()].map(([id, carteira]) => ({ id, carteira }));
}

// ---------------------------------------------------------------------------
// 3) MENSAGENS  (/v2/messages/history, decriptado) — só dos clientes ativos
// ---------------------------------------------------------------------------
async function loadMensagens(clientes: { id: string; carteira: string }[]) {
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

// Modo "mensagens": backfill resumível do histórico. Não chama reports/exists —
// lê os clientes em escopo já no banco e baixa só o que falta (pula quem já tem
// mensagem). Serve para completar a carga histórica em execuções sucessivas.
async function backfillMensagens() {
  const todos = await clientesEmEscopoDoBanco();
  const jaTem = process.env.ETL_REFAZER === "1" ? new Set<string>() : await idsComMensagens();
  const faltantes = todos.filter((c) => !jaTem.has(c.id));
  const limite = Number(process.env.ETL_BATCH || 0); // 0 = sem limite
  const lote = limite > 0 ? faltantes.slice(0, limite) : faltantes;
  console.error(`[backfill] ${todos.length} clientes em escopo | ${jaTem.size} já com msg | ${faltantes.length} faltando | processando ${lote.length}`);
  await loadMensagens(lote);
}

async function main() {
  const t0 = Date.now();
  console.error(`ETL [${MODE}] — carteiras [${[...TARGET_WALLETS].join(", ")}] | janela ${START}..${END}\n`);
  if (process.env.ETL_LIMPAR === "1") await limpar();
  if (MODE === "mensagens") {
    await backfillMensagens();
  } else {
    const vendIds = await loadVendedores();
    const ativos = await loadReports(vendIds);
    const alvos = new Map(ativos.map((c) => [c.id, c] as const));
    if (!FULL) {
      // além das conversas com atendimento novo (reports), recarrega as
      // recentemente ativas no banco — pega respostas dentro de atendimentos antigos.
      const dias = Number(process.env.ETL_REFRESH_DAYS || 1);
      const recentes = await clientesParaRefrescar(dias);
      let add = 0;
      for (const r of recentes) if (!alvos.has(r.id)) { alvos.set(r.id, r); add++; }
      console.error(`[incremental] +${add} conversas (aguardando + ativas ${dias}d) → total a atualizar: ${alvos.size}`);
    }
    await loadMensagens([...alvos.values()]);
  }
  await validar();
  console.error(`\n✅ ETL [${MODE}] concluído em ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
}
main().catch((e) => { console.error("ERRO FATAL:", e); process.exit(1); });
