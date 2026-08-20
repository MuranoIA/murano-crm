import "dotenv/config";
import { getSupabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Procura DE ONDE baixar os arquivos de mídia do RD Conversas.
//
// O /v2/messages/history devolve, para cada mídia, um objeto com `file_path`
// relativo (`medias-whatsapp/…oga` no que o cliente manda, `medias/…jpg` no que o
// vendedor manda) — mas a documentação oficial não tem NENHUM endpoint de download
// (49 entradas, nenhuma de mídia/arquivo/storage). O formato do caminho parece
// chave de bucket. Este script testa hosts e prefixos plausíveis, com e sem token.
//
// Só leitura. Não imprime conteúdo de mensagem — só status, tipo e tamanho.
// Uso: npm run probe:midia   (pega um áudio de cliente já gravado na base)
// ---------------------------------------------------------------------------

const TOKEN = String(process.env.RD_CONVERSAS_TOKEN ?? "").replace(/[^\x21-\x7E]/g, "");
const sb = getSupabase();

const HOSTS = [
  "https://api.tallos.com.br",
  "https://kong.tallos.com.br:18000/megasac-api",
  "https://kong.tallos.com.br:18000",
  "https://cdn.tallos.com.br",
  "https://media.tallos.com.br",
  "https://files.tallos.com.br",
];
// prefixos a testar nos hosts de API (o caminho já vem com `medias…/`)
const PREFIXOS = ["", "/v2", "/v1", "/files", "/v2/files", "/download", "/v2/medias", "/media", "/static", "/public"];
// buckets de object storage: o caminho parece chave de bucket
const BUCKETS = ["tallos", "tallos-medias", "tallos-prod", "tallos-files", "megasac", "megasac-medias"];
const REGIOES = ["s3.amazonaws.com", "s3.us-east-1.amazonaws.com", "s3.sa-east-1.amazonaws.com"];

async function tenta(url: string, comToken: boolean): Promise<string | null> {
  try {
    const r = await fetch(url, {
      redirect: "manual",
      headers: comToken ? { Authorization: `Bearer ${TOKEN}` } : {},
    });
    const tipo = r.headers.get("content-type") ?? "";
    const tam = r.headers.get("content-length") ?? "?";
    const loc = r.headers.get("location");
    // 2xx com content-type binário = achou. 3xx = pista (URL assinada?).
    // ACHOU DE VERDADE = 2xx com content-type binário. 200 text/html é o shell do SPA,
    // que responde qualquer caminho — foi o falso positivo da primeira rodada.
    const binario = r.status < 300 && !tipo.includes("text/html") && !tipo.includes("application/json");
    const marca = binario ? "ACHOU" : r.status === 401 || r.status === 403 ? "AUTH?" : "     ";
    const extra = loc ? ` -> ${loc.slice(0, 70)}` : "";
    return `${marca} ${String(r.status).padEnd(3)} ${comToken ? "auth" : "anon"} ${tipo.slice(0, 24).padEnd(24)} ${String(tam).padStart(8)}  ${url.slice(0, 72)}${extra}`;
  } catch (e: any) {
    return `      DNS ${comToken ? "auth" : "anon"} ${"(host não resolve)".padEnd(24)} ${"".padStart(8)}  ${url.slice(0, 72)}`;
  }
}

async function main() {
  const { data, error } = await sb
    .from("mensagens").select("midia").not("midia", "is", null).eq("enviada_por", "customer").limit(1);
  if (error) throw new Error(error.message);
  const midia: any = data?.[0]?.midia;
  if (!midia?.file_path) throw new Error("nenhuma mensagem de mídia na base — rode o ETL primeiro");
  const caminho = String(midia.file_path);
  const nome = String(midia.file_name ?? "");
  console.log(`arquivo alvo: …${caminho.slice(-46)}\n`);
  console.log("    sts  auth  content-type                    bytes  url");
  console.log("-".repeat(112));

  const alvos: string[] = [];
  for (const h of HOSTS) for (const p of PREFIXOS) alvos.push(`${h}${p}/${caminho}`);
  for (const b of BUCKETS) for (const reg of REGIOES) alvos.push(`https://${b}.${reg}/${caminho}`);
  if (nome) alvos.push(`https://api.tallos.com.br/medias/${nome}`);

  const linhas: string[] = [];
  for (const url of alvos) {
    for (const comToken of [true, false]) {
      const linha = await tenta(url, comToken);
      if (linha) linhas.push(linha);
      if (linha?.startsWith("ACHOU") || linha?.startsWith("AUTH?")) console.log(linha);
    }
  }
  const achou = linhas.filter((l) => l.startsWith("ACHOU") || l.startsWith("AUTH?"));
  if (!achou.length) {
    console.log("(nenhum candidato serviu o arquivo nem pediu credencial)");
    console.log("\nresumo por status:");
    const cont = new Map<string, number>();
    for (const l of linhas) { const k = l.slice(0, 10).trim(); cont.set(k, (cont.get(k) ?? 0) + 1); }
    for (const [k, v] of [...cont.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${v}`);
  }
  console.log("\n401/403 seria PISTA BOA: caminho existe, falta credencial.");
}

main().catch((e) => { console.error("ERRO:", e?.message ?? e); process.exit(1); });
