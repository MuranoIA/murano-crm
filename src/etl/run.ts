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

// --- escopo: carteiras do funil. Fonte única = tabela carteira_config (murano-conversas).
// Adicionar vendedor = 1 linha lá + a tag "carteira <nome>" no painel; zero código aqui. ---
let TARGETS: { wallet: string; empId: string }[] = [];
let TARGET_WALLETS = new Set<string>(); // comparado com current_wallet (1ª palavra, lowercase)
async function loadCarteiraConfig() {
  const { data, error } = await sb.from("carteira_config").select("slug,employee_id").eq("ativo", true);
  if (error) throw new Error(`carteira_config: ${error.message}`);
  TARGETS = (data ?? [])
    .filter((r: any) => r.slug && r.employee_id)
    .map((r: any) => ({ wallet: String(r.slug), empId: String(r.employee_id) }));
  TARGET_WALLETS = new Set(TARGETS.map((t) => t.wallet));
  if (!TARGETS.length) throw new Error("carteira_config sem vendedores ativos");
  console.error(`[config] ${TARGETS.length} carteiras: ${[...TARGET_WALLETS].join(", ")}`);
}

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
type Candidato = { id: string; carteira: string; telefone: string | null; ultima_atividade: string | null; etapa?: string | null };

// ESTABILIDADE — orçamento rotativo.
// A API do RD sustenta ~48 chamadas/min (medido 26/07 em 3 fases independentes do
// mesmo run: 1,20s, 1,18s e 1,43s por chamada; concorrência NÃO fura esse teto —
// conc=3 deu a mesma taxa que conc=1). Logo, um run de 10 min cabe ~480 chamadas.
// Varrer tudo (1.048 conversas em 5d + disparos) dá ~34 min: o run não termina antes
// do próximo cron, o `concurrency group` cancela o seguinte e o sync efetivo cai pra
// 1x/hora. A correção é limitar o trabalho POR RUN e rodar sempre no horário.
//
// A fatia é escolhida por rodízio determinístico (sem estado): o relógio define o
// slot, então cada conversa é checada exatamente 1 vez a cada `ceil(total/orcamento)`
// runs. Previsível e sem acumular atraso.
function fatiaRotativa<T>(itens: T[], orcamento: number, intervaloMin: number): { fatia: T[]; slot: number; slots: number } {
  if (orcamento <= 0 || itens.length <= orcamento) return { fatia: itens, slot: 0, slots: 1 };
  const slots = Math.ceil(itens.length / orcamento);
  const slot = Math.floor(Date.now() / 60000 / Math.max(1, intervaloMin)) % slots;
  return { fatia: itens.slice(slot * orcamento, (slot + 1) * orcamento), slot, slots };
}

