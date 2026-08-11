import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../lib/papel";

export const dynamic = "force-dynamic";

// Templates do botão "template" do card / disparo em massa. GET: qualquer sessão lista os
// ativos. POST/PATCH/DELETE: só admin. `padrao` (bool) é o template usado quando o chamador
// não manda template_id (botão do card sem escolha manual, disparo em massa com "padrão"
// selecionado) — fonte única em vez da antiga env var TEMPLATE_RECONTATO_ID na Vercel, que
// exigia redeploy pra trocar e não tinha como corrigir um id que ficou desatualizado.
// Escrita SÓ no murano-conversas (crm_templates).
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

const COLS = "id,nome,rd_template_id,padrao";

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const { data, error } = await sb()
    .from("crm_templates").select(COLS).eq("ativo", true).order("id");
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
  const padrao = b?.padrao === true;
  if (!nome) return Response.json({ error: "nome obrigatório" }, { status: 400 });

  const db = sb();
  // índice único parcial só permite 1 padrao=true; desmarca o atual antes de gravar o novo.
  if (padrao) await db.from("crm_templates").update({ padrao: false }).eq("padrao", true);

  const { data, error } = await db
    .from("crm_templates").insert({ nome, rd_template_id: rd, ativo: true, padrao })
    .select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, template: data });
}

// PATCH: admin edita nome/rd_template_id/padrao/ativo de um template existente. Principal
// uso: corrigir um rd_template_id que ficou desatualizado (template editado/recriado no
// painel do RD) sem precisar apagar e recadastrar.
export async function PATCH(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin edita templates" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const id = Number(b?.id);
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof b.nome === "string" && b.nome.trim()) patch.nome = b.nome.trim();
  if (typeof b.rd_template_id === "string") patch.rd_template_id = b.rd_template_id.trim() || null;
  if (typeof b.ativo === "boolean") patch.ativo = b.ativo;
  if (b.padrao === true) patch.padrao = true;
  else if (b.padrao === false) patch.padrao = false;
  if (!Object.keys(patch).length) return Response.json({ error: "nada pra atualizar" }, { status: 400 });

  const db = sb();
  if (patch.padrao === true) await db.from("crm_templates").update({ padrao: false }).eq("padrao", true);

  const { data, error } = await db.from("crm_templates").update(patch).eq("id", id).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, template: data });
}

// DELETE: admin remove um template cadastrado por engano (id no corpo).
export async function DELETE(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin remove templates" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const id = Number(b?.id);
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  const { error } = await sb().from("crm_templates").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
