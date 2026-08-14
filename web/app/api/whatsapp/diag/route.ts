import { cookies } from "next/headers";
import { podeAdmin } from "../../../../lib/papel";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Diagnóstico e configuração da conexão app <-> WABA. TEMPORÁRIA.
//
// Existe para responder, sem ninguém manusear token, duas perguntas que só a
// Meta sabe: (1) quais números o nosso app enxerga e qual o `phone_number_id`
// de cada um; (2) o app está inscrito para receber os webhooks daquela WABA?
// E para AGIR na segunda: inscrever o app na WABA.
//
// Usa o WHATSAPP_TOKEN que já está na Vercel — o mesmo do envio. Portanto só
// consegue enxergar/alterar WABAs atribuídas ao usuário do sistema dono do
// token; associar a WABA ao usuário do sistema é passo de ADMIN do portfólio,
// fora do alcance deste token (e desta rota).
//
// Protegida por sessão de admin do CRM. REMOVER quando a Fase C fechar.
// ---------------------------------------------------------------------------
const GRAPH = "v22.0";

function token(): string | null {
  const t = process.env.WHATSAPP_TOKEN;
  return t ? t.replace(/[^\x21-\x7E]/g, "") : null;
}

async function graph(caminho: string, metodo: "GET" | "POST" = "GET") {
  const t = token();
  if (!t) return { erro: "WHATSAPP_TOKEN ausente na Vercel" };
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${t}` },
  });
  const body = await r.json().catch(() => ({}));
  return r.ok ? body : { erro: body?.error?.message ?? `HTTP ${r.status}`, codigo: body?.error?.code ?? null };
}

// GET /api/whatsapp/diag[?waba=<id>]
// Sem `waba`, usa WHATSAPP_WABA_ID. Devolve os números da conta (com o id que
// precisamos para a env) e as inscrições de webhook vigentes.
export async function GET(req: Request) {
  if (!podeAdmin(cookies().get("crm_sessao")?.value)) {
    return Response.json({ error: "só admin" }, { status: 403 });
  }
  const waba = new URL(req.url).searchParams.get("waba") || process.env.WHATSAPP_WABA_ID;
  if (!waba) return Response.json({ error: "informe ?waba=<id> ou configure WHATSAPP_WABA_ID" }, { status: 400 });

  const [numeros, inscritos, conta] = await Promise.all([
    graph(`${waba}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type`),
    graph(`${waba}/subscribed_apps`),
    graph(`${waba}?fields=id,name,currency,timezone_id,message_template_namespace`),
  ]);

  return Response.json({
    waba_consultada: waba,
    linha_de_envio_atual: process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
    conta,
    numeros,
    apps_inscritos_no_webhook: inscritos,
    dica: "o phone_number_id do número desejado é `numeros.data[].id`; se `apps_inscritos_no_webhook` não listar o nosso app, chame este endpoint com POST para inscrever",
  });
}

// POST /api/whatsapp/diag  { waba?: string }
// Inscreve o NOSSO app (o dono do token) para receber os webhooks da WABA.
// Aditivo e reversível: não move número, não remove parceiro, não mexe em
// outros apps já inscritos.
export async function POST(req: Request) {
  if (!podeAdmin(cookies().get("crm_sessao")?.value)) {
    return Response.json({ error: "só admin" }, { status: 403 });
  }
  let waba: string | undefined;
  try {
    ({ waba } = await req.json());
  } catch { /* body opcional */ }
  const alvo = waba || process.env.WHATSAPP_WABA_ID;
  if (!alvo) return Response.json({ error: "informe {waba} ou configure WHATSAPP_WABA_ID" }, { status: 400 });

  const resultado = await graph(`${alvo}/subscribed_apps`, "POST");
  const depois = await graph(`${alvo}/subscribed_apps`);
  return Response.json({ waba: alvo, resultado, apps_inscritos_agora: depois });
}
