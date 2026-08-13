import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Painel do contato (P1, CLAUDE.md §18): os dados do WinThor ao lado da conversa.
// É a vantagem estrutural sobre o RD Conversas — o RD nunca teve o ERP do lado.
// Tudo vem de views que já existem; esta rota só junta e devolve enxuto.
export async function GET(req: Request) {
  if (!cookies().get("crm_sessao")?.value) {
    return Response.json({ error: "não autenticado" }, { status: 401 });
  }
  const cliente_id = new URL(req.url).searchParams.get("cliente_id");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const [compras, ciclo, funil, ultimas] = await Promise.all([
    // histórico de compra consolidado (líquido já desconta devolução)
    sb.from("vw_cliente_compras")
      .select("codcli,cidade,compras,ultima_compra,dias_sem_comprar,total_liquido,rca_oficial")
      .eq("cliente_id", cliente_id).maybeSingle(),
    // ciclo de recompra: quanto do ciclo já passou, urgência, ação sugerida
    sb.from("vw_ciclo_card")
      .select("pct_ciclo,ciclo_medio,dias_ausente,tipo_oportunidade,acao_recomendada,tendencia")
      .eq("cliente_id", cliente_id).maybeSingle(),
    // etapa no funil + valor faturado no mês
    sb.from("vw_funil")
      .select("etapa,venda_valor,venda_data,codcli,sem_cadastro")
      .eq("cliente_id", cliente_id).maybeSingle(),
    // últimas notas fiscais do cliente
    sb.from("vw_pedido_emitido")
      .select("data_fat,valor,num_nota,filial")
      .eq("cliente_id", cliente_id)
      .order("data_fat", { ascending: false })
      .limit(5),
  ]);

  return Response.json({
    compras: compras.data ?? null,
    ciclo: ciclo.data ?? null,
    funil: funil.data ?? null,
    ultimas_notas: ultimas.data ?? [],
  });
}
