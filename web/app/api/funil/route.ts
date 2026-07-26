import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  // autorização: admin vê tudo; vendedor vê só a própria carteira (filtro no SERVIDOR)
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const carteira = sessao === "admin" ? null : sessao;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes" }, { status: 500 });
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // vendedores do funil (fonte única: carteira_config) — slugs p/ filtrar vendas + cores p/ o board
  const { data: vendCfg } = await sb.from("carteira_config").select("slug,cor").eq("ativo", true);
  const slugs = (vendCfg ?? []).map((v: any) => v.slug);
  const vendedores = vendCfg ?? [];

  // cards do funil (escopo por carteira quando não-admin).
  // Pagina de mil em mil: o PostgREST/Supabase corta a resposta em 1000 linhas
  // por padrão, e a vw_funil hoje tem ~2.5k (incluindo a fila de prospecção sem
  // atividade, que ficaria de fora se pegássemos só a 1a página).
  const PAGE = 1000;
  // Degraus de colunas: tenta o mais completo; se uma coluna nova ainda não existe
  // (migration pendente), cai pro degrau anterior sem quebrar o board (o front tem
  // fallback). FULL = com nota fiscal (0006); MSGS = com 3 mensagens (0005); BASE = mínimo.
  const COLS_FULL = "cliente_id,cliente,vendedor,etapa,ultima_atividade,ultima_mensagem,ultima_enviada_por,telefone,ultimas_mensagens,venda_valor,venda_data";
  const COLS_MSGS = "cliente_id,cliente,vendedor,etapa,ultima_atividade,ultima_mensagem,ultima_enviada_por,telefone,ultimas_mensagens";
  const COLS_BASE = "cliente_id,cliente,vendedor,etapa,ultima_atividade,ultima_mensagem,ultima_enviada_por,telefone";

  const diaBRT = (offset = 0) => new Date(Date.now() - 3 * 3600 * 1000 - offset * 86400000).toISOString().slice(0, 10);
  const hojeBRT = diaBRT(0), ontemBRT = diaBRT(1);
  const d7 = diaBRT(6), d15 = diaBRT(14);
  const mesIni = hojeBRT.slice(0, 8) + "01";
  const desde = diaBRT(31);
  type TplTot = { hoje: number; ontem: number; semana: number; quinzena: number; mes: number };
  const zero = (): TplTot => ({ hoje: 0, ontem: 0, semana: 0, quinzena: 0, mes: 0 });
  const bucket = (acc: Record<string, TplTot>, vend: string, dia: string, n: number) => {
    const a = (acc[vend] = acc[vend] ?? zero());
    if (dia === hojeBRT) a.hoje += n;
    if (dia === ontemBRT) a.ontem += n;
    if (dia >= d7) a.semana += n;
    if (dia >= d15) a.quinzena += n;
    if (dia >= mesIni) a.mes += n;
  };

  // -- helpers: cada bloco é independente dos demais, então rodam em PARALELO.
  // Localmente (notebook → Supabase na nuvem) cada round-trip custa caro; em série
  // isso somava ~15-20s. Em paralelo o wall-clock cai pro maior bloco. Em produção
  // (Vercel colado no Supabase) também reduz a chance de estourar o timeout.

  // Paginação SEQUENCIAL dentro de cada bloco. O Supabase capa cada resposta em
  // 1000 linhas (max-rows), então precisa paginar. NÃO disparar as páginas em
  // paralelo: cada página re-executa a agregação inteira e a instância satura com
  // scans concorrentes (medido: 8 scans simultâneos -> 38s vs 10s sequencial).
  // O paralelismo fica no nível de BLOCO (Promise.all lá embaixo): no máximo ~2
  // queries pesadas concorrentes (card + funil), que a instância aguenta bem.

  // cards do funil (paginado, com fallback de colunas se migration pendente).
  const carregarCards = async (): Promise<any[]> => {
    let cols = COLS_FULL;
    const out: any[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from("vw_funil").select(cols)
        .order("ultima_atividade", { ascending: false, nullsFirst: false })
        .range(from, from + PAGE - 1);
      if (carteira) q = q.eq("vendedor", carteira);
      const { data, error } = await q;
      if (error) {
        if (cols === COLS_FULL && /venda_valor|venda_data/.test(error.message)) { cols = COLS_MSGS; from -= PAGE; continue; }
        if (cols !== COLS_BASE && /ultimas_mensagens/.test(error.message)) { cols = COLS_BASE; from -= PAGE; continue; }
        throw new Error(error.message);
      }
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  };

  // pedido emitido (paginado): 1 linha por cliente por período
  const carregarPedidoCards = async (): Promise<any[]> => {
    const out: any[] = [];
    for (let from = 0; ; from += PAGE) {
      let pcQ = sb.from("vw_pedido_emitido_card")
        .select("periodo,vendedor_slug,codcli,cliente,cliente_id,telefone,cliente_de_outra_carteira,pedidos,valor,ultima_compra,ultima_mensagem,ultima_mensagem_em")
        .range(from, from + PAGE - 1);
      pcQ = carteira ? pcQ.eq("vendedor_slug", carteira) : pcQ.in("vendedor_slug", slugs);
      const { data, error } = await pcQ;
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  };

  const carregarTemplates = async () => {
    let q = sb.from("vw_templates_diario").select("vendedor,dia,templates_enviados").gte("dia", desde);
    if (carteira) q = q.eq("vendedor", carteira);
    return (await q).data ?? [];
  };
  const carregarAuto = async () => {
    let q = sb.from("vw_templates_auto_diario").select("vendedor,dia,templates_automaticos").gte("dia", desde);
    if (carteira) q = q.eq("vendedor", carteira);
    return (await q).data ?? [];
  };
  const carregarDisparos = async () => {
    let q = sb.from("disparos_template").select("cliente_id,criada_em").order("criada_em", { ascending: false });
    if (carteira) q = q.eq("vendedor", carteira);
    return (await q).data ?? [];
  };
  // total de VENDAS = fonte oficial do ranking (vw_vendas_bi_total: data_emissao,
  // estados ativos, dedup por pedido, menos cancelados). Bate 100% com o ranking.
  const carregarTotais = async () => {
    let q = sb.from("vw_vendas_bi_total").select("vendedor_slug,periodo,clientes,vendas,total");
    q = carteira ? q.eq("vendedor_slug", carteira) : q.in("vendedor_slug", slugs);
    return (await q).data ?? [];
  };
  // ciclo de compra / oportunidades (motor preditivo espelhado da v2). ~1116 linhas.
  const carregarCiclo = async (): Promise<any[]> => {
    const out: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from("vw_ciclo_card")
        .select("codcli,cliente_id,telefone,tipo_oportunidade,pct_ciclo,score_urgencia,ciclo_medio,dias_ausente,tendencia,acao_recomendada")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  };

  // dispara os blocos independentes de uma vez
  let cards: any[], pcRows: any[], tpls: any[], autos: any[], disp: any[], tot: any[], ciclos: any[];
  try {
    [cards, pcRows, tpls, autos, disp, tot, ciclos] = await Promise.all([
      carregarCards(), carregarPedidoCards(), carregarTemplates(),
      carregarAuto(), carregarDisparos(), carregarTotais(), carregarCiclo(),
    ]);
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 500 });
  }

  // mapas de ciclo por identificador (cliente_id / codcli / telefone8)
  const cicloByCli = new Map<string, any>();
  const cicloByCod = new Map<number, any>();
  const cicloByTel = new Map<string, any>();
  const tel8c = (t: any) => String(t ?? "").replace(/\D/g, "").slice(-8);
  for (const r of ciclos) {
    const info = {
      tipo: r.tipo_oportunidade, pct_ciclo: r.pct_ciclo, score: r.score_urgencia,
      ciclo_medio: r.ciclo_medio, dias_ausente: r.dias_ausente, tendencia: r.tendencia, acao: r.acao_recomendada,
    };
    if (r.codcli != null) cicloByCod.set(Number(r.codcli), info);
    if (r.cliente_id) cicloByCli.set(r.cliente_id, info);
    const t = tel8c(r.telefone);
    if (t.length === 8) cicloByTel.set(t, info);
  }
  const cicloDe = (c: any): any => {
    const id = c.cliente_id;
    if (typeof id === "string") {
      if (id.startsWith("winthor:") || id.startsWith("venda:")) {
        const cc = Number(id.slice(id.indexOf(":") + 1));
        if (cicloByCod.has(cc)) return cicloByCod.get(cc);
      } else if (cicloByCli.has(id)) return cicloByCli.get(id);
    }
    const t = tel8c(c.telefone);
    if (t.length === 8 && cicloByTel.has(t)) return cicloByTel.get(t);
    return null;
  };

  const templatesTotais: Record<string, TplTot> = {};
  for (const t of tpls) bucket(templatesTotais, t.vendedor, t.dia, t.templates_enviados ?? 0);

  const templatesAutoTotais: Record<string, TplTot> = {};
  for (const t of autos) bucket(templatesAutoTotais, t.vendedor, t.dia, t.templates_automaticos ?? 0);

  // clientes que já receberam disparo de template (último por cliente) — p/ marcar "aguardando resposta"
  const disparos: Record<string, string> = {};
  for (const d of disp) {
    if (d.cliente_id && !disparos[d.cliente_id]) disparos[d.cliente_id] = d.criada_em;
  }

  // mapas por cliente_id e por TELEFONE (últimos 8) da vw_funil — pra religar a venda ao
  // contato quando o vínculo por CPF falha (contato sem CPF), e enriquecer o card.
  const funilByCliente: Record<string, any> = {};
  const funilByTel: Record<string, any> = {};
  const tel8 = (t: any) => String(t ?? "").replace(/\D/g, "").slice(-8);
  const ehReal = (id: any) => typeof id === "string" && !id.startsWith("winthor:") && !id.startsWith("venda:");
  for (const c of cards) {
    if (c.cliente_id) funilByCliente[c.cliente_id] = c;
    const t = tel8(c.telefone);
    if (t.length === 8 && ehReal(c.cliente_id)) funilByTel[t] = c; // só contato real de conversa
  }

  // telefone do WinThor por codcli das vendas (o card view vem sem telefone p/ não-vinculado)
  const saleCodclis = [...new Set(pcRows.map((r: any) => Number(r.codcli)).filter((x) => !isNaN(x)))];
  const telByCodcli: Record<number, string> = {};
  const lotes: number[][] = [];
  for (let i = 0; i < saleCodclis.length; i += 300) lotes.push(saleCodclis.slice(i, i + 300));
  const wcResults = await Promise.all(
    lotes.map((lote) => sb.from("wth_carteira").select("codcli,telefone").in("codcli", lote).then((r) => r.data ?? []))
  );
  for (const wc of wcResults) for (const w of wc) telByCodcli[Number(w.codcli)] = w.telefone;
  // cliente_id efetivo de uma linha de venda: vínculo CPF, senão contato com mesmo telefone
  const effCliId = (r: any): string | null =>
    r.cliente_id ?? (funilByTel[tel8(telByCodcli[Number(r.codcli)])]?.cliente_id ?? null);

  // === compradores do mês (fonte autoritativa: vw_pedido_emitido_card, periodo 'todos') ===
  // por identificador (cliente_id e/ou telefone8): data da última compra + valor do mês.
  const brDateOf = (iso: any) => (iso ? new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10) : null);
  const buyerCodclis = new Set<number>();
  const buyerCliIds = new Set<string>();
  const buyerCompra = new Map<string, string>(); // cliente_id -> data última compra (YYYY-MM-DD)
  const buyerValor = new Map<string, number>();   // cliente_id -> valor faturado no mês
  const buyerTel8 = new Map<string, { compra: string; valor: number }>(); // fallback por telefone
  // "comprou no mês" = período 'mes' (mês corrente). O valor do selo é o ACUMULADO
  // DO MÊS (soma das vendas do cliente no mês, independente de quem faturou), não o
  // histórico. Quem não comprou no mês não é reengajado e não ganha selo de valor.
  for (const r of pcRows ?? []) if (r.periodo === "mes") {
    if (r.codcli != null) buyerCodclis.add(Number(r.codcli));
    const compra = String(r.ultima_compra ?? "").slice(0, 10); // já é data (sem hora)
    const valor = +(r.valor ?? 0);
    const cid = effCliId(r);
    if (cid) {
      buyerCliIds.add(cid);
      const pc = buyerCompra.get(cid); if (!pc || compra > pc) buyerCompra.set(cid, compra);
      buyerValor.set(cid, (buyerValor.get(cid) ?? 0) + valor); // soma (pode ter +1 lançador)
    }
    const t = tel8(r.telefone ?? telByCodcli[Number(r.codcli)]);
    if (t.length === 8) {
      const prev = buyerTel8.get(t);
      buyerTel8.set(t, { compra: prev && prev.compra > compra ? prev.compra : compra, valor: (prev?.valor ?? 0) + valor });
    }
  }

  // dados da compra de um card (por cliente_id, senão por telefone) — null se não comprou
  const infoCompra = (c: any): { compra: string; valor: number } | null => {
    if (ehReal(c.cliente_id) && buyerCliIds.has(c.cliente_id)) {
      return { compra: buyerCompra.get(c.cliente_id) ?? "", valor: buyerValor.get(c.cliente_id) ?? 0 };
    }
    const t = tel8(c.telefone);
    if (t.length === 8 && buyerTel8.has(t)) return buyerTel8.get(t)!;
    return null;
  };
  // reengajado = comprador cujo card teve última atividade DEPOIS do dia da compra
  const ehReeng = (c: any): boolean => {
    const info = infoCompra(c);
    if (!info || !info.compra) return false;
    const d = brDateOf(c.ultima_atividade);
    return !!d && d > info.compra;
  };

  // cards das outras colunas = vw_funil (etapa da conversa), SEM pedido_emitido, SEM
  // comprador que NÃO reengajou (esse fica só em Pedido emitido), SEM prospecção já
  // vendida. Reengajados ficam e carregam o valor faturado do mês.
  const cardsOutros = cards.filter((c: any) => {
    if (c.etapa === "pedido_emitido") return false;
    if (typeof c.cliente_id === "string" && c.cliente_id.startsWith("winthor:")) {
      const cc = Number(c.cliente_id.slice(8));
      if (buyerCodclis.has(cc)) return false; // prospecção que já comprou
    }
    if (infoCompra(c) && !ehReeng(c)) return false; // comprou e não reengajou → só em Pedido emitido
    return true;
  });
  for (const c of cardsOutros) { // reengajado carrega o valor do mês (mesmo sem vínculo CPF) + ciclo de compra
    const info = infoCompra(c);
    if (info) c.venda_valor = info.valor;
    c.ciclo = cicloDe(c);
  }

  // reengajados saem da coluna Pedido emitido pra não duplicar (o valor foi pro card do funil)
  const reengCli = new Set<string>();
  const reengTel8 = new Set<string>();
  for (const c of cardsOutros) {
    if (!infoCompra(c)) continue; // só compradores (aqui já são reengajados)
    if (ehReal(c.cliente_id)) reengCli.add(c.cliente_id);
    const t = tel8(c.telefone);
    if (t.length === 8) reengTel8.add(t);
  }

  // cards de pedido_emitido (um por cliente por período), SEM os reengajados
  const pedidoCards = (pcRows ?? []).filter((r: any) => {
    const cid = effCliId(r);
    if (cid && reengCli.has(cid)) return false;
    const t = tel8(r.telefone ?? telByCodcli[Number(r.codcli)]);
    if (t.length === 8 && reengTel8.has(t)) return false;
    return true;
  }).map((r: any) => {
    const cid = effCliId(r);
    const key = cid ?? `venda:${r.codcli}`;
    const f = cid ? funilByCliente[cid] : null;
    return {
      cliente_id: key,
      cliente: r.cliente,
      vendedor: r.vendedor_slug,
      etapa: "pedido_emitido",
      periodo: r.periodo,
      pedidos: r.pedidos,
      cliente_de_outra_carteira: r.cliente_de_outra_carteira,
      venda_valor: r.valor,
      venda_data: r.ultima_compra,
      telefone: r.telefone ?? f?.telefone ?? null,
      ultima_atividade: f?.ultima_atividade ?? r.ultima_mensagem_em ?? null,
      ultima_mensagem: f?.ultima_mensagem ?? r.ultima_mensagem ?? null,
      ultima_enviada_por: f?.ultima_enviada_por ?? null,
      ultimas_mensagens: f?.ultimas_mensagens ?? null,
      ciclo: cicloDe({ cliente_id: key, telefone: r.telefone ?? f?.telefone ?? null }),
    };
  });

  // totais do cabeçalho por carteira e período (bruto, "quem lançou") — já carregado acima
  const vendasTotais: Record<string, Record<string, { total: number; vendas: number }>> = {};
  for (const t of tot) {
    (vendasTotais[t.vendedor_slug] = vendasTotais[t.vendedor_slug] ?? {})[t.periodo] = {
      total: +(t.total ?? 0), vendas: +(t.vendas ?? 0),
    };
  }

  return Response.json({
    cards: cardsOutros,
    pedidoCards,
    templatesTotais,
    templatesAutoTotais,
    disparos,
    vendasTotais,
    vendedores,
    dia: hojeBRT,
    atualizado_em: new Date().toISOString(),
  });
}
