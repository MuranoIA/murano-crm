import { sbAdmin, guardaAdmin } from "../../../../lib/adminApi";
import { diagnosticar } from "../../../../lib/saudeCanal";
import { envWa, linhaDeEnvio } from "../../../../lib/whatsapp";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Diagnóstico do canal, sob demanda.
//
// A faixa do board usa só o banco (barato, roda a cada 60s). Aqui vai à Graph
// API, porque é ela que sabe a causa que já nos deixou mudos por horas: o app
// **não estava inscrito** na WABA (§28.3). Nenhum sintoma no nosso lado dizia
// isso — só `subscribed_apps` vazio.
//
// Duas perguntas, uma resposta cada:
//   1. o nosso app está inscrito nesta WABA?   -> é por onde a mensagem entra
//   2. a Meta considera esta linha apta?       -> `health_status`
//
// ⚠️ Isto NÃO tenta consertar. Inscrever o app é um POST que altera a conta, e
// a rota que faz isso (`/api/whatsapp/diag`) tem allowlist justamente para não
// escrever em conta errada. Diagnóstico e conserto são gestos separados.
// ---------------------------------------------------------------------------

const GRAPH = "v23.0";

async function graph(caminho: string, token: string): Promise<any> {
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${caminho}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
  return j;
}

export async function GET() {
  const g = guardaAdmin("ver a saúde do canal");
  if (g.erro) return g.erro;

  const sb = sbAdmin();
  const linha = linhaDeEnvio();
  const banco = await diagnosticar(sb, linha).catch(() => null);

  let token: string, waba: string, numero: string;
  try {
    token = envWa("WHATSAPP_TOKEN");
    waba = envWa("WHATSAPP_WABA_ID");
    numero = envWa("WHATSAPP_PHONE_NUMBER_ID");
  } catch (e: any) {
    return Response.json({
      banco,
      meta: { erro: `${e?.message ?? e}. Sem isso o diagnóstico profundo não roda.` },
    });
  }

  const meta: any = {};
  // Cada checagem falha por conta própria: se a primeira der erro de permissão,
  // a segunda ainda pode responder — e saber qual das duas quebrou É o
  // diagnóstico.
  try {
    const j = await graph(`${waba}/subscribed_apps`, token);
    const apps = (j?.data ?? []).map((a: any) => a?.whatsapp_business_api_data?.name ?? "(sem nome)");
    meta.inscrito = apps.length > 0;
    meta.apps = apps;
  } catch (e: any) { meta.inscrito_erro = String(e?.message ?? e); }

  try {
    const j = await graph(`${numero}?fields=health_status,account_mode,verified_name,quality_rating`, token);
    meta.numero = { nome: j?.verified_name, modo: j?.account_mode, qualidade: j?.quality_rating };
    const ent = j?.health_status?.entities ?? [];
    meta.pode_enviar = ent
      .filter((x: any) => x?.can_send_message && x.can_send_message !== "AVAILABLE")
      .map((x: any) => ({ o_que: x.entity_type, situacao: x.can_send_message, erros: x.errors ?? [] }));
    meta.saudavel = (meta.pode_enviar ?? []).length === 0;
  } catch (e: any) { meta.numero_erro = String(e?.message ?? e); }

  // O veredito em uma frase, para a tela não ter de reinterpretar os campos.
  let vereditos: string[] = [];
  if (meta.inscrito === false) {
    vereditos.push(
      "O app NÃO está inscrito nesta conta do WhatsApp — nenhuma mensagem chega e nenhum recibo volta. " +
      "É a causa exata do episódio de 24/08. Inscrever é um POST em subscribed_apps.");
  }
  if (meta.inscrito_erro) vereditos.push(`Não consegui checar a inscrição: ${meta.inscrito_erro}`);
  if (meta.numero_erro) vereditos.push(`Não consegui ler o número na Meta: ${meta.numero_erro}`);
  if (meta.saudavel === false) {
    vereditos.push("A Meta marcou esta linha como impedida de enviar — veja os itens abaixo.");
  }
  if (!vereditos.length && banco?.estado === "mudo") {
    vereditos.push(
      "A Meta diz que está tudo certo, mas há mensagens sem confirmação: o problema pode estar na " +
      "URL do webhook ou no campo `messages` deixar de estar assinado no painel do app.");
  }
  if (!vereditos.length) vereditos.push("Nenhum problema encontrado no canal.");

  return Response.json({ banco, meta, veredito: vereditos, linha });
}
