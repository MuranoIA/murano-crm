import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../lib/papel";

export const dynamic = "force-dynamic";

// Meta do dia do Ranking (bi_config.meta_dia, em R$). GET: qualquer sessão lê o valor atual.
// POST { meta:number }: só admin grava. Escrita SÓ no murano-conversas (bi_config).
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const { data, error } = await sb().from("bi_config").select("valor").eq("chave", "meta_dia").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ meta: Number(data?.valor ?? 0) || 0 });
}

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin pode definir a meta" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const meta = Math.max(0, Math.round(Number(b?.meta ?? 0)));
  if (!isFinite(meta)) return Response.json({ error: "meta inválida" }, { status: 400 });

  const { error } = await sb().from("bi_config")
    .upsert({ chave: "meta_dia", valor: String(meta), atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, meta });
}
