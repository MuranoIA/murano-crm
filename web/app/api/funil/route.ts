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
  const COLS_COM_MSGS = "cliente_id,cliente,vendedor,etapa,ultima_atividade,ultima_mensagem,ultima_enviada_por,telefone,ultimas_mensagens";
  const COLS_BASE = "cliente_id,cliente,vendedor,etapa,ultima_atividade,ultima_mensagem,ultima_enviada_por,telefone";
  // usa a coluna nova ultimas_mensagens (migration 0005); se ela ainda não existe,
  // cai pro conjunto base sem quebrar o board (o front tem fallback pra 1 mensagem).
  let cols = COLS_COM_MSGS;
  const cards: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("vw_funil").select(cols)
      .order("ultima_atividade", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (carteira) q = q.eq("vendedor", carteira);
    const { data, error } = await q;
    if (error) {
      if (cols === COLS_COM_MSGS && /ultimas_mensagens/.test(error.message)) {
        cols = COLS_BASE; from -= PAGE; continue; // 0005 pendente -> refaz esta página sem a coluna
      }
      return Response.json({ error: error.message }, { status: 500 });
    }
    cards.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // templates disparados HOJE (fuso Brasília), por vendedor
  const hojeBRT = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  let tplQ = sb.from("vw_templates_diario").select("vendedor,templates_enviados").eq("dia", hojeBRT);
  if (carteira) tplQ = tplQ.eq("vendedor", carteira);
  const { data: tpls } = await tplQ;
  const templatesHoje: Record<string, number> = {};
  for (const t of tpls ?? []) templatesHoje[t.vendedor] = t.templates_enviados ?? 0;

  // templates automáticos (disparados pelo botão) hoje — resiliente se a view ainda não existir
  let autoQ = sb.from("vw_templates_auto_diario").select("vendedor,templates_automaticos").eq("dia", hojeBRT);
  if (carteira) autoQ = autoQ.eq("vendedor", carteira);
  const { data: autos } = await autoQ;
  const templatesAutoHoje: Record<string, number> = {};
  for (const t of autos ?? []) templatesAutoHoje[t.vendedor] = t.templates_automaticos ?? 0;

  // clientes que já receberam disparo de template (último por cliente) — p/ marcar "aguardando resposta"
  let dispQ = sb.from("disparos_template").select("cliente_id,criada_em").order("criada_em", { ascending: false });
  if (carteira) dispQ = dispQ.eq("vendedor", carteira);
  const { data: disp } = await dispQ;
  const disparos: Record<string, string> = {};
  for (const d of disp ?? []) {
    if (d.cliente_id && !disparos[d.cliente_id]) disparos[d.cliente_id] = d.criada_em;
  }

  return Response.json({
    cards: cards ?? [],
    templatesHoje,
    templatesAutoHoje,
    disparos,
    dia: hojeBRT,
    atualizado_em: new Date().toISOString(),
  });
}
