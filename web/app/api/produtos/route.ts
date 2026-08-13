import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Lista de produtos p/ o multi-select do filtro. ~420 linhas (< teto de 1000),
// então cabe numa resposta só; o front busca uma vez e cacheia.
// departamento/secao/marca vêm junto porque o filtro "ainda não comprou" resolve
// a LINHA do produto no próprio front, sem ida extra ao banco (migration 0078).
export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await sb
    .from("vw_produtos_venda")
    .select("codprod,produto,clientes,departamento,secao,marca")
    .order("produto", { ascending: true })
    .range(0, 999);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ produtos: data ?? [] });
}