// Candidatos a re-checar: conversas ativas nos últimos `dias` (ou "aguardando").
// Traz telefone + ultima_atividade p/ a checagem barata (Opção 2).
async function clientesParaChecar(dias: number): Promise<Candidato[]> {
  const out: Candidato[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    // só conversas ativas na janela (data-limitada) — inclui as "aguardando" recentes
    // (a última msg do cliente entra em ultima_atividade). NÃO pega aguardando antigo,
    // senão o scan explode com todo cliente-por-último de qualquer idade.
    const cutoff = new Date(Date.now() - Math.max(0.05, dias) * 86400000).toISOString(); // aceita janela fracionada (horas) p/ o modo fast
    const q = sb.from("vw_funil").select("cliente_id,vendedor,telefone,ultima_atividade,etapa")
      .gte("ultima_atividade", cutoff);
    const { data, error } = await q.range(from, from + page - 1);
    if (error) throw new Error(`select vw_funil checar: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const cart = String(r.vendedor ?? "");
      // ignora cards sintéticos (venda:/winthor:) — só conversas reais têm histórico
      if (r.cliente_id && !String(r.cliente_id).includes(":") && TARGET_WALLETS.has(cart)) {
        out.push({ id: r.cliente_id, carteira: cart, telefone: r.telefone ?? null, ultima_atividade: r.ultima_atividade ?? null, etapa: r.etapa ?? null });
      }
    }
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

// Todos os cards da coluna NEGOCIAÇÃO (conversas ativas na janela de 24h). São poucos (~dezenas);
// no fast eles entram SEMPRE no tier A (checados todo sweep), mesmo que caiam fora da janela do
// scan rápido — assim mensagem nova do cliente numa negociação aparece em ~1-2 min sem clicar em ↻.
async function clientesNegociacao(): Promise<Candidato[]> {
  const { data, error } = await sb.from("vw_funil")
    .select("cliente_id,vendedor,telefone,ultima_atividade,etapa").eq("etapa", "negociacao").range(0, 999);
  if (error) throw new Error(`select vw_funil negociacao: ${error.message}`);
  const out: Candidato[] = [];
  for (const r of data ?? []) {
    const cart = String(r.vendedor ?? "");
    if (r.cliente_id && !String(r.cliente_id).includes(":") && TARGET_WALLETS.has(cart)) {
      out.push({ id: r.cliente_id, carteira: cart, telefone: r.telefone ?? null, ultima_atividade: r.ultima_atividade ?? null, etapa: "negociacao" });
    }
  }
  return out;
}

// OPÇÃO 2 — checagem BARATA: /v2/contacts/{phone}/exists devolve a última mensagem em
// texto puro (last_message_data), sem decriptar. Compara com o que o banco tem; só quem
// tem mensagem NOVA entra no fetch caro (/messages/history + decrypt). Permite varrer
// uma janela larga por pouco custo.
// `conc` = nº de checagens /exists simultâneas. Incremental usa 1 (sequencial, seguro);
// o modo fast usa mais (ETL_FAST_CONC) p/ o sweep cair de ~3min pra ~1min. O /exists do RD
// é lento (~2-3s cada), então algumas em paralelo aproveitam a latência sem estourar rate.
async function checarMudaram(candidatos: Candidato[], conc = 1): Promise<{ id: string; carteira: string }[]> {
  const mudaram: { id: string; carteira: string }[] = [];
  let checked = 0, semTel = 0, idx = 0;
  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= candidatos.length) return;
      const c = candidatos[i];
      checked++;
      if (checked % 150 === 0) console.error(`[checar] ${checked}/${candidatos.length} (${mudaram.length} c/ msg nova)`);
      if (!c.telefone) { semTel++; mudaram.push({ id: c.id, carteira: c.carteira }); continue; } // sem tel -> fetch p/ garantir
      await sleep(Number(process.env.ETL_SCAN_SLEEP ?? 150)); // throttle configurável (reserva cota do RD p/ o real-time do board)
      try {
        const ex: any = await withRetry(() => rd.get(`/v2/contacts/${c.telefone}/exists`));
        const lastRd = ex?.data?.last_message_data?.created_at;
        const dbLast = c.ultima_atividade ? new Date(c.ultima_atividade).getTime() : 0;
        // +2s de folga p/ diferença de precisão entre RD e o que gravamos
        if (lastRd && new Date(lastRd).getTime() > dbLast + 2000) mudaram.push({ id: c.id, carteira: c.carteira });
      } catch { mudaram.push({ id: c.id, carteira: c.carteira }); } // erro -> fetch p/ garantir
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, conc) }, () => worker()));
  console.error(`[checar] ${candidatos.length} checados via /exists (conc=${conc}) | ${mudaram.length} c/ msg nova | ${semTel} sem telefone`);
  return mudaram;
}

// Clientes com atendimento ABERTO (fechado=false), independente de quando o
// protocolo foi criado. Existe pra cobrir a lacuna do /v4/reports: ele filtra
// por created_at (abertura), então um protocolo aberto há meses e nunca
// fechado NUNCA mais reaparece na janela do incremental, mesmo com mensagens
// novas todo dia — só re-checando "abertos" diretamente pega esse caso
// (achado real: Samara Soares Brito, atendimento aberto desde 14/05, venda
// fechada hoje ficou invisível pro incremental até esse fix).
async function clientesComAtendimentoAberto(): Promise<{ id: string; carteira: string }[]> {
  const out: { id: string; carteira: string }[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await sb
      .from("atendimentos")
      .select("cliente_id, clientes!inner(carteira)")
      .eq("fechado", false)
      .range(from, from + page - 1);
    if (error) throw new Error(`select atendimentos abertos: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows as any[]) {
      const cart = String(r.clientes?.carteira ?? "");
      if (r.cliente_id && TARGET_WALLETS.has(cart)) out.push({ id: r.cliente_id, carteira: cart });
    }
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

// Clientes que receberam template PELO BOARD nos últimos `dias` (disparos_template).
// Cobre a lacuna: uma conversa parada há mais que a janela da varredura recebe um
// template disparado no board; o disparo é registrado na hora, mas a MENSAGEM só entra
// em `mensagens` quando o ETL re-busca aquele cliente. Como ele está "parado" fora da
// varredura, nunca seria re-buscado. Forçando por disparo, o template aparece rápido.
// Devolve os disparos separados em dois grupos, porque o custo de cada um é diferente:
//   `frescos`  — disparo há < `frescoH` horas: fetch DIRETO (caro), pra garantir que o
//                template entre em `mensagens` mesmo se o sync instantâneo do envio falhar
//                (ex: 429). São poucos.
//   `antigos`  — disparo mais velho: só interessa saber se o cliente RESPONDEU, e isso a
//                checagem BARATA (/exists) resolve. Antes todos iam pro fetch caro, o que
//                inflava o run (medido: 443 fetches inúteis por run, ~20 min).
// Medido em 26/07: template enviado pela API NÃO aparece em `last_message_data`, então o
// /exists não dá falso positivo por causa do próprio template — só acusa resposta real.
async function clientesComDisparoRecente(
  dias: number,
  frescoH = 6,
): Promise<{ frescos: { id: string; carteira: string }[]; antigos: Candidato[] }> {
  const cutoff = new Date(Date.now() - Math.max(0.002, dias) * 86400000).toISOString(); // aceita janela em minutos (modo fast)
  const cutFresco = Date.now() - frescoH * 3600000;
  const maisRecente = new Map<string, { carteira: string; em: number }>();
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await sb
      .from("disparos_template").select("cliente_id,vendedor,criada_em")
      .gte("criada_em", cutoff).range(from, from + page - 1);
    if (error) throw new Error(`select disparos_template: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) {
      const cart = String(r.vendedor ?? "");
      if (!r.cliente_id || !TARGET_WALLETS.has(cart)) continue;
      const em = new Date(r.criada_em).getTime();
      const atual = maisRecente.get(r.cliente_id);
      if (!atual || em > atual.em) maisRecente.set(r.cliente_id, { carteira: cart, em });
    }
    if (rows.length < page) break;
    from += page;
  }

  const frescos: { id: string; carteira: string }[] = [];
  const idsAntigos: string[] = [];
  const cartAntigos = new Map<string, string>();
  for (const [id, v] of maisRecente) {
    if (v.em >= cutFresco) frescos.push({ id, carteira: v.carteira });
    else { idsAntigos.push(id); cartAntigos.set(id, v.carteira); }
  }

  // enriquece os antigos com telefone/ultima_atividade (o que a checagem barata precisa)
  const antigos: Candidato[] = [];
  for (const lote of chunks(idsAntigos, 300)) {
    const { data, error } = await sb
      .from("vw_funil").select("cliente_id,telefone,ultima_atividade").in("cliente_id", lote);
    if (error) throw new Error(`select vw_funil disparos: ${error.message}`);
    for (const r of data ?? []) {
      antigos.push({
        id: r.cliente_id,
        carteira: cartAntigos.get(r.cliente_id) ?? "",
        telefone: r.telefone ?? null,
        ultima_atividade: r.ultima_atividade ?? null,
      });
    }
  }
  return { frescos, antigos };
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

    // slug = 1ª palavra do current_wallet, minúscula. Os ISR já são 1 palavra
    // ("Romulo"→"romulo"); a Milene vem "Milene Pamplona"→"milene". Mantém o slug
    // consistente com o lado de vendas (vendedor_slug), que também usa o 1º nome.
    const wallet = String(data.current_wallet ?? "").trim().toLowerCase().split(/\s+/)[0];
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

  // ---------------------------------------------------------------------------
  // ECONOMIA DE CHAMADAS (a que realmente conta): o /v4/reports JÁ devolve
  // total_send_messages/total_receive_messages, e nós já gravamos isso em
  // `atendimentos`. Comparando com o que está no banco dá pra saber quem teve
  // mensagem nova SEM gastar nenhuma chamada extra — o dado veio de graça.
  // Antes: todos os ~234 "ativos" iam pro fetch caro todo run (~6,5 min @48 req/min).
  // IMPORTANTE: comparar ANTES do upsert, senão sobrescreve o valor antigo.
  const diffOn = (process.env.ETL_REPORTS_DIFF ?? "1") !== "0";
  let semMudanca = 0;
  const precisaFetch = new Set<string>(clientes.keys()); // cliente novo -> sempre busca
  if (diffOn) {
    const antes = new Map<string, string>();
    for (const lote of chunks([...atends.keys()], 300)) {
      const { data, error } = await sb
        .from("atendimentos").select("id,total_enviadas,total_recebidas,fechado").in("id", lote);
      if (error) throw new Error(`select atendimentos diff: ${error.message}`);
      for (const r of data ?? []) antes.set(r.id, `${r.total_enviadas}|${r.total_recebidas}|${r.fechado}`);
    }
    for (const a of atends.values()) {
      const sig = `${a.total_enviadas}|${a.total_recebidas}|${a.fechado}`;
      // atendimento novo (sem registro) ou contadores diferentes -> tem coisa nova
      if (antes.get(a.id) !== sig) precisaFetch.add(a.cliente_id);
    }
    for (const id of emEscopo.keys()) if (!precisaFetch.has(id)) semMudanca++;
  }

  if (clientes.size) await upsert("clientes", [...clientes.values()]);
  if (atends.size) await upsert("atendimentos", [...atends.values()]);

  const saida = [...emEscopo.entries()]
    .filter(([id]) => !diffOn || precisaFetch.has(id))
    .map(([id, carteira]) => ({ id, carteira }));
  console.error(
    `[clientes] +${clientes.size} novos | [atendimentos] ${atends.size} | ` +
    `em escopo (ativos): ${emEscopo.size}` +
    (diffOn ? ` → ${saida.length} c/ contador alterado (${semMudanca} iguais, fetch evitado)` : "")
  );
  return saida;
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

// MODO FAST (quase tempo real): varredura BARATA (/exists) das conversas QUENTES, com
// PRIORIDADE POR ATIVIDADE RECENTE (quão pouco tempo faz desde a última msg = ultima_atividade).
// A cota do RD é escassa, então concentramos as checagens em quem tem msg provável AGORA:
//   - tier A (última msg <= ETL_FAST_A_MIN min, padrão 30): checado em TODO sweep -> ~1-2 min de frescor;
//   - tier B (<= ETL_FAST_B_HORAS h, padrão 3): a cada ETL_FAST_B_EVERY sweeps (padrão 2);
//   - tier C (o resto da janela, até ETL_FAST_HORAS): a cada ETL_FAST_C_EVERY sweeps (padrão 4).
// O 1º sweep de cada run é COMPLETO (baseline). Disparos recentes sempre entram (backup do item 3,
// pois o /exists não vê template de saída). NÃO chama reports/vendedores (contato novo = incremental).
async function fastSweep(n: number): Promise<void> {
  const horas = Number(process.env.ETL_FAST_HORAS ?? 18);
  const aMin = Number(process.env.ETL_FAST_A_MIN ?? 30);
  const bHoras = Number(process.env.ETL_FAST_B_HORAS ?? 3);
  const bEvery = Math.max(1, Number(process.env.ETL_FAST_B_EVERY ?? 2));
  const cEvery = Math.max(1, Number(process.env.ETL_FAST_C_EVERY ?? 4));
  const todos = await clientesParaChecar(horas / 24);
  const negoc = await clientesNegociacao(); // conversas ativas (janela 24h) — sempre no tier A
  const porId = new Map<string, Candidato>();
  for (const c of todos) porId.set(c.id, c);
  for (const c of negoc) porId.set(c.id, c); // garante etapa=negociacao (mesmo fora da janela do scan)
  const universo = [...porId.values()];
  const agora = Date.now();
  const idadeMin = (c: Candidato) => c.ultima_atividade ? (agora - new Date(c.ultima_atividade).getTime()) / 60000 : Infinity;
  // negociação SEMPRE todo sweep; 1º sweep completo; depois cada tier na sua cadência (por recência)
  let nA = 0, nB = 0, nC = 0;
  const candidatos = universo.filter((c) => {
    if (c.etapa === "negociacao") { nA++; return true; }                    // negociação: todo sweep
    const min = idadeMin(c);
    if (min <= aMin) { nA++; return true; }                                 // tier A: todo sweep
    if (min <= bHoras * 60) { nB++; return n === 1 || n % bEvery === 0; }    // tier B
    nC++; return n === 1 || n % cEvery === 0;                                // tier C
  });
  const mudaram = await checarMudaram(candidatos, Number(process.env.ETL_FAST_CONC ?? 4));
  const alvos = new Map<string, { id: string; carteira: string }>();
  for (const m of mudaram) alvos.set(m.id, m);
  const { frescos: disp } = await clientesComDisparoRecente(
    Number(process.env.ETL_FAST_DISPARO_MIN ?? 5) / 1440, 24,
  );
  for (const d of disp) if (!alvos.has(d.id)) alvos.set(d.id, d);
  console.error(`[fast#${n}] quentes ${universo.length} (A${nA}/B${nB}/C${nC}, negoc ${negoc.length}) -> checados ${candidatos.length} | ${mudaram.length} c/ msg nova | ${disp.length} disparos | fetch ${alvos.size}`);
  if (alvos.size) await loadMensagens([...alvos.values()]);
}

async function main() {
  const t0 = Date.now();
  await loadCarteiraConfig();
  console.error(`ETL [${MODE}] — carteiras [${[...TARGET_WALLETS].join(", ")}] | janela ${START}..${END}\n`);
  if (process.env.ETL_LIMPAR === "1") await limpar();
  if (MODE === "fast") {
    // loop interno: um sweep, dorme ETL_FAST_SLEEP s, repete por ETL_FAST_LOOP_MIN min
    // (0 = sweep único). Assim um run do Actions cobre vários minutos com ~1 sweep/min.
    const loopMin = Number(process.env.ETL_FAST_LOOP_MIN ?? 0);
    const sleepS = Number(process.env.ETL_FAST_SLEEP ?? 15);
    const until = t0 + loopMin * 60000;
    let n = 0;
    do {
      n++;
      try { await fastSweep(n); } catch (e: any) { console.error(`[fast] erro no sweep #${n}:`, e?.message ?? e); }
      if (loopMin <= 0 || Date.now() >= until) break;
      await sleep(sleepS * 1000);
    } while (Date.now() < until);
    console.error(`\n✅ ETL [fast] — ${n} sweeps em ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
    return;
  }
  if (MODE === "mensagens") {
    await backfillMensagens();
  } else {
    const vendIds = await loadVendedores();
    const ativos = await loadReports(vendIds);
    const alvos = new Map(ativos.map((c) => [c.id, c] as const));
    if (!FULL) {
      // OPÇÃO 2: varre uma janela LARGA (ETL_SCAN_DAYS, padrão 30d) com a checagem
      // BARATA (/exists, sem decriptar) e só faz o fetch caro das que têm msg nova.
      // Assim pega mensagem nova em qualquer conversa recente sem pagar o custo de
      // baixar+decriptar todas — viável com o repo público (Actions grátis).
      // ETL_SCAN_CONC: checagens /exists simultâneas. NÃO acelera além do teto de ~48
      // req/min do RD (medido: conc=3 deu a mesma taxa que conc=1) — serve só p/ aproveitar
      // latência. Mantido baixo p/ não competir com os envios do board (o fast já viu
      // conc=4 gerar 429 no envio de template).
      const conc = Number(process.env.ETL_SCAN_CONC ?? 2);
      const scanDias = Number(process.env.ETL_SCAN_DAYS ?? 30);
      // orçamento de checagens do run (ver `fatiaRotativa`). 0 = sem limite (comportamento antigo)
      const orcamento = Number(process.env.ETL_CALL_BUDGET ?? 0);
      const intervalo = Number(process.env.ETL_CRON_MIN ?? 10);
      const todos = (await clientesParaChecar(scanDias))
        .filter((c) => !alvos.has(c.id))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // ordem estável p/ o rodízio
      // reserva ~30% do orçamento pros disparos, senão o scan consome tudo e eles
      // nunca seriam checados (o rodízio deles nunca avançaria).
      const orcScan = orcamento > 0 ? Math.max(1, Math.round(orcamento * 0.7)) : 0;
      const { fatia: candidatos, slot, slots } = fatiaRotativa(todos, orcScan, intervalo);
      const jaChecados = new Set(candidatos.map((c) => c.id)); // p/ não re-checar nos disparos
      const mudaram = await checarMudaram(candidatos, conc);
      let add = 0;
      for (const m of mudaram) if (!alvos.has(m.id)) { alvos.set(m.id, m); add++; }
      console.error(
        `[incremental] ${todos.length} na janela ${scanDias}d → checadas ${candidatos.length}` +
        (slots > 1 ? ` (fatia ${slot + 1}/${slots}, cobertura completa a cada ${slots * intervalo} min)` : "") +
        ` → +${add} c/ msg nova → total: ${alvos.size}`
      );

      // clientes com template disparado pelo board nos últimos N dias — força re-sync
      // mesmo que estejam "parados" fora da varredura (senão o template nunca aparece).
      // Frescos (< ETL_DISPARO_FRESCO_H) vão direto pro fetch; os antigos passam pela
      // checagem barata primeiro — só quem RESPONDEU custa fetch (antes iam todos).
      const disparoDias = Number(process.env.ETL_DISPARO_DAYS ?? 5);
      const frescoH = Number(process.env.ETL_DISPARO_FRESCO_H ?? 6);
      const { frescos, antigos } = await clientesComDisparoRecente(disparoDias, frescoH);
      let addD = 0;
      for (const d of frescos) if (!alvos.has(d.id)) { alvos.set(d.id, d); addD++; }
      // pula quem já entrou no fetch (alvos) e quem o scan JÁ checou nesta run
      const restantes = antigos
        .filter((c) => !alvos.has(c.id) && !jaChecados.has(c.id))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // o que sobrou do orçamento (o scan já pegou ~70%). Sem orçamento configurado,
      // sobra=0 significa "sem limite" dentro de fatiaRotativa (comportamento antigo).
      const sobra = orcamento > 0 ? Math.max(1, orcamento - candidatos.length) : 0;
      const pendentes = fatiaRotativa(restantes, sobra, intervalo).fatia;
      const respAntigos = pendentes.length ? await checarMudaram(pendentes, conc) : [];
      let addR = 0;
      for (const m of respAntigos) if (!alvos.has(m.id)) { alvos.set(m.id, m); addR++; }
      console.error(
        `[disparos] ≤${disparoDias}d: ${frescos.length} frescos(<${frescoH}h) → +${addD} | ` +
        `${pendentes.length} antigos checados → +${addR} c/ resposta | total: ${alvos.size}`
      );
    }
    if (FULL) {
      // só no full (manual/raro): reprocessa TODO atendimento aberto, sem limite de
      // dias. É caro (~1.000 clientes hoje, 61% da base) — por isso NÃO roda no
      // incremental de 20min, senão o custo por ciclo ia de ~150-250 pra 1.000+.
      // Cobre o caso "conversa parada X dias, protocolo nunca fechado, reabriu hoje"
      // (achado real: Samara Soares Brito) que o /v4/reports não pega de jeito
      // nenhum, nem com janela maior, porque ele filtra por created_at do protocolo.
      const abertos = await clientesComAtendimentoAberto();
      let addAbertos = 0;
      for (const a of abertos) if (!alvos.has(a.id)) { alvos.set(a.id, a); addAbertos++; }
      console.error(`[atendimentos abertos] +${addAbertos} conversas → total a atualizar: ${alvos.size}`);
    }
    await loadMensagens([...alvos.values()]);
  }
  await validar();
  console.error(`\n✅ ETL [${MODE}] concluído em ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
}
main().catch((e) => { console.error("ERRO FATAL:", e); process.exit(1); });
