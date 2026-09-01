import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { escopoCarteira } from "../../../../lib/verComo";
import { lerCrmConfig } from "../../../../lib/crmConfig";

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
  const carteira = escopoCarteira();

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
  // ---- item 2: tempo de resolução (0114) ----------------------------------
  // A fonte é a tabela append-only, não `chat_conversa`: aquela é upsert por
  // cliente e perde a resolução anterior quando a conversa reabre — a média
  // melhoraria justamente quando a operação piorasse.
  let qResolv = sb.from("vw_chat_resolucao")
    .select("vendedor,dia,motivo,resolvidas,com_tempo,ate_1h,ate_24h,mediana_min,p90_min")
    .gte("dia", desde);

  // ---- item 3: quem está esperando AGORA ----------------------------------
  // Não é histórico: é a fila do momento, para alguém agir antes de a espera
  // virar estatística. A view já respeita `linhas_visiveis` e ignora `auto`.
  let qEspera = sb.from("vw_chat_espera").select("cliente_id,cliente,vendedor,esperando_desde,minutos");

  if (carteira) {
    qTempo = qTempo.eq("vendedor", carteira);
    qVol = qVol.eq("vendedor", carteira);
    qResolv = qResolv.eq("vendedor", carteira);
    qEspera = qEspera.eq("vendedor", carteira);
  }

  const [{ data: tempo, error: e1 }, { data: vol, error: e2 }, resolvRes, esperaRes, cfg] =
    await Promise.all([qTempo, qVol, qResolv, qEspera, lerCrmConfig(sb)]);
  if (e1 || e2) return Response.json({ error: (e1 ?? e2)!.message }, { status: 500 });

  // As duas views nascem na 0114. Enquanto ela não for aplicada, a tela mostra
  // o resto normalmente e diz que estas duas ainda não existem — em vez de
  // devolver 500 e derrubar indicadores que já funcionavam.
  const semViews = !!(resolvRes.error || esperaRes.error);
  const resolvidas = resolvRes.data ?? [];
  const esperando = (esperaRes.data ?? []).slice().sort((a: any, b: any) => b.minutos - a.minutos);

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
  let totalResolv = 0, comTempo = 0, ate1h = 0, ate24h = 0;
  const medianasResol: number[] = [];
  let piorP90Resol = 0;
  for (const r of resolvidas) {
    const k = (r.motivo as string) || "sem_motivo";
    const n = Number(r.resolvidas ?? 0);
    motivos[k] = (motivos[k] ?? 0) + n;
    totalResolv += n;
    comTempo += Number(r.com_tempo ?? 0);
    ate1h += Number(r.ate_1h ?? 0);
    ate24h += Number(r.ate_24h ?? 0);
    if (r.mediana_min != null) medianasResol.push(Number(r.mediana_min));
    piorP90Resol = Math.max(piorP90Resol, Number(r.p90_min ?? 0));
  }

  // O limite de SLA mora em `crm_config` e nasce em 0 (desligado): número
  // chutado no deploy vira alarme que todo mundo aprende a ignorar.
  const sla = Number(cfg.sla_minutos ?? 0);
  const estourados = sla > 0 ? esperando.filter((e: any) => Number(e.minutos) >= sla) : [];

  return Response.json({
    dias, desde,
    vendedores,
    serie: tempo ?? [],
    // item 2 — contagens somadas; a mediana segue sendo "típica do dia" (§21.1)
    resolvidas: {
      total: totalResolv,
      por_motivo: motivos,
      com_tempo: comTempo,
      ate_1h: ate1h,
      ate_24h: ate24h,
      mediana_tipica_min: mediana(medianasResol),
      pior_p90_min: piorP90Resol || null,
    },
    // item 3 — a fila do momento
    espera: {
      sla_minutos: sla,
      total: esperando.length,
      estourados: estourados.length,
      // um punhado basta para agir; a contagem acima é o número honesto
      lista: estourados.slice(0, 20),
      mais_antiga: esperando[0] ?? null,
    },
    sem_views: semViews,
    atualizado_em: new Date().toISOString(),
  });
}
