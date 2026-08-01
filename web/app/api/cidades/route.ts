import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Lista de cidades p/ o multi-select do filtro (ordenada por nº de clientes).
// 394 cidades (< teto de 1000), cabe numa resposta só; o front busca uma vez e cacheia.
export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await sb
    .from("vw_cidades")
    .select("cidade_norm,cidade,clientes")
    .order("clientes", { ascending: false })
    .range(0, 999);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ cidades: data ?? [] });
}
