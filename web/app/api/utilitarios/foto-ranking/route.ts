import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Upload da foto do vendedor para o ranking. O slug (de QUEM é a foto) vem SEMPRE da
// sessão no servidor — nunca do cliente — então um vendedor só altera a PRÓPRIA foto.
// Grava no bucket ranking-fotos + tabela bi_fotos_ranking (a edge fn do ranking lê dali).
const BUCKET = "ranking-fotos";
const MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX = 5 * 1024 * 1024;

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

// slug do vendedor logado: carteira da sessão; senão, e-mail -> acesso.carteira.
async function slugDoVendedor(): Promise<string | null> {
  const ck = cookies();
  const sessao = ck.get("crm_sessao")?.value;
  if (!sessao) return null;
  const direto = carteiraDe(sessao);
  if (direto) return direto;
  const email = ck.get("crm_email")?.value;
  if (!email) return null;
  const { data } = await sb().from("acesso").select("carteira").eq("email", email).maybeSingle();
  return (data?.carteira as string) ?? null;
}

export async function GET() {
  const ck = cookies();
  if (!ck.get("crm_sessao")?.value) return Response.json({ error: "não autenticado" }, { status: 401 });
  const slug = await slugDoVendedor();
  if (!slug) return Response.json({ slug: null, url: null });
  const { data } = await sb().from("bi_fotos_ranking").select("url,atualizado_em").eq("slug", slug).maybeSingle();
  return Response.json({ slug, url: data?.url ?? null, atualizado_em: data?.atualizado_em ?? null });
}

export async function POST(req: Request) {
  const ck = cookies();
  if (!ck.get("crm_sessao")?.value) return Response.json({ error: "não autenticado" }, { status: 401 });
  const slug = await slugDoVendedor();
  if (!slug) {
    return Response.json({ error: "Este utilitário é para vendedores — a foto vai ao lado do seu nome no ranking. Entre com o seu usuário de vendedor." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("foto");
  if (!(file instanceof File)) return Response.json({ error: "Nenhuma imagem enviada." }, { status: 400 });
  if (!MIMES.includes(file.type)) return Response.json({ error: "Formato inválido. Use JPG, PNG ou WEBP." }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "Imagem muito grande (máx. 5 MB)." }, { status: 400 });

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const buf = new Uint8Array(await file.arrayBuffer());
  const path = `${slug}-${Date.now()}.${ext}`;

  const client = sb();
  const { error: upErr } = await client.storage.from(BUCKET).upload(path, buf, { contentType: file.type, upsert: true });
  if (upErr) return Response.json({ error: "Falha no upload: " + upErr.message }, { status: 500 });

  const url = client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const { error: dbErr } = await client.from("bi_fotos_ranking")
    .upsert({ slug, url, atualizado_em: new Date().toISOString() }, { onConflict: "slug" });
  if (dbErr) return Response.json({ error: "Falha ao salvar: " + dbErr.message }, { status: 500 });

  return Response.json({ ok: true, slug, url });
}
