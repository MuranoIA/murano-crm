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

  // cards do funil (escopo por carteira quando não-admin)
  let funilQ = sb
    .from("vw_funil")
    .select("cliente_id,cliente,vendedor,etapa,ultima_atividade,ultima_mensagem,ultima_enviada_por")
    .order("ultima_atividade", { ascending: false })
    .limit(5000);
  if (carteira) funilQ = funilQ.eq("vendedor", carteira);
  const { data: cards, error } = await funilQ;
  if (error) return Response.json({ error: error.message }, { status: 500 });

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
