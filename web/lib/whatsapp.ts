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

// ---------------------------------------------------------------------------
// MÍDIA
// ---------------------------------------------------------------------------

/** Metadados + binário de uma mídia recebida. */
export type MidiaBaixada = { bytes: ArrayBuffer; mime: string; tamanho: number };

/**
 * Baixa a mídia de uma mensagem recebida. São DUAS chamadas ao Graph: a primeira
 * troca o `media_id` por uma URL temporária, a segunda busca o binário (e também
 * exige o token — a URL sozinha não abre).
 *
 * O `media_id` expira (~30 dias), então o webhook baixa na hora que a mensagem
 * chega. `timeoutMs` existe porque o webhook precisa responder rápido: se a
 * Meta não receber 200 a tempo, ela reenvia o evento.
 */
export async function baixarMidia(mediaId: string, timeoutMs = 8000): Promise<MidiaBaixada> {
  const token = env("WHATSAPP_TOKEN");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const metaResp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    const meta: any = await metaResp.json().catch(() => ({}));
    if (!metaResp.ok || !meta?.url) {
      throw new Error(`Graph media ${metaResp.status}: ${meta?.error?.message ?? "sem url"}`);
    }
    const binResp = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (!binResp.ok) throw new Error(`download da mídia falhou: HTTP ${binResp.status}`);
    const bytes = await binResp.arrayBuffer();
    return {
      bytes,
      mime: String(meta.mime_type ?? binResp.headers.get("content-type") ?? "application/octet-stream"),
      tamanho: bytes.byteLength,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * phone_number_id da linha usada para ENVIAR hoje. Enquanto houver uma linha só,
 * vem da env; quando existirem várias (linha por vendedor), este é o ponto único
 * a trocar por uma escolha por conversa.
 */
export function linhaDeEnvio(): string | null {
  const v = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return v ? v.replace(/[^\x21-\x7E]/g, "") : null;
}

/** Categoria de mídia que a Cloud API aceita, deduzida do mime do arquivo. */
export function tipoDoMime(mime: string): "image" | "audio" | "video" | "document" {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "document";
}

/**
 * Envia mídia: primeiro sobe o arquivo (vira um `media_id` na Meta), depois manda
 * a mensagem referenciando esse id. Como texto livre, só funciona dentro da janela
 * de 24h — `foraDaJanela` é sinalizado igual ao sendText.
 */
export async function sendMedia(
  to: string, arquivo: ArrayBuffer | Uint8Array, mime: string, nome: string, legenda?: string,
): Promise<EnvioOk> {
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const token = env("WHATSAPP_TOKEN");

  // aceita ArrayBuffer ou view (o remux de áudio devolve Uint8Array); a cópia
  // recorta exatamente os bytes da view, sem carregar o buffer inteiro junto
  const binario: ArrayBuffer = arquivo instanceof ArrayBuffer
    ? arquivo
    : (arquivo.buffer.slice(arquivo.byteOffset, arquivo.byteOffset + arquivo.byteLength) as ArrayBuffer);

  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", mime);
  form.set("file", new Blob([binario], { type: mime }), nome);

  const up = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const upBody: any = await up.json().catch(() => ({}));
  if (!up.ok || !upBody?.id) {
    throw new Error(`upload da mídia falhou: ${upBody?.error?.message ?? `HTTP ${up.status}`}`);
  }

  const tipo = tipoDoMime(mime);
  // legenda: só imagem, vídeo e documento aceitam; áudio não
  const conteudo: Record<string, unknown> = { id: upBody.id };
  if (legenda && tipo !== "audio") conteudo.caption = legenda;
  if (tipo === "document") conteudo.filename = nome;

  return post({ to, type: tipo, [tipo]: conteudo });
}

/** Extensão de arquivo a partir do mime — só para o nome no Storage ficar legível. */
export function extensaoDoMime(mime: string): string {
  const mapa: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr", "audio/aac": "aac",
    "video/mp4": "mp4", "video/3gpp": "3gp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  const limpo = mime.split(";")[0].trim().toLowerCase();
  if (mapa[limpo]) return mapa[limpo];
  const sub = limpo.split("/")[1] ?? "bin";
  return sub.replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
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
