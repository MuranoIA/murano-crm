import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// dias por período (rolling) da compra DA LINHA. "todos" = sem corte de data.
const DIAS: Record<string, number> = {
  mes: 30, "2m": 60, "3m": 90, "6m": 180, ano: 365, "2anos": 730,
};

// Cross-sell: quem já compra a LINHA mas AINDA NÃO comprou o produto alvo.
// Devolve os IDENTIFICADORES desses clientes (codclis + cliente_ids do RD +
// telefones8), agregados no banco pela função clientes_sem_produto (evita o teto
// de 1000 linhas). O board casa cada card por qualquer um deles e filtra em
// memória — mesma mecânica de /api/clientes-por-produto.
//
// O período vale só para a linha; o alvo é varrido no histórico inteiro, senão
// "ainda não comprou" viraria "parou de comprar" (ver migration 0078).
export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { searchParams } = new URL(req.url);
  const nums = (s: string | null) =>
    (s || "").split(",").map((x) => parseInt(x, 10)).filter((n) => !isNaN(n));
  const alvo = nums(searchParams.get("alvo"));
  const linha = nums(searchParams.get("linha"));
  const periodo = searchParams.get("periodo") || "ano";
  if (alvo.length === 0 || linha.length === 0) {
    return Response.json({ codclis: [], cliente_ids: [], tel8: [], total: 0 });
  }

  // "hoje" em Brasília (UTC-3)
  const dias = DIAS[periodo];
  const desde = dias
    ? new Date(Date.now() - 3 * 3600 * 1000 - dias * 86400000).toISOString().slice(0, 10)
    : null;

  const { data, error } = await sb.rpc("clientes_sem_produto", {
    p_alvo: alvo, p_linha: linha, p_desde: desde, p_ate: null,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? { codclis: [], cliente_ids: [], tel8: [], total: 0 });
}
