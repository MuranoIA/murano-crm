import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Serve a mídia de uma mensagem. O bucket `wa-midia` é PRIVADO (conteúdo de
// conversa é dado de cliente), então aqui geramos uma URL assinada de curta
// duração e redirecionamos — assim `<img src="/api/chat/midia?id=...">` e
// `<audio src=...>` funcionam direto, sem trafegar o arquivo pela Vercel.
//
// Escopo: exige sessão do CRM. Não filtra por carteira, pela mesma razão do
// /api/chat/thread — a mensagem guarda a carteira de QUANDO foi enviada, e
// filtrar por ela cortaria mídia de quem trocou de RCA.
export async function GET(req: Request) {
  if (!cookies().get("crm_sessao")?.value) {
    return Response.json({ error: "não autenticado" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: msg } = await sb
    .from("mensagens").select("midia_path").eq("id", id).maybeSingle();
  if (!msg?.midia_path) return Response.json({ error: "mídia não encontrada" }, { status: 404 });

  const { data, error } = await sb.storage
    .from("wa-midia")
    .createSignedUrl(msg.midia_path as string, 3600);
  if (error || !data?.signedUrl) {
    return Response.json({ error: error?.message ?? "falha ao assinar URL" }, { status: 500 });
  }

  // 302 para a URL assinada; cache curto no navegador (a assinatura dura 1h)
  return new Response(null, {
    status: 302,
    headers: { Location: data.signedUrl, "Cache-Control": "private, max-age=1800" },
  });
}
