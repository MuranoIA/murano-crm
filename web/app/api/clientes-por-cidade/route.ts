import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Dadas cidades (chaves normalizadas de vw_cidades), devolve os IDENTIFICADORES dos
// clientes de lá (codclis + cliente_ids do RD + telefones8), agregados no banco pela
// função clientes_por_cidade (evita o teto de 1000 linhas). O board casa cada card por
// qualquer um desses e filtra em memória — sem recarregar o funil. Sem período: cidade
// é atributo fixo do cliente.
export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const cidades = (req && new URL(req.url).searchParams.get("cidades") || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (cidades.length === 0) {
    return Response.json({ codclis: [], cliente_ids: [], tel8: [], total: 0 });
  }

  const { data, error } = await sb.rpc("clientes_por_cidade", { p_cidades: cidades });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? { codclis: [], cliente_ids: [], tel8: [], total: 0 });
}
