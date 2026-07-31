import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";

export const dynamic = "force-dynamic";

// Atualização de um card — só o DESTINATÁRIO (quem recebeu) gerencia: status
// (aberto|andamento|resolvido, com horários) e devolutiva (resposta/solução). O responsável
// é carimbado automaticamente com o nome de quem recebeu ao agir.
const STATUS = ["aberto", "andamento", "resolvido"];
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
async function meuNome(email: string | undefined, sessao: string, c: ReturnType<typeof sb>) {
  if (!email) return "Usuário";
  let carteira = carteiraDe(sessao);
  const { data } = await c.from("acesso").select("carteira").eq("email", email).maybeSingle();
  if (data?.carteira) carteira = data.carteira;
  return carteira ? cap(carteira) : email.split("@")[0];
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessao = cookies().get("crm_sessao")?.value;
  const email = cookies().get("crm_email")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const c = sb();
  const { data: cur, error: e0 } = await c.from("tickets").select("*").eq("id", params.id).maybeSingle();
  if (e0) return Response.json({ error: e0.message }, { status: 500 });
  if (!cur) return Response.json({ error: "card não encontrado" }, { status: 404 });
  if (!email || cur.destinatario_email !== email) return Response.json({ error: "só o destinatário pode gerenciar este card" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }

  const now = new Date().toISOString();
  const patch: any = { atualizado_em: now };
  if (typeof b.devolutiva === "string") patch.devolutiva = b.devolutiva.trim().slice(0, 5000) || null;
  if (typeof b.status === "string" && STATUS.includes(b.status)) {
    patch.status = b.status;
    if (b.status === "andamento" && !cur.andamento_em) patch.andamento_em = now;
    if (b.status === "resolvido") { patch.resolvido_em = now; if (!cur.andamento_em) patch.andamento_em = now; }
    if (b.status === "aberto") patch.resolvido_em = null;
  }
  if ((patch.devolutiva || patch.status === "andamento" || patch.status === "resolvido") && !cur.responsavel_nome) {
    patch.responsavel_nome = await meuNome(email, sessao, c);
  }

  const { data, error } = await c.from("tickets").update(patch).eq("id", params.id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, ticket: data });
}
