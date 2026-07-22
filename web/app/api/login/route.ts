import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Login do admin. Credenciais vêm de variáveis de ambiente:
//   ADMIN_USER      (default "admin")
//   ADMIN_PASSWORD  (OBRIGATÓRIA em produção; sem ela, ninguém entra — fail-closed)
// Em desenvolvimento local, se ADMIN_PASSWORD não estiver setada, cai em "admin".
// (Vendedores via Google/Supabase Auth entram numa etapa futura.)
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== "production" ? "admin" : "");

export async function POST(req: Request) {
  const { user, pass } = await req.json().catch(() => ({}));
  if (ADMIN_PASSWORD && user === ADMIN_USER && pass === ADMIN_PASSWORD) {
    cookies().set("crm_sessao", "admin", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8, // 8h
    });
    return Response.json({ ok: true, role: "admin", carteira: null });
  }
  return Response.json({ error: "Usuário ou senha inválidos" }, { status: 401 });
}
