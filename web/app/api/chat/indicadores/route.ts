import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../../lib/papel";

export const dynamic = "force-dynamic";

// Indicadores de atendimento do chat — o equivalente ao TME/TMA do RD.
// Vendedor vê só a si; admin/home veem o time inteiro (filtro no SERVIDOR).
//
// Agregação por período feita com CONTAGENS, não com média de percentuais:
// somar `pct` diário daria peso igual a um dia de 3 respostas e a um de 300.
// A MEDIANA do período não é derivável das diárias — por isso devolvemos a
// série diária e rotulamos o resumo como "mediana típica do dia".
export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const carteira = carteiraDe(sessao);

  const dias = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("dias") ?? 15)));
  const desde = new Date(Date.now() - dias * 86400_000).toISOString().slice(0, 10);

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  let qTempo = sb.from("vw_chat_tempo_resposta")
    .select("vendedor,dia,respostas,ate_5min,ate_30min,mediana_min,media_min,p90_min")
    .gte("dia", desde).not("vendedor", "is", null);
  let qVol = sb.from("vw_chat_volume_diario")
    .select("vendedor,dia,recebidas,enviadas,conversas")
    .gte("dia", desde).not("vendedor", "is", null);
  let qResolv = sb.from("chat_conversa")
    .select("motivo,resolvida_por,resolvida_em")
    .eq("status", "resolvida").gte("resolvida_em", desde);
  if (carteira) { qTempo = qTempo.eq("vendedor", carteira); qVol = qVol.eq("vendedor", carteira); }

  const [{ data: tempo, error: e1 }, { data: vol, error: e2 }, { data: resolvidas }] =
    await Promise.all([qTempo, qVol, qResolv]);
  if (e1 || e2) return Response.json({ error: (e1 ?? e2)!.message }, { status: 500 });

  // resumo por vendedor: contagens somadas; mediana como "típica do dia"
  const porVendedor = new Map<string, any>();
  for (const t of tempo ?? []) {
    let v = porVendedor.get(t.vendedor);
    if (!v) {
      v = {
        vendedor: t.vendedor, respostas: 0, ate_5min: 0, ate_30min: 0,
        medianas: [] as number[], pior_p90: 0, recebidas: 0, enviadas: 0, dias: 0,
      };
      porVendedor.set(t.vendedor, v);
    }
    v.respostas += t.respostas; v.ate_5min += t.ate_5min; v.ate_30min += t.ate_30min;
    v.medianas.push(Number(t.mediana_min)); v.dias += 1;
    v.pior_p90 = Math.max(v.pior_p90, Number(t.p90_min));
  }
  for (const x of vol ?? []) {
    const v = porVendedor.get(x.vendedor);
    if (!v) continue;
    v.recebidas += x.recebidas; v.enviadas += x.enviadas;
  }

  const mediana = (ns: number[]) => {
    if (!ns.length) return null;
    const s = [...ns].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
  };

  const vendedores = [...porVendedor.values()].map((v) => ({
    vendedor: v.vendedor,
    respostas: v.respostas,
    // mediana das medianas diárias: rotulada como "típica do dia" na tela,
    // porque a mediana real do período exigiria as esperas linha a linha
    mediana_tipica_min: mediana(v.medianas),
    pior_p90_min: v.pior_p90,
    pct_ate_5min: v.respostas ? Math.round((100 * v.ate_5min) / v.respostas) : null,
    pct_ate_30min: v.respostas ? Math.round((100 * v.ate_30min) / v.respostas) : null,
    recebidas: v.recebidas,
    enviadas: v.enviadas,
    dias_com_atividade: v.dias,
  })).sort((a, b) => b.respostas - a.respostas);

  // encerramentos por motivo — a nossa tabulação virando número
  const motivos: Record<string, number> = {};
  for (const r of resolvidas ?? []) {
    const k = (r.motivo as string) || "sem_motivo";
    motivos[k] = (motivos[k] ?? 0) + 1;
  }

  return Response.json({
    dias, desde,
    vendedores,
    serie: tempo ?? [],
    resolvidas: { total: (resolvidas ?? []).length, por_motivo: motivos },
    atualizado_em: new Date().toISOString(),
  });
}
