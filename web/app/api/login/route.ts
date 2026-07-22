import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// LOGIN INTERINO admin/admin — TEMPORÁRIO e inseguro (a pedido, "por hora").
// Depois vira Supabase Auth + Google (vendedores) + admin proper.
export async function POST(req: Request) {
  const { user, pass } = await req.json().catch(() => ({}));
  if (user === "admin" && pass === "admin") {
    cookies().set("crm_sessao", "admin", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8, // 8h
    });
    return Response.json({ ok: true, role: "admin", carteira: null });
  }
  return Response.json({ error: "Usuário ou senha inválidos" }, { status: 401 });
}
