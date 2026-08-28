import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../../lib/papel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Música da tela de parabéns do Ranking (menu Ranking → 🎵 Música dos parabéns).
// Guarda o arquivo no bucket público `ranking-musica` e o ponteiro em
// bi_config.parabens_musica (JSON). A edge fn `bi-ranking-vendas` devolve esse
// JSON para os painéis, que tocam por SEGUNDOS e voltam ao som sintetizado
// quando a chave não existe. Só admin.
//
// O corte de 59s acontece no navegador do admin (web/lib/musicaParabens.ts):
// decodifica, corta e sobe um WAV — é lá também que a trilha de VÍDEO de um
// .mp4 é descartada, porque só o áudio é decodificado. Quando o navegador não
// dá conta do codec, o original sobe com `cortado:false` e o painel aplica o
// teto de 59s no player (e usa <audio>, que ignora o vídeo do container).
const BUCKET = "ranking-musica";
const CHAVE = "parabens_musica";
const SEGUNDOS = 59; // teto de reprodução na TV (não exportar: rota do Next só aceita handlers + config)
const MAX = 20 * 1024 * 1024;
const MIMES: Record<string, string> = {
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "m4a",
  "audio/ogg": "ogg", "audio/webm": "weba",
  "video/mp4": "mp4", "video/x-m4v": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

type Musica = { url: string; path: string; nome: string; segundos: number; cortado: boolean; origem: string; atualizado_em: string };

async function atual(): Promise<Musica | null> {
  const { data } = await sb().from("bi_config").select("valor").eq("chave", CHAVE).maybeSingle();
  if (!data?.valor) return null;
  try { return JSON.parse(data.valor as string) as Musica; } catch { return null; }
}

// Apaga o arquivo antigo depois de trocar/remover. Best-effort: o bucket ficar
// com um órfão é bem menos grave que a troca falhar por causa da limpeza.
async function apagarArquivo(path?: string | null) {
  if (!path) return;
  try { await sb().storage.from(BUCKET).remove([path]); } catch { /* órfão no bucket, sem impacto */ }
}

function guarda(): Response | null {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin pode trocar a música dos parabéns" }, { status: 403 });
  return null;
}

export async function GET() {
  const nao = guarda();
  if (nao) return nao;
  return Response.json({ musica: await atual(), segundos: SEGUNDOS });
}

export async function POST(req: Request) {
  const nao = guarda();
  if (nao) return nao;

  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) return Response.json({ error: "Nenhum arquivo enviado." }, { status: 400 });

  const ext = MIMES[file.type];
  if (!ext) return Response.json({ error: `Formato não suportado (${file.type || "desconhecido"}). Use MP3, M4A, WAV, OGG ou MP4.` }, { status: 400 });
  if (!file.size) return Response.json({ error: "Arquivo vazio." }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: `Arquivo muito grande (${(file.size / 1048576).toFixed(1)} MB). Máximo 20 MB.` }, { status: 400 });

  const nome = String(form?.get("nome") ?? file.name ?? "musica").slice(0, 120);
  const cortado = String(form?.get("cortado") ?? "") === "1";
  const origem = String(form?.get("origem") ?? "").slice(0, 120);

  const anterior = await atual();
  const path = `parabens-${Date.now()}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const client = sb();
  const { error: upErr } = await client.storage.from(BUCKET).upload(path, buf, { contentType: file.type, upsert: true });
  if (upErr) return Response.json({ error: "Falha no upload: " + upErr.message }, { status: 500 });

  const musica: Musica = {
    url: client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
    path, nome, segundos: SEGUNDOS, cortado, origem,
    atualizado_em: new Date().toISOString(),
  };
  const { error: dbErr } = await client.from("bi_config")
    .upsert({ chave: CHAVE, valor: JSON.stringify(musica), atualizado_em: musica.atualizado_em }, { onConflict: "chave" });
  if (dbErr) {
    await apagarArquivo(path); // não deixa arquivo pendurado se o ponteiro não gravou
    return Response.json({ error: "Falha ao salvar: " + dbErr.message }, { status: 500 });
  }

  if (anterior?.path && anterior.path !== path) await apagarArquivo(anterior.path);
  return Response.json({ ok: true, musica });
}

// Volta ao som padrão (samba/pagode sintetizados no painel).
export async function DELETE() {
  const nao = guarda();
  if (nao) return nao;

  const anterior = await atual();
  const { error } = await sb().from("bi_config").delete().eq("chave", CHAVE);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await apagarArquivo(anterior?.path);
  return Response.json({ ok: true, musica: null });
}
