// Modulo bi_ (murano-conversas): ranking de vendas do dia (criterio MaxiGestao).
// FONTE DE VERDADE = este arquivo (versionado no repo). Le v2 ao vivo, aplica a regra
// oficial, espelha, fotografa e responde JSON.
//
// NAO usa v2.faturamento_cancelados para excluir: essa tabela e um LOG de eventos de
// cancelamento de LINHA, nao lista de pedidos anulados (em 27/07/2026, 83 de 91 pedidos
// "flagged" ainda eram venda faturada ATIVA). Ou seja, distinguir cancelamento real olhando
// so o v2 nao e confiavel; correcao em tempo real depende do ERP ao vivo (credenciais).
// Cancelamento do mesmo dia: INSERT manual em bi_cancelados_dia (unico override).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const V2_URL = "https://jjvbmqycgjgkwidgcmif.supabase.co";
const POSICOES_ATIVAS = new Set(["L - Liberado", "B - Bloqueado", "M - Montado", "F - Faturado", "P - Pendente"]);
const FATURADO = "F - Faturado";
const SNAPSHOT_MIN = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function hojeBelem(): string { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); }
function proxDia(d: string): string { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }
function slugDe(nome: string): string { return String(nome ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim().split(/\s+/)[0] || ""; }
function resposta(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj).replace(/</g, "\\u003c"), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const url = new URL(req.url);
    const diaParam = url.searchParams.get("dia");
    const querVendas = !!url.searchParams.get("vendas");
    const hoje = hojeBelem();

    if (url.searchParams.get("comando")) {
      const { data: cmds } = await sb.from("bi_config").select("chave,valor").in("chave", ["desfile_comando", "parabens_comando", "metabatida_comando"]);
      const m = new Map((cmds ?? []).map((c: any) => [c.chave, c.valor]));
      const parseJson = (s: any) => { if (!s) return null; try { return JSON.parse(s as string); } catch { return null; } };
      return resposta({ desfile: m.get("desfile_comando") ?? null, parabens: parseJson(m.get("parabens_comando")), metabatida: parseJson(m.get("metabatida_comando")) });
    }

    const { data: metaCfg } = await sb.from("bi_config").select("valor").eq("chave", "meta_dia").maybeSingle();
    const meta = Number(metaCfg?.valor ?? 0) || 0;

    const { data: diasRows } = await sb.from("bi_ranking_snapshots").select("dia").order("dia", { ascending: false });
    const diasDisponiveis = [...new Set((diasRows ?? []).map((r: any) => r.dia))];
    if (!diasDisponiveis.includes(hoje)) diasDisponiveis.unshift(hoje);

    const { data: fotosRows } = await sb.from("bi_fotos_ranking").select("slug,url");
    const fotoDe = new Map((fotosRows ?? []).map((f: any) => [f.slug, f.url]));

    const { data: metaVendRows } = await sb.from("bi_meta_vendedor").select("slug,meta");
    const metaVendDe = new Map((metaVendRows ?? []).map((m: any) => [m.slug, Number(m.meta) || 0]));

    const { data: bvRows } = await sb.from("bic_vendedor").select("carteira,janela,pct_conversao_7d,resposta_mediana_min,pct_resp_15min,clientes_ativos,ticket_com_conversa,pct_carinhoso");
    const bvByCart = new Map<string, any>();
    for (const r of (bvRows ?? [])) { const c = bvByCart.get(r.carteira); if (!c || String(r.janela) > String(c.janela)) bvByCart.set(r.carteira, r); }
    const { data: perRows } = await sb.from("bic_persona").select("carteira,persona");
    const perByCart = new Map((perRows ?? []).map((p: any) => [p.carteira, p.persona]));
    const elogioDe = (slug: string) => {
      const bv = bvByCart.get(slug); const per: any = perByCart.get(slug);
      if (!bv && !per) return null;
      const q: string[] = [];
      if (bv) {
        const rm = Number(bv.resposta_mediana_min);
        if (isFinite(rm) && rm > 0 && rm <= 5) q.push(`Responde rapido — mediana de ${rm.toFixed(1).replace(".", ",")} min`);
        else if (Number(bv.pct_resp_15min) >= 60) q.push(`${Math.round(Number(bv.pct_resp_15min))}% das respostas em ate 15 min`);
        if (Number(bv.pct_conversao_7d) >= 8) q.push(`Conversao de ${Math.round(Number(bv.pct_conversao_7d))}% em 7 dias`);
        if (Number(bv.clientes_ativos) >= 50) q.push(`${bv.clientes_ativos} clientes ativos na conversa`);
        if (Number(bv.ticket_com_conversa) > 0) q.push(`Ticket medio de R$ ${Math.round(Number(bv.ticket_com_conversa))}`);
        if (Number(bv.pct_carinhoso) >= 20) q.push("Atendimento caloroso e proximo");
      }
      const arquetipo = per && typeof per === "object" ? (per.arquetipo ?? null) : null;
      const taglineRaw = per && typeof per === "object" ? (per.tagline ?? null) : null;
      const tagline = taglineRaw ? String(taglineRaw).split(" — ")[0] : null;
      return { arquetipo, tagline, qualidades: q.slice(0, 3) };
    };

    if (diaParam && diaParam !== hoje) {
      const { data: snap } = await sb.from("bi_ranking_snapshots").select("payload,capturado_em").eq("dia", diaParam).order("capturado_em", { ascending: false }).limit(1);
      if (!snap?.length) {
        return resposta({ dia: diaParam, aoVivo: false, semDados: true, meta, diasDisponiveis, geradoEm: new Date().toISOString(), ranking: [], totais: { bruto: 0, devolucoes: 0, liquido: 0, pedidos: 0, dev_pedidos: 0, clientes: 0 } });
      }
      const p: any = snap[0].payload ?? {};
      p.dia = diaParam; p.aoVivo = false; p.meta = meta; p.diasDisponiveis = diasDisponiveis; p.geradoEm = snap[0].capturado_em;
      if (Array.isArray(p.ranking)) p.ranking = p.ranking.map((e: any) => ({ ...e, foto: fotoDe.get(slugDe(e.nome)) ?? null }));
      return resposta(p);
    }

    const { data: cfg, error: cfgErr } = await sb.from("bi_config").select("valor").eq("chave", "v2_anon_key").single();
    if (cfgErr || !cfg) throw new Error("bi_config sem v2_anon_key");
    const v2Key = cfg.valor;
    const ini = hoje + "T00:00:00-03:00";
    const fim = proxDia(hoje) + "T00:00:00-03:00";

    const cols = "id,pedido,vlr_atendido,nome_usuario,codcli,posicao,tipo,codfilial,data_emissao";
    const rows: any[] = [];
    let offset = 0;
    while (true) {
      const u = V2_URL + "/rest/v1/faturamento?select=" + cols + "&tipo=eq.VENDA&codfilial=neq.3" + "&data_emissao=gte." + encodeURIComponent(ini) + "&data_emissao=lt." + encodeURIComponent(fim) + "&order=id.asc&limit=1000&offset=" + offset;
      const r = await fetch(u, { headers: { apikey: v2Key, Authorization: "Bearer " + v2Key } });
      if (!r.ok) throw new Error("v2 HTTP " + r.status + ": " + (await r.text()).slice(0, 200));
      const chunk = await r.json();
      rows.push(...chunk);
      if (chunk.length < 1000) break;
      offset += 1000;
    }

    const porPedido = new Map<number, any>();
    for (const r of rows) { const atual = porPedido.get(r.pedido); if (!atual || r.id > atual.id) porPedido.set(r.pedido, r); }
    let pedidos = [...porPedido.values()].filter((p) => POSICOES_ATIVAS.has(p.posicao));

    // cancelamentos do mesmo dia: registro manual (unico override; o v2 nao distingue).
    const { data: canc } = await sb.from("bi_cancelados_dia").select("pedido");
    const cancelados = new Set((canc ?? []).map((c: any) => c.pedido));
    pedidos = pedidos.filter((p) => !cancelados.has(p.pedido));

    // dedup de REEMISSAO (mesmo codcli+valor; nao-faturado com gemeo faturado de numero maior).
    const chaveDup = (p: any) => `${p.codcli}|${Number(p.vlr_atendido ?? 0)}`;
    const faturadoMaxPedido = new Map<string, number>();
    for (const p of pedidos) { if (p.posicao === FATURADO && p.codcli != null) { const k = chaveDup(p); const cur = faturadoMaxPedido.get(k); if (cur == null || p.pedido > cur) faturadoMaxPedido.set(k, p.pedido); } }
    const fantasmas = new Set<number>();
    for (const p of pedidos) { if (p.posicao === FATURADO || p.codcli == null) continue; const tw = faturadoMaxPedido.get(chaveDup(p)); if (tw != null && tw > p.pedido) fantasmas.add(p.pedido); }
    pedidos = pedidos.filter((p) => !fantasmas.has(p.pedido));

    const codclisAll = [...new Set(pedidos.map((p) => p.codcli).filter((c) => c != null))] as number[];
    const nomeCli = new Map<number, string>();
    for (let i = 0; i < codclisAll.length; i += 100) {
      const parte = codclisAll.slice(i, i + 100);
      const { data: cli } = await sb.from("wth_carteira").select("codcli,nome").in("codcli", parte);
      for (const c of (cli ?? [])) { if (!nomeCli.has(c.codcli)) nomeCli.set(c.codcli, c.nome); }
    }
    const nomeClienteDe = (codcli: number | null) => (codcli != null ? nomeCli.get(codcli) : null) || (codcli != null ? ("Cliente " + codcli) : "Cliente");

    const ultimoDe = new Map<string, { pedido: number; codcli: number | null; valor: number }>();
    for (const p of pedidos) {
      const nome = String(p.nome_usuario ?? "(sem vendedor)").trim();
      const cur = ultimoDe.get(nome);
      if (!cur || p.pedido > cur.pedido) ultimoDe.set(nome, { pedido: p.pedido, codcli: p.codcli ?? null, valor: Number(p.vlr_atendido ?? 0) });
    }
    const ultimaDe = (nome: string) => { const u = ultimoDe.get(nome); if (!u) return null; return { cliente: nomeClienteDe(u.codcli), valor: Math.round(u.valor * 100) / 100 }; };

    const porVendedor = new Map<string, { liquido: number; pedidos: number; clientes: Set<number> }>();
    for (const p of pedidos) {
      const nome = String(p.nome_usuario ?? "(sem vendedor)").trim();
      const v = porVendedor.get(nome) ?? { liquido: 0, pedidos: 0, clientes: new Set<number>() };
      v.liquido += Number(p.vlr_atendido ?? 0); v.pedidos += 1; if (p.codcli != null) v.clientes.add(p.codcli);
      porVendedor.set(nome, v);
    }
    const ranking = [...porVendedor.entries()].map(([nome, v]) => ({
      nome, bruto: Math.round(v.liquido * 100) / 100, devolucoes: 0, liquido: Math.round(v.liquido * 100) / 100,
      pedidos: v.pedidos, clientes: v.clientes.size, foto: fotoDe.get(slugDe(nome)) ?? null,
      elogio: elogioDe(slugDe(nome)), ultima: ultimaDe(nome), meta: metaVendDe.get(slugDe(nome)) || 0,
    })).sort((a, b) => b.liquido - a.liquido);

    if (querVendas) {
      const agg = new Map<string, any>(ranking.map((e: any, i: number) => [e.nome, { total: e.liquido, pedidos: e.pedidos, posicao: i + 1 }]));
      const vendas = pedidos.slice().sort((a, b) => a.pedido - b.pedido).map((p) => {
        const nome = String(p.nome_usuario ?? "(sem vendedor)").trim(); const a = agg.get(nome) ?? {};
        return { pedido: p.pedido, vendedor: nome, cliente: nomeClienteDe(p.codcli ?? null), valor: Math.round(Number(p.vlr_atendido ?? 0) * 100) / 100, foto: fotoDe.get(slugDe(nome)) ?? null, elogio: elogioDe(slugDe(nome)), total: a.total ?? null, pedidos: a.pedidos ?? null, posicao: a.posicao ?? null };
      });
      return resposta({ dia: hoje, geradoEm: new Date().toISOString(), vendas });
    }

    const totalLiquido = Math.round(pedidos.reduce((s, p) => s + Number(p.vlr_atendido ?? 0), 0) * 100) / 100;
    const clientesTotal = new Set(pedidos.filter((p) => p.codcli != null).map((p) => p.codcli)).size;
    const payload: any = {
      geradoEm: new Date().toISOString(), dia: hoje, aoVivo: true, meta, diasDisponiveis,
      criterio: "pedidos emitidos hoje (data_emissao, fuso Belem), estados ativos (bloqueado conta), menos cancelados e reemissoes",
      totais: { bruto: totalLiquido, devolucoes: 0, liquido: totalLiquido, pedidos: pedidos.length, dev_pedidos: 0, clientes: clientesTotal },
      ranking,
    };

    try {
      await sb.from("bi_pedidos_dia").delete().neq("pedido", -1);
      if (pedidos.length > 0) {
        await sb.from("bi_pedidos_dia").insert(pedidos.map((p) => ({ pedido: p.pedido, vendedor: String(p.nome_usuario ?? "").trim(), vlr_atendido: p.vlr_atendido, codcli: p.codcli, posicao: p.posicao, data_emissao: p.data_emissao, origem_id: p.id })));
      }
      const { data: ult } = await sb.from("bi_ranking_snapshots").select("capturado_em").eq("dia", hoje).order("capturado_em", { ascending: false }).limit(1);
      const ultimaMs = ult?.length ? new Date(ult[0].capturado_em).getTime() : 0;
      if (Date.now() - ultimaMs > SNAPSHOT_MIN * 60 * 1000) await sb.from("bi_ranking_snapshots").insert({ dia: hoje, payload });
    } catch (_e) { /* best-effort */ }

    return resposta(payload);
  } catch (e) { return resposta({ erro: (e as Error).message }, 500); }
});
