import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../../lib/papel";

export const dynamic = "force-dynamic";

// Snapshot do dashboard Inside Sales (gravado toda madrugada por is_refresh()).
// Com ?mes=YYYY-MM (mês encerrado, até 3 meses atrás) recalcula via is_dashboard_as_of —
// mostra o dashboard como ele estava no último dia daquele mês.
// Admin-only, como o restante do hub Análises.
export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "restrito" }, { status: 403 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const mes = new URL(req.url).searchParams.get("mes");
  if (mes) {
    if (!/^\d{4}-\d{2}$/.test(mes)) return Response.json({ error: "mes inválido" }, { status: 400 });
    const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const atualIdx = agora.getFullYear() * 12 + agora.getMonth();
    const [y, m] = mes.split("-").map(Number);
    const pedidoIdx = y * 12 + (m - 1);
    // só meses encerrados, no máximo 3 meses atrás (limite do espelho de 6 meses)
    if (pedidoIdx >= atualIdx || atualIdx - pedidoIdx > 3)
      return Response.json({ error: "mês fora do intervalo disponível" }, { status: 400 });

    const [calc, narr] = await Promise.all([
      sb.rpc("is_dashboard_as_of", { p_mes: `${mes}-01` }),
      sb.from("is_narrativas_mes").select("narrativas,gerado_em").eq("mes", `${mes}-01`).maybeSingle(),
    ]);
    if (calc.error) return Response.json({ error: calc.error.message }, { status: 500 });
    return Response.json({
      dados: calc.data,
      narrativas: narr.data?.narrativas ?? null,
      atualizado_em: narr.data?.gerado_em ?? null,
      mes,
    });
  }

  const { data, error } = await sb
    .from("is_dashboard")
    .select("dados,narrativas,atualizado_em")
    .eq("id", 1)
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
