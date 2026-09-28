import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";
import { LIMITE_META } from "../../../../lib/midia";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// O PACOTE DE FIGURINHAS (0144, pedido do dono em 28/09/2026)
//
// GET     lista o que EU posso enviar: as da casa + as minhas, já com a URL
//         assinada de cada arquivo — uma assinatura em lote, não uma ida por
//         figurinha (o bucket é privado, §P0/0079).
// POST    salva no pacote. Dois caminhos, e os dois acabam no mesmo lugar:
//           · `{ mensagem_id }` → a figurinha que chegou na conversa. O arquivo
//             é COPIADO para `figurinhas/`, não referenciado: mensagem pode ser
//             apagada, e pacote que perde figurinha junto não é pacote;
//           · multipart com um arquivo `.webp` → subir uma nova.
// DELETE  tira do pacote e apaga o arquivo.
//
// ⚠️ ALCANCE: vendedor salva a PESSOAL (a carteira dele); admin, home e
// pós-venda salvam a DA CASA (`carteira` nulo), que todo mundo vê. É a mesma
// régua das respostas rápidas (0082) e quem decide é o servidor, pela sessão —
// a tela não manda o alcance.
// ---------------------------------------------------------------------------

const BUCKET = "wa-midia";
const PASTA = "figurinhas";

function banco() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** as que esta sessão enxerga: as da casa e as dela */
function minhasEDaCasa(q: any, carteira: string | null) {
  return carteira ? q.or(`carteira.is.null,carteira.eq.${carteira}`) : q;
}

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const sb = banco();
  if (!sb) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });

  const carteira = carteiraDe(sessao);
  let q = sb.from("chat_figurinha").select("id,caminho,nome,carteira,criada_por,criada_em")
    .order("criada_em", { ascending: false }).limit(200);
  q = minhasEDaCasa(q, carteira);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const linhas = data ?? [];
  // uma assinatura para todas: N redirects por abertura da gaveta seria o
  // mesmo vício de pedir uma ida por linha de lista
  const { data: urls } = await sb.storage.from(BUCKET).createSignedUrls(linhas.map((f: any) => f.caminho), 3600);
  const porCaminho = new Map((urls ?? []).map((u: any) => [u.path, u.signedUrl]));

  return Response.json({
    figurinhas: linhas.map((f: any) => ({
      id: f.id,
      nome: f.nome,
      da_casa: f.carteira == null,
      minha: f.criada_por === (usuarioDaSessao() ?? sessao),
      url: porCaminho.get(f.caminho) ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const sb = banco();
  if (!sb) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });

  const usuario = usuarioDaSessao() ?? sessao;
  const carteira = carteiraDe(sessao);
  const tipo = req.headers.get("content-type") ?? "";

  let bytes: ArrayBuffer;
  let mime = "image/webp";
  let nome: string | null = null;

  if (tipo.includes("multipart/form-data")) {
    // ---- subir uma figurinha nova -------------------------------------
    const form = await req.formData().catch(() => null);
    const arquivo = form?.get("arquivo");
    if (!(arquivo instanceof File)) return Response.json({ error: "arquivo ausente" }, { status: 400 });
    mime = arquivo.type || "image/webp";
    if (mime !== "image/webp") {
      return Response.json({
        error: "Figurinha tem de ser .webp — é o único formato que o WhatsApp aceita como figurinha.",
      }, { status: 415 });
    }
    if (arquivo.size > LIMITE_META.sticker) {
      return Response.json({
        error: `Figurinha grande demais (${Math.round(arquivo.size / 1024)} KB). O limite do WhatsApp é ${Math.round(LIMITE_META.sticker / 1024)} KB.`,
      }, { status: 413 });
    }
    bytes = await arquivo.arrayBuffer();
    nome = String(form?.get("nome") ?? "").trim() || arquivo.name.replace(/\.webp$/i, "") || null;
  } else {
    // ---- salvar a que chegou na conversa ------------------------------
    const b = await req.json().catch(() => null);
    const mensagem_id = String(b?.mensagem_id ?? "").trim();
    if (!mensagem_id) return Response.json({ error: "mensagem_id ausente" }, { status: 400 });
    nome = String(b?.nome ?? "").trim() || null;

    const { data: msg } = await sb.from("mensagens")
      .select("id,midia_tipo,midia_mime,midia_path").eq("id", mensagem_id).maybeSingle();
    if (!msg?.midia_path) return Response.json({ error: "mensagem sem arquivo" }, { status: 404 });
    if (msg.midia_tipo !== "sticker") {
      return Response.json({ error: "essa mensagem não é uma figurinha" }, { status: 422 });
    }
    const baixado = await sb.storage.from(BUCKET).download(msg.midia_path as string);
    if (baixado.error || !baixado.data) {
      return Response.json({ error: "não achei o arquivo da figurinha" }, { status: 404 });
    }
    bytes = await baixado.data.arrayBuffer();
    mime = String(msg.midia_mime ?? "image/webp");
  }

  const caminho = `${PASTA}/${crypto.randomUUID()}.webp`;
  const enviado = await sb.storage.from(BUCKET).upload(caminho, bytes, { contentType: mime, upsert: false });
  if (enviado.error) return Response.json({ error: enviado.error.message }, { status: 500 });

  const { data, error } = await sb.from("chat_figurinha")
    .insert({ caminho, mime, nome, carteira, criada_por: usuario })
    .select("id").maybeSingle();
  if (error) {
    // o arquivo não pode ficar órfão no bucket se a linha não entrou
    await sb.storage.from(BUCKET).remove([caminho]);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const { data: url } = await sb.storage.from(BUCKET).createSignedUrl(caminho, 3600);
  return Response.json({
    ok: true,
    figurinha: { id: data?.id, nome, da_casa: carteira == null, minha: true, url: url?.signedUrl ?? null },
  });
}

export async function DELETE(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const sb = banco();
  if (!sb) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  const { data: f } = await sb.from("chat_figurinha").select("id,caminho,carteira,criada_por").eq("id", id).maybeSingle();
  if (!f) return Response.json({ error: "figurinha não encontrada" }, { status: 404 });

  // tira do pacote quem a pôs lá, ou quem não tem carteira (admin, home,
  // pós-venda) — o mesmo recorte de quem pode criar a da casa
  const carteira = carteiraDe(sessao);
  const minha = f.criada_por === (usuarioDaSessao() ?? sessao);
  if (carteira && !minha) {
    return Response.json({ error: "essa figurinha não é sua" }, { status: 403 });
  }

  await sb.from("chat_figurinha").delete().eq("id", id);
  await sb.storage.from(BUCKET).remove([f.caminho as string]);
  return Response.json({ ok: true });
}
