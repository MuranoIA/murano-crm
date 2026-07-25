import "dotenv/config";
import { RdConversasClient } from "../lib/rdConversasClient";
import { decryptJwe } from "../lib/decryptMessages";
import { getSupabase } from "../lib/supabaseClient";
import { tipoMensagem, idMensagem, ts } from "../lib/transform";

// =============================================================================
// BACKFILL POR CARTEIRA — captura TODAS as conversas de um vendedor, inclusive
// as antigas (protocolo > 90 dias, que o /v4/reports não devolve).
// Estratégia: itera os telefones da carteira WinThor do vendedor (wth_carteira
// pelo rca_num da carteira_config) → /v2/contacts/{phone}/exists devolve o
// customer_id (_id) mesmo de conversa antiga → baixa /v2/messages/history.
// Uso: npx ts-node src/etl/backfill_carteira.ts <slug>   (ex: milene)
// Env: ETL_SKIP_COM_MSG=1 pula quem já tem mensagem (resumível); ETL_BATCH=N limita.
// =============================================================================

const SLUG = (process.argv[2] || process.env.ETL_CARTEIRA || "").trim().toLowerCase();
const rd = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const sb = getSupabase();
const JWK = process.env.RD_CONVERSAS_PRIVATE_JWK!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if ((e?.status === 429 || e?.status === 500) && a < 8) { await sleep(2500 * (a + 1)); return withRetry(fn, a + 1); } throw e; }
}
async function upsert(table: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict: "id" });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
}
// WinThor às vezes salva o telefone SEM o DDD (Belém=91) — 8/9 dígitos dão 404 no
// /exists. Prefixar "91" recupera (confirmado ao vivo). >=10 dígitos ficam como estão.
function normalizarTelefone(t: string): string {
  const d = String(t).replace(/\D/g, "");
  return d.length < 10 ? "91" + d : d;
}

async function main() {
  if (!SLUG) throw new Error("informe o slug: npx ts-node src/etl/backfill_carteira.ts <slug>");
  const t0 = Date.now();

  // rca_num da carteira
  const { data: cfg, error: eCfg } = await sb.from("carteira_config").select("rca_num,employee_id").eq("slug", SLUG).single();
  if (eCfg || !cfg?.rca_num) throw new Error(`carteira_config sem rca_num p/ '${SLUG}'`);
  const rca = cfg.rca_num as number;

  // telefones da carteira WinThor
  const phones: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("wth_carteira").select("telefone")
      .eq("rca_num", rca).eq("ativo", true).not("telefone", "is", null)
      .range(from, from + 999);
    if (error) throw new Error(`wth_carteira: ${error.message}`);
    const rows = data ?? [];
    for (const r of rows) if (r.telefone) phones.push(String(r.telefone));
    if (rows.length < 1000) break;
  }
  const uniq = [...new Set(phones)];
  console.error(`[backfill ${SLUG}] rca=${rca} | ${uniq.length} telefones na carteira WinThor`);

  // opcional: pular quem já tem mensagem (resumível)
  let jaTem = new Set<string>(); // telefones (últimos 8) já com conversa carregada
  if (process.env.ETL_SKIP_COM_MSG === "1") {
    const { data } = await sb.from("clientes").select("telefone").eq("carteira", SLUG);
    for (const r of data ?? []) if (r.telefone) jaTem.add(String(r.telefone).replace(/\D/g, "").slice(-8));
  }

  const limite = Number(process.env.ETL_BATCH || 0);
  const lista = limite > 0 ? uniq.slice(0, limite) : uniq;

  let checked = 0, naCarteira = 0, comMsg = 0, semContato = 0, foraCarteira = 0, erros = 0, totalMsgs = 0;
  for (const phone of lista) {
    checked++;
    if (checked % 50 === 0) console.error(`[backfill] ${checked}/${lista.length} | na carteira: ${naCarteira} | msgs: ${totalMsgs}`);
    const tel = normalizarTelefone(phone);
    if (process.env.ETL_SKIP_COM_MSG === "1" && jaTem.has(tel.slice(-8))) { naCarteira++; continue; }
    await sleep(180);
    let data: any = null;
    try {
      const ex: any = await withRetry(() => rd.get(`/v2/contacts/${tel}/exists`));
      data = ex?.data ?? null;
    } catch { erros++; continue; }
    if (!data?._id) { semContato++; continue; } // sem contato no RD Conversas -> fica prospecção
    const wallet = String(data.current_wallet ?? "").trim().toLowerCase().split(/\s+/)[0];
    if (wallet !== SLUG) { foraCarteira++; continue; }
    naCarteira++;

    const id = String(data._id);
    await upsert("clientes", [{
      id,
      nome_completo: data.full_name ?? null,
      telefone: data.cel_phone ?? tel,
      cpf: data.cpf ?? null,
      email: data.email ?? null,
      carteira: SLUG,
      employee_id: null,
      canal: data.channel ?? null,
      tags: data.tags ?? [],
    }]);

    // histórico (página 1 = 50 mais recentes; suficiente p/ o funil saber a conversa e a etapa)
    await sleep(220);
    try {
      const h: any = await withRetry(() => rd.get("/v2/messages/history", { customer_id: id, page: 1, limit: 50 }));
      if (typeof h?.messages === "string" && h.messages.length) {
        const dec: any = await decryptJwe(h.messages, JWK);
        const msgs: any[] = Array.isArray(dec) ? dec : [];
        const seen = new Set<string>();
        const rows: any[] = [];
        for (const m of msgs) {
          const mid = idMensagem(id, m.created_at, m.content ?? "");
          if (seen.has(mid)) continue;
          seen.add(mid);
          rows.push({
            id: mid, cliente_id: id, vendedor_carteira: SLUG,
            enviada_por: m.sent_by ?? null, tipo: tipoMensagem(m), conteudo: m.content ?? null,
            is_reply: m.is_reply ?? null, status: m.status ?? null, criada_em: ts(m.created_at),
          });
        }
        if (rows.length) { await upsert("mensagens", rows); totalMsgs += rows.length; comMsg++; }
      }
    } catch { erros++; }
  }

  console.error(`\n[backfill ${SLUG}] concluído em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.error(`  checados=${checked} | na carteira RD=${naCarteira} | c/ mensagens=${comMsg} | sem contato RD=${semContato} | fora carteira=${foraCarteira} | erros=${erros} | msgs=${totalMsgs}`);
}
main().catch((e) => { console.error("ERRO FATAL:", e); process.exit(1); });
