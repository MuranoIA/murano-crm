// Cliente da WhatsApp Cloud API (Graph API da Meta) — o substituto direto dos
// endpoints de envio do RD Conversas (/v2/messages/{id}/send e envio de template).
//
// Regras da plataforma que o funil já modela e aqui viram erro explícito:
// - Mensagem LIVRE (sendText) só é aceita dentro da janela de 24h desde a última
//   mensagem do cliente. Fora dela o Graph responde erro 131047 — o chamador deve
//   oferecer o envio de template no lugar.
// - TEMPLATE (sendTemplate) pode a qualquer momento, mas o template precisa estar
//   aprovado no Gerenciador do WhatsApp (Meta Business Manager).
//
// Após o envio, o webhook (app/api/whatsapp/webhook) recebe os statuses
// (sent/delivered/read) e atualiza a linha em `mensagens` pelo wamid.

const GRAPH_VERSION = "v22.0";

/**
 * Decide o canal de ENVIO de um cliente durante a transição RD → Cloud API.
 * - `wa:<numero>`: contato que nasceu no canal direto (o RD nem o conhece) → whatsapp.
 * - demais: RD Conversas (comportamento atual do board), até o interruptor
 *   WHATSAPP_ENVIO_PADRAO=true ser ligado na Vercel (dia da migração do número —
 *   vira o canal padrão sem precisar de deploy).
 * O RECEBIMENTO não passa por aqui: o webhook grava tudo que chegar, sempre.
 */
export function canalDoCliente(clienteId: string): "whatsapp" | "rd" {
  if (clienteId.startsWith("wa:")) return "whatsapp";
  return process.env.WHATSAPP_ENVIO_PADRAO === "true" ? "whatsapp" : "rd";
}

/**
 * Regra completa de roteamento de resposta: além de canalDoCliente(), responde
 * pelo canal em que o CLIENTE falou por último — se a última mensagem recebida
 * dele tem id `wamid.*` (chegou pelo webhook da Cloud API), a resposta volta
 * pela Cloud API; senão, RD. Durante a transição isso roteia cada conversa
 * sozinho, sem configuração por cliente.
 */
export async function canalDeResposta(
  sb: { from: (t: string) => any },
  clienteId: string,
): Promise<"whatsapp" | "rd"> {
  if (canalDoCliente(clienteId) === "whatsapp") return "whatsapp";
  const { data } = await sb
    .from("mensagens")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("enviada_por", "customer")
    .order("criada_em", { ascending: false })
    .limit(1);
  return typeof data?.[0]?.id === "string" && data[0].id.startsWith("wamid") ? "whatsapp" : "rd";
}

type EnvioOk = { wamid: string };

function env(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Config ausente: ${nome}`);
  // remove qualquer caractere fora do ASCII imprimível (espaço/quebra de linha
  // colados junto do valor na Vercel) — mesma limpeza que as rotas do RD fazem.
  return v.replace(/[^\x21-\x7E]/g, "");
}

async function post(payload: Record<string, unknown>): Promise<EnvioOk> {
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const token = env("WHATSAPP_TOKEN");
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = body?.error?.code;
    const detalhe = body?.error?.error_data?.details ?? body?.error?.message ?? `HTTP ${r.status}`;
    // 131047 = fora da janela de 24h — erro de negócio, não de infra
    const err: any = new Error(`Graph ${code ?? r.status}: ${detalhe}`);
    err.foraDaJanela = code === 131047;
    err.graphCode = code;
    throw err;
  }
  const wamid = body?.messages?.[0]?.id;
  if (!wamid) throw new Error("Graph respondeu ok mas sem wamid");
  return { wamid };
}

/** Mensagem de texto livre — só dentro da janela de 24h. `to` = telefone E.164 sem '+' (ex.: 5591981959789). */
export function sendText(to: string, texto: string): Promise<EnvioOk> {
  return post({ to, type: "text", text: { body: texto, preview_url: false } });
}

/** Template aprovado. `components` segue o formato do Graph (body params etc.); omitir se o template não tem variáveis. */
export function sendTemplate(
  to: string,
  nomeTemplate: string,
  idioma = "pt_BR",
  components?: unknown[],
): Promise<EnvioOk> {
  return post({
    to,
    type: "template",
    template: {
      name: nomeTemplate,
      language: { code: idioma },
      ...(components ? { components } : {}),
    },
  });
}
