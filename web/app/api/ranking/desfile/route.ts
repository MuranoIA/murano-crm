import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../../lib/papel";

export const dynamic = "force-dynamic";

// Dispara o "desfile" nas TVs do ranking: grava bi_config.desfile_comando com um id
// único (timestamp). Cada painel confere esse id a cada ~6s (edge fn ?comando=1) e roda
// o desfile quando ele muda. Só admin. Escrita SÓ no murano-conversas (bi_config).
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin pode rodar o desfile" }, { status: 403 });

  const id = String(Date.now());
  const { error } = await sb().from("bi_config")
    .upsert({ chave: "desfile_comando", valor: id, atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, id });
}
