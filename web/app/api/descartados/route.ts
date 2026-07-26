import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { veTudo } from "../../../lib/papel";

export const dynamic = "force-dynamic";

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}
const tel8 = (t: any) => String(t ?? "").replace(/\D/g, "").slice(-8) || null;

// GET: lista os descartados (admin vê tudo; vendedor vê a própria carteira)
export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  let q = sb().from("wth_descartados").select("id,cliente_id,codcli,tel8,cliente,vendedor,motivo,descartado_por,criado_em").order("criado_em", { ascending: false });
  if (!veTudo(sessao)) q = q.eq("vendedor", sessao);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ descartados: data ?? [] });
}

// POST: descarta um card (arrastou pra lixeira)
export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  if (!b?.cliente_id && !b?.codcli && !b?.telefone) return Response.json({ error: "sem identificador" }, { status: 400 });
  const { error } = await sb().from("wth_descartados").insert({
    cliente_id: b.cliente_id ?? null,
    codcli: b.codcli != null && !isNaN(Number(b.codcli)) ? Number(b.codcli) : null,
    tel8: tel8(b.telefone),
    cliente: b.cliente ?? null,
    vendedor: b.vendedor ?? null,
    motivo: b.motivo || "cliente final",
    descartado_por: sessao,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// DELETE: restaura (remove da lixeira) por id
export async function DELETE(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  if (!b?.id) return Response.json({ error: "id ausente" }, { status: 400 });
  let q = sb().from("wth_descartados").delete().eq("id", b.id);
  if (!veTudo(sessao)) q = q.eq("vendedor", sessao); // vendedor só restaura o próprio
  const { error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
