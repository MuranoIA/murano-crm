import "dotenv/config";
import { RdConversasClient } from "../lib/rdConversasClient";
import { decryptJwe } from "../lib/decryptMessages";
import { getSupabase } from "../lib/supabaseClient";
import { separaMidia, TIPOS_HISTORICO, SENT_BY_HISTORICO, CANAIS_HISTORICO } from "../lib/transform";

// ---------------------------------------------------------------------------
// Mede quantos cards estão HOJE na coluna errada por causa da mídia invisível.
//
// A etapa do funil é derivada de QUEM FALOU POR ÚLTIMO (seção 11.1). Como o ETL
// nunca pediu `type`, mensagem de cliente que era áudio/imagem não existia na base
// — então uma conversa em que a cliente respondeu por áudio aparece para o vendedor
// como "tentativa de contato" ou "ociosos", isto é, "ela não respondeu".
//
// O teste: amostra cards dessas duas colunas, busca o histórico com os parâmetros
// CORRETOS e olha quem mandou a última mensagem de verdade. Se foi a cliente, o
// card está na coluna errada e deveria estar em negociação.
//
// Só leitura — não grava nada. Imprime só contagens e tipos, nunca conteúdo.
// Uso: PROBE_N=30 npm run probe:funil
// ---------------------------------------------------------------------------

const rd = new RdConversasClient({
  token: process.env.RD_CONVERSAS_TOKEN!,
  baseUrl: process.env.RD_CONVERSAS_BASE_URL!,
});
const JWK = process.env.RD_CONVERSAS_PRIVATE_JWK!;
const sb = getSupabase();
const N = Number(process.env.PROBE_N ?? 30);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, a = 0): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if ((e?.status === 429 || e?.status === 500) && a < 12) { await sleep(3000 + 2500 * a); return withRetry(fn, a + 1); }
    throw e;
  }
}

async function ultimaReal(clienteId: string): Promise<any | null> {
  const h: any = await withRetry(() => rd.get("/v2/messages/history", {
    customer_id: clienteId, page: 1, limit: 100,
    type: TIPOS_HISTORICO, sent_by: SENT_BY_HISTORICO, channel: CANAIS_HISTORICO,
  }));
  if (typeof h?.messages !== "string" || !h.messages.length) return null;
  const dec: any = await decryptJwe(h.messages, JWK);
  if (!Array.isArray(dec) || !dec.length) return null;
  // ignora evento de sistema, igual à regra da vw_funil
  const reais = dec.filter((m: any) => {
    const c = String(m?.content ?? "").toLowerCase().trim();
    return !(c.startsWith(">") || c.startsWith("...") || c.includes("atendimento "));
  });
  if (!reais.length) return null;
  return reais.sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at))).pop();
}

async function main() {
  const { data, error } = await sb.from("vw_funil")
    .select("cliente_id,etapa,vendedor,ultima_atividade")
    .in("etapa", ["tentativa_contato", "ociosos"])
    .gte("ultima_atividade", new Date(Date.now() - 25 * 86400000).toISOString())
    .order("ultima_atividade", { ascending: false })
    .limit(600);
  if (error) throw new Error(error.message);
  const pop = (data ?? []).filter((r: any) => r.cliente_id && !String(r.cliente_id).includes(":"));
  // amostra espalhada pela população, não só os mais recentes
  const passo = Math.max(1, Math.floor(pop.length / N));
  const amostra = pop.filter((_: any, i: number) => i % passo === 0).slice(0, N);
  console.log(`população recente: ${pop.length} cards | amostra: ${amostra.length}\n`);

  let errados = 0, porMidia = 0, ok = 0, falhas = 0;
  for (const card of amostra as any[]) {
    try {
      const ult = await ultimaReal(card.cliente_id);
      await sleep(400);
      if (!ult) { falhas++; continue; }
      if (ult.sent_by === "customer") {
        errados++;
        const { midia } = separaMidia(ult.content);
        if (midia) porMidia++;
        console.log(`  ERRADO  ${card.etapa.padEnd(18)} ${card.vendedor.padEnd(9)} última é da CLIENTE em ${String(ult.created_at).slice(0, 16)} ${midia ? "(mídia)" : "(texto)"}`);
      } else ok++;
    } catch (e: any) { falhas++; }
  }

  const taxa = errados / Math.max(1, errados + ok);
  console.log(`\nRESULTADO da amostra (${errados + ok} conversas válidas, ${falhas} falhas):`);
  console.log(`  na coluna errada: ${errados}  (${(taxa * 100).toFixed(0)}%)`);
  console.log(`  dessas, por MÍDIA: ${porMidia}`);
  console.log(`  corretas: ${ok}`);
  console.log(`\nExtrapolando para os 2.954 cards das duas colunas dentro da janela:`);
  console.log(`  ~${Math.round(2954 * taxa)} cards possivelmente na coluna errada`);
  console.log(`  (amostra pequena — trate como ordem de grandeza, não como número exato)`);
}

main().catch((e) => { console.error("ERRO:", e?.message ?? e); process.exit(1); });
