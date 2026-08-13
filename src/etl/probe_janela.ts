import "dotenv/config";
import { RdConversasClient } from "../lib/rdConversasClient";
import { decryptJwe } from "../lib/decryptMessages";
import { getSupabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Mede a FRONTEIRA do histórico servido pelo /v2/messages/history.
//
// O probe_historico mostrou, em 3 conversas, que a API devolve só o passado
// recente: mensagens que o ETL já capturou (e estão no Supabase) não voltam
// mais. Falta separar duas explicações que preveem coisas MUITO diferentes:
//
//   (a) JANELA DE TEMPO — a API guarda os últimos N dias. Então todas as
//       conversas param de devolver na MESMA data de calendário, e a fronteira
//       anda um dia por dia. Prazo real para recuperar dado.
//   (b) LIMITE POR CONVERSA — a API devolve as últimas N mensagens, ou só o
//       atendimento atual. Então cada conversa para numa data diferente, ligada
//       ao volume dela, e não há prazo — só truncagem.
//
// O teste: pegar conversas PEQUENAS (paginam até o fim rápido) cujo histórico
// no nosso banco começa bem antes da fronteira suspeita, paginar cada uma até
// a página vazia e anotar onde parou. Datas agrupadas => (a). Datas espalhadas
// => (b).
//
// Só leitura. Imprime apenas metadados.
// Uso: PROBE_IDS=id1,id2,... npm run probe:janela
// ---------------------------------------------------------------------------

const rd = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const JWK = process.env.RD_CONVERSAS_PRIVATE_JWK!;
const sb = getSupabase();

const IDS = String(process.env.PROBE_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_PAGES = Number(process.env.PROBE_MAX_PAGES ?? 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// paciente de propósito: a cota do RD é dividida com o ETL agendado e com os
// envios do board, então 429 aqui é fila, não erro. Teto ~5 min por chamada.
async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if ((e?.status === 429 || e?.status === 500) && a < 14) { await sleep(3000 + 2500 * a); return withRetry(fn, a + 1); }
    throw e;
  }
}

type Msg = { sent_by?: string; content?: string; created_at?: string };

async function pagina(id: string, page: number): Promise<Msg[]> {
  const env: any = await withRetry(() => rd.get("/v2/messages/history", { customer_id: id, page, limit: 100 }));
  if (typeof env?.messages !== "string" || !env.messages.length) return [];
  try {
    const dec: any = await decryptJwe(env.messages, JWK);
    return Array.isArray(dec) ? (dec as Msg[]) : [];
  } catch { return []; }
}

async function main() {
  if (!IDS.length) throw new Error("defina PROBE_IDS (separados por vírgula)");
  console.log(`hoje = ${new Date().toISOString().slice(0, 10)} | ${IDS.length} conversas\n`);
  console.log("conversa                  | banco: 1ª..última (n) | API: 1ª..última (n) | terminou? | dias");
  console.log("-".repeat(112));

  const fronteiras: string[] = [];
  let deficitTotal = 0, comDeficit = 0;
  for (const id of IDS) {
    const { data: nossas } = await sb.from("mensagens")
      .select("criada_em").eq("cliente_id", id).order("criada_em");
    const bDe = nossas?.[0]?.criada_em?.slice(0, 10) ?? "-";
    const bAte = nossas?.[nossas.length - 1]?.criada_em?.slice(0, 10) ?? "-";
    // guardado p/ a comparação justa: só conta o que temos DENTRO do trecho que a
    // API ainda serve. Fora dele o banco naturalmente tem mais (ele acumula).
    const nossasDatas = (nossas ?? []).map((r: any) => String(r.criada_em));

    const todas = new Map<string, Msg>();
    let terminou = false;
    try {
      for (let p = 1; p <= MAX_PAGES; p++) {
        const msgs = await pagina(id, p);
        const antes = todas.size;
        for (const m of msgs) todas.set(`${m.created_at}|${m.content ?? ""}`, m);
        if (!msgs.length || todas.size === antes) { terminou = true; break; }
        await sleep(1300);
      }
    } catch (e: any) {
      // uma conversa que falha não invalida a amostra — registra e segue
      console.log(`${id} | ${bDe}..${bAte} (${String(nossas?.length ?? 0).padStart(3)}) | FALHOU: ${e?.status ?? e?.message ?? e}`);
      continue;
    }
    const datas = ([...todas.values()].map((m) => m.created_at).filter(Boolean) as string[]).sort();
    const aDe = datas[0]?.slice(0, 10) ?? "-";
    const aAte = datas[datas.length - 1]?.slice(0, 10) ?? "-";
    if (terminou && aDe !== "-") fronteiras.push(aDe);
    // DÉFICIT: quantas a API oferece HOJE que não estão no banco, contando só o
    // trecho que a API ainda cobre. É exatamente o que a paginação recuperaria.
    const corte = datas[0] ?? "";
    const temosNoTrecho = nossasDatas.filter((d) => d >= corte).length;
    const deficit = Math.max(0, todas.size - temosNoTrecho);
    deficitTotal += deficit;
    if (deficit > 0) comDeficit++;
    console.log(
      `${id} | ${bDe}..${bAte} (${String(nossas?.length ?? 0).padStart(3)}) | ` +
      `${aDe}..${aAte} (${String(todas.size).padStart(3)}) | ${terminou ? "fim " : "TETO"} | ` +
      `no trecho: temos ${String(temosNoTrecho).padStart(3)} / API ${String(todas.size).padStart(3)}` +
      (deficit > 0 ? `  <-- FALTAM ${deficit}` : "")
    );
  }

  console.log(`\nDÉFICIT: ${comDeficit}/${IDS.length} conversas com mensagem faltando | ${deficitTotal} mensagens recuperáveis nesta amostra`);

  console.log("\nFRONTEIRAS (só as que chegaram ao fim do histórico):");
  const ord = fronteiras.slice().sort();
  console.log(`  ${ord.join("  ")}`);
  if (ord.length >= 2) {
    const span = (new Date(ord[ord.length - 1]).getTime() - new Date(ord[0]).getTime()) / 86400000;
    console.log(`  intervalo entre a mais antiga e a mais nova: ${span} dias`);
    console.log(span <= 3
      ? "  => AGRUPADAS: é JANELA DE TEMPO. A fronteira anda; existe prazo."
      : "  => ESPALHADAS: NÃO é janela de tempo — o corte é por conversa/volume.");
  }
}

main().catch((e) => { console.error("ERRO:", e?.message ?? e); process.exit(1); });
