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

  // totais de venda REAL (nota fiscal WinThor, por RCA) por período — coluna Pedido Emitido.
  // R$ + qtd de notas. resiliente: se a view (0008) não existir, tenta a antiga (0007), senão {}.
  type VT = { hoje: number; ontem: number; semana: number; quinzena: number; mes: number;
              qHoje: number; qOntem: number; qSemana: number; qQuinzena: number; qMes: number };
  const vendasTotais: Record<string, VT> = {};
  let totQ = sb.from("vw_vendas_totais").select("*");
  if (carteira) totQ = totQ.eq("carteira", carteira);
  let { data: tot, error: totErr } = await totQ;
  if (totErr) { // fallback 0007 (contato-matched, sem ontem/qtd)
    let old = sb.from("vw_pedido_emitido_totais").select("*");
    if (carteira) old = old.eq("carteira", carteira);
    const r = await old; tot = r.data as any;
    for (const t of tot ?? []) vendasTotais[t.carteira] = {
      hoje: +(t.total_hoje ?? 0), ontem: 0, semana: +(t.total_semana ?? 0), quinzena: +(t.total_quinzena ?? 0), mes: +(t.total_mes ?? 0),
      qHoje: +(t.qtd_hoje ?? 0), qOntem: 0, qSemana: +(t.qtd_semana ?? 0), qQuinzena: +(t.qtd_quinzena ?? 0), qMes: +(t.qtd_mes ?? 0),
    };
  } else {
    for (const t of tot ?? []) vendasTotais[t.carteira] = {
      hoje: +(t.total_hoje ?? 0), ontem: +(t.total_ontem ?? 0), semana: +(t.total_semana ?? 0), quinzena: +(t.total_quinzena ?? 0), mes: +(t.total_mes ?? 0),
      qHoje: +(t.qtd_hoje ?? 0), qOntem: +(t.qtd_ontem ?? 0), qSemana: +(t.qtd_semana ?? 0), qQuinzena: +(t.qtd_quinzena ?? 0), qMes: +(t.qtd_mes ?? 0),
    };
  }

  return Response.json({
    cards: cards ?? [],
    templatesTotais,
    templatesAutoTotais,
    disparos,
    vendasTotais,
    dia: hojeBRT,
    atualizado_em: new Date().toISOString(),
  });
}
