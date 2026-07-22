import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Retorna a sessão atual. Cookie "crm_sessao":
//   "admin"        -> vê tudo
//   <carteira>     -> vendedor, vê só a própria carteira (quando o Google login existir)
export async function GET() {
  const s = cookies().get("crm_sessao")?.value;
  if (!s) return Response.json({ error: "não autenticado" }, { status: 401 });
  const role = s === "admin" ? "admin" : "vendedor";
  const carteira = s === "admin" ? null : s;
  return Response.json({ role, carteira });
}
