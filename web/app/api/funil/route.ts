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
  let cols = COLS_FULL;
  const cards: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("vw_funil").select(cols)
      .order("ultima_atividade", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (carteira) q = q.eq("vendedor", carteira);
    const { data, error } = await q;
    if (error) {
      if (cols === COLS_FULL && /venda_valor|venda_data/.test(error.message)) {
        cols = COLS_MSGS; from -= PAGE; continue; // 0006 pendente
      }
      if (cols !== COLS_BASE && /ultimas_mensagens/.test(error.message)) {
        cols = COLS_BASE; from -= PAGE; continue; // 0005 pendente
      }
      return Response.json({ error: error.message }, { status: 500 });
    }
    cards.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // templates por PERÍODO (fuso Brasília), por vendedor. Busca os últimos ~31 dias das
  // views diárias e agrega em buckets hoje/ontem/semana/quinzena/mês.
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

  let tplQ = sb.from("vw_templates_diario").select("vendedor,dia,templates_enviados").gte("dia", desde);
  if (carteira) tplQ = tplQ.eq("vendedor", carteira);
  const { data: tpls } = await tplQ;
  const templatesTotais: Record<string, TplTot> = {};
  for (const t of tpls ?? []) bucket(templatesTotais, t.vendedor, t.dia, t.templates_enviados ?? 0);

  let autoQ = sb.from("vw_templates_auto_diario").select("vendedor,dia,templates_automaticos").gte("dia", desde);
  if (carteira) autoQ = autoQ.eq("vendedor", carteira);
  const { data: autos } = await autoQ;
  const templatesAutoTotais: Record<string, TplTot> = {};
  for (const t of autos ?? []) bucket(templatesAutoTotais, t.vendedor, t.dia, t.templates_automaticos ?? 0);

  // clientes que já receberam disparo de template (último por cliente) — p/ marcar "aguardando resposta"
  let dispQ = sb.from("disparos_template").select("cliente_id,criada_em").order("criada_em", { ascending: false });
  if (carteira) dispQ = dispQ.eq("vendedor", carteira);
  const { data: disp } = await dispQ;
  const disparos: Record<string, string> = {};
  for (const d of disp ?? []) {
    if (d.cliente_id && !disparos[d.cliente_id]) disparos[d.cliente_id] = d.criada_em;
  }

  // ===== PEDIDO EMITIDO: vem das views oficiais de faturamento (bruto, "quem lançou") =====
  // vw_pedido_emitido_card: 1 linha por cliente por período. vw_pedido_emitido_total: cabeçalho.
  const pcRows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let pcQ = sb.from("vw_pedido_emitido_card")
      .select("periodo,vendedor_slug,codcli,cliente,cliente_id,telefone,cliente_de_outra_carteira,pedidos,valor,ultima_compra,ultima_mensagem,ultima_mensagem_em")
      .range(from, from + PAGE - 1);
    // funil só cobre as 3 carteiras ISR; as views têm a empresa inteira ("quem lançou")
    pcQ = carteira ? pcQ.eq("vendedor_slug", carteira) : pcQ.in("vendedor_slug", slugs);
    const { data, error } = await pcQ;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    pcRows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
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
  for (let i = 0; i < saleCodclis.length; i += 300) {
    const { data: wc } = await sb.from("wth_carteira").select("codcli,telefone").in("codcli", saleCodclis.slice(i, i + 300));
    for (const w of wc ?? []) telByCodcli[Number(w.codcli)] = w.telefone;
  }
  // cliente_id efetivo de uma linha de venda: vínculo CPF, senão contato com mesmo telefone
  const effCliId = (r: any): string | null =>
    r.cliente_id ?? (funilByTel[tel8(telByCodcli[Number(r.codcli)])]?.cliente_id ?? null);

  // quem comprou no mês (periodo 'todos') — pra tirar das OUTRAS colunas
  const buyerCliIds = new Set<string>();
  const buyerCodclis = new Set<number>();
  for (const r of pcRows ?? []) if (r.periodo === "todos") {
    const cid = effCliId(r);
    if (cid) buyerCliIds.add(cid);
    if (r.codcli != null) buyerCodclis.add(Number(r.codcli));
  }

  // cards das outras colunas = vw_funil, SEM pedido_emitido e SEM quem comprou
  const cardsOutros = cards.filter((c: any) => {
    if (c.etapa === "pedido_emitido") return false; // pedido vem das views novas
    if (c.cliente_id && buyerCliIds.has(c.cliente_id)) return false; // comprador sai das outras colunas
    if (typeof c.cliente_id === "string" && c.cliente_id.startsWith("winthor:")) {
      const cc = Number(c.cliente_id.slice(8));
      if (buyerCodclis.has(cc)) return false; // prospecção que já comprou
    }
    return true;
  });

  // cards de pedido_emitido (um por cliente por período), formato Card + periodo/pedidos
  const pedidoCards = (pcRows ?? []).map((r: any) => {
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
    };
  });

  // totais do cabeçalho por carteira e período (bruto, "quem lançou")
  const vendasTotais: Record<string, Record<string, { total: number; vendas: number }>> = {};
  let totQ = sb.from("vw_pedido_emitido_total").select("vendedor_slug,periodo,clientes,vendas,total");
  totQ = carteira ? totQ.eq("vendedor_slug", carteira) : totQ.in("vendedor_slug", slugs);
  const { data: tot } = await totQ;
  for (const t of tot ?? []) {
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
