import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Lista de destinatários possíveis (todos os usuários ativos do CRM), para o dropdown do
// "Criar card". Identificador = e-mail. Exclui o próprio usuário.
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const nomeDe = (email: string, carteira: string | null) => (carteira ? cap(carteira) : String(email).split("@")[0]);

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  const email = cookies().get("crm_email")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { data, error } = await sb().from("acesso").select("email,carteira,papel,ativo").eq("ativo", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const usuarios = (data ?? [])
    .filter((u) => u.email && u.email !== email)
    .map((u) => ({ email: u.email as string, nome: nomeDe(u.email, u.carteira), papel: u.papel as string | null }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return Response.json({ usuarios });
}
