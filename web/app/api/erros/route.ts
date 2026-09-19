import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Recebe o erro que `error.tsx`/`global-error.tsx` capturaram no navegador e
// grava em `erro_cliente` (migration 0140).
//
// ⚠️ NUNCA lança exceção própria. Isto roda dentro da tela que JÁ ESTÁ
// quebrada — se o registro do erro também falhar e propagar, o usuário vê
// uma segunda quebra em cima da primeira. Toda falha aqui é engolida e vira
// só um 200 silencioso; o pior caso é perder UM relato, não travar de novo.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}) as any);
    const sessao = cookies().get("crm_sessao")?.value ?? null;
    const email = cookies().get("crm_email")?.value ?? null;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return Response.json({ ok: false });
    const sb = createClient(url, key, { auth: { persistSession: false } });

    await sb.from("erro_cliente").insert({
      rota: typeof b?.rota === "string" ? b.rota.slice(0, 500) : null,
      mensagem: typeof b?.mensagem === "string" ? b.mensagem.slice(0, 2000) : null,
      stack: typeof b?.stack === "string" ? b.stack.slice(0, 8000) : null,
      digest: typeof b?.digest === "string" ? b.digest.slice(0, 200) : null,
      usuario_email: email,
      usuario_papel: sessao,
      embutido: typeof b?.embutido === "boolean" ? b.embutido : null,
      user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
      extra: b?.extra && typeof b.extra === "object" ? b.extra : null,
    });
  } catch {
    // engolido de propósito — ver o comentário acima
  }
  return Response.json({ ok: true });
}
