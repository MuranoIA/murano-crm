import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// dias por período (rolling). hoje/ontem são tratados como dia único abaixo.
const DIAS: Record<string, number> = {
  semana: 7, quinzena: 15, mes: 30,
  "2m": 60, "3m": 90, "4m": 120, "5m": 150, "6m": 180, ano: 365,
};

// Dado produtos + período, devolve os IDENTIFICADORES dos clientes que compraram
// (codclis + cliente_ids do RD + telefones8), agregados no banco pela função
// clientes_por_produto (evita o teto de 1000 linhas). O board casa cada card por
// qualquer um desses e filtra em memória — sem recarregar o funil.
export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { searchParams } = new URL(req.url);
  const produtos = (searchParams.get("produtos") || "")
    .split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  const periodo = searchParams.get("periodo") || "mes";
  if (produtos.length === 0) {
    return Response.json({ codclis: [], cliente_ids: [], tel8: [], total: 0 });
  }

  // "hoje" em Brasília (UTC-3)
  const diaBRT = (offset = 0) =>
    new Date(Date.now() - 3 * 3600 * 1000 - offset * 86400000).toISOString().slice(0, 10);
  let desde: string;
  let ate: string | null = null;
  if (periodo === "hoje") { desde = diaBRT(0); ate = diaBRT(0); }
  else if (periodo === "ontem") { desde = diaBRT(1); ate = diaBRT(1); }
  else { desde = diaBRT(DIAS[periodo] ?? 30); }

  const { data, error } = await sb.rpc("clientes_por_produto", {
    p_codprods: produtos, p_desde: desde, p_ate: ate,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? { codclis: [], cliente_ids: [], tel8: [], total: 0 });
}
