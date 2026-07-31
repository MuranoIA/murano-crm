import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin, carteiraDe } from "../../../../lib/papel";

export const dynamic = "force-dynamic";

// Atualização de ticket — SÓ admin: status (aberto|andamento|resolvido), responsável e
// devolutiva (resposta/solução). Carimba os horários de andamento/resolução.
const STATUS = ["aberto", "andamento", "resolvido"];
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
async function autorNome(sessao: string, email: string | undefined, c: ReturnType<typeof sb>) {
  let carteira = carteiraDe(sessao);
  if (!carteira && email) {
    const { data } = await c.from("acesso").select("carteira").eq("email", email).maybeSingle();
    carteira = data?.carteira ?? null;
  }
  if (carteira) return cap(carteira);
  if (email) return email.split("@")[0];
  return "Admin";
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sessao = cookies().get("crm_sessao")?.value;
  const email = cookies().get("crm_email")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin pode responder tickets" }, { status: 403 });

  const id = params.id;
  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }

  const c = sb();
  const { data: cur, error: e0 } = await c.from("tickets").select("*").eq("id", id).maybeSingle();
  if (e0) return Response.json({ error: e0.message }, { status: 500 });
  if (!cur) return Response.json({ error: "ticket não encontrado" }, { status: 404 });

  const now = new Date().toISOString();
  const patch: any = { atualizado_em: now };

  if (typeof b.devolutiva === "string") patch.devolutiva = b.devolutiva.trim().slice(0, 5000) || null;
  if (typeof b.responsavel_nome === "string") patch.responsavel_nome = b.responsavel_nome.trim().slice(0, 120) || null;

  if (typeof b.status === "string" && STATUS.includes(b.status)) {
    patch.status = b.status;
    if (b.status === "andamento" && !cur.andamento_em) patch.andamento_em = now;
    if (b.status === "resolvido") { patch.resolvido_em = now; if (!cur.andamento_em) patch.andamento_em = now; }
    if (b.status === "aberto") patch.resolvido_em = null; // reabrir
  }

  // ao responder/pôr em andamento, se ninguém era responsável, assume o admin logado
  if ((patch.devolutiva || patch.status === "andamento" || patch.status === "resolvido") && !cur.responsavel_nome && !patch.responsavel_nome) {
    patch.responsavel_nome = await autorNome(sessao, email, c);
  }

  const { data, error } = await c.from("tickets").update(patch).eq("id", id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, ticket: data });
}
