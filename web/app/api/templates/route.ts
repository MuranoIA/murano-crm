import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../lib/papel";

export const dynamic = "force-dynamic";

// Templates do botão "template" do card / disparo em massa. GET: qualquer sessão lista os
// ativos. POST: só admin cadastra (nome + rd_template_id da API do RD; vazio = usa o padrão
// do servidor). Escrita SÓ no murano-conversas (crm_templates).
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const { data, error } = await sb()
    .from("crm_templates").select("id,nome,rd_template_id").eq("ativo", true).order("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin cadastra templates" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const nome = String(b?.nome ?? "").trim();
  const rd = String(b?.rd_template_id ?? "").trim() || null;
  if (!nome) return Response.json({ error: "nome obrigatório" }, { status: 400 });

  const { data, error } = await sb()
    .from("crm_templates").insert({ nome, rd_template_id: rd, ativo: true })
    .select("id,nome,rd_template_id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, template: data });
}
