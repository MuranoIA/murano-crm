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

import { deveSimular, wamidSimulado } from "./simulacaoEnvio";

const GRAPH_VERSION = "v22.0";

import { tipoDoMime, extensaoDoMime } from "./midia";

// As regras de mídia (tipo, extensão, limites) moram em `lib/midia.ts`, que a TELA
// também importa — este módulo lê o token da Meta e não pode ir para o navegador.
// Reexportado para quem já importava daqui; a definição continua sendo uma só.
export { tipoDoMime, extensaoDoMime } from "./midia";

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
 * Regra completa de roteamento de resposta.
 *
 * ORDEM DE PRECEDÊNCIA — a primeira que responder ganha:
 *
 *  1. **A escolha do admin** (`crm_config.numero_envio`, 0102). Quando existe,
 *     ela vale para TODO contato: mensagem, template e ligação saem pelo número
 *     escolhido, independente de onde a conversa nasceu. É a decisão que o
 *     usuário pediu em 25/08 — *"quando abrir a janela de conversa, mensagens,
 *     templates, ligação, isso deve ocorrer para o número que estiver
 *     previamente setado no painel administrativo"*.
 *
 *  2. `wa:*` — contato que só existe do nosso lado; o RD não o conhece.
 *     Sobrepõe até o item 1 com 'rd' escolhido, porque enviar pelo RD a um
 *     contato que ele não tem é falha garantida (a rota de mensagem livre
 *     endereça pelo `_id` do RD). Melhor sair pela Cloud do que não sair.
 *
 *  3. O canal em que o CLIENTE falou por último (id `wamid.*` = Cloud). É o
 *     roteamento automático da transição (§16.3), e segue valendo enquanto
 *     nenhuma escolha estiver feita no /admin.
 */
export async function canalDeResposta(
  sb: { from: (t: string) => any },
  clienteId: string,
): Promise<"whatsapp" | "rd"> {
  // 2 antes de 1: contato `wa:` não existe no RD, então nem a escolha do admin
  // consegue mandar por lá. Ver o comentário de precedência acima.
  if (clienteId.startsWith("wa:")) return "whatsapp";

  const { data: cfg } = await sb
    .from("crm_config").select("numero_envio").eq("id", 1).maybeSingle();
  if (cfg?.numero_envio === "rd") return "rd";
  if (cfg?.numero_envio === "cloud") return "whatsapp";

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

/**
 * Env obrigatória, já higienizada. Exportada porque a limpeza NÃO é detalhe: um
 * caractere invisível colado no token na Vercel devolve Graph 190 com token
 * válido — armadilha já paga uma vez (§16.4). Uma implementação só, usada
 * também pelo cliente de ligação (lib/whatsappCalling.ts).
 */
export function envWa(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Config ausente: ${nome}`);
  // remove qualquer caractere fora do ASCII imprimível (espaço/quebra de linha
  // colados junto do valor na Vercel) — mesma limpeza que as rotas do RD fazem.
  return v.replace(/[^\x21-\x7E]/g, "");
}
const env = envWa;

async function post(payload: Record<string, unknown>): Promise<EnvioOk> {
  // Ensaio de carga: nada sai para quem nao esta na lista de destinos reais.
  // Fica ANTES de ler as envs de proposito — assim o ensaio roda mesmo numa
  // maquina sem WHATSAPP_TOKEN, que e a rede de protecao mais barata que existe.
  if (deveSimular(String((payload as any).to ?? ""))) return { wamid: wamidSimulado() };

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
    // `||` e não `??`: a Meta manda `details` como string VAZIA em vários erros,
    // e `??` só cai adiante em null/undefined — a string vazia venceria e a
    // explicação real (`error_user_msg`) seria descartada. Custou horas uma vez.
    const e = body?.error ?? {};
    const detalhe = [e.error_data?.details, e.error_user_msg, e.message]
      .map((p: unknown) => String(p ?? "").trim()).find(Boolean) ?? `HTTP ${r.status}`;
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

/**
 * Localização — chega como um cartão de mapa, com o pino já no lugar.
 *
 * `name` e `address` são opcionais para a Meta, mas não para quem recebe: sem
 * eles o cartão mostra um pino sem nome, e a cliente não sabe se aquilo é a
 * loja, o depósito ou um endereço qualquer.
 *
 * Só dentro da janela de 24h, como qualquer mensagem livre.
 */
export function sendLocation(
  to: string,
  loc: { lat: number; lng: number; nome?: string; endereco?: string },
): Promise<EnvioOk> {
  return post({
    to, type: "location",
    location: {
      latitude: loc.lat, longitude: loc.lng,
      ...(loc.nome ? { name: loc.nome } : {}),
      ...(loc.endereco ? { address: loc.endereco } : {}),
    },
  });
}

/**
 * PEDE a localização atual da cliente (0115).
 *
 * É a resposta possível para "localização em tempo real". A live location do
 * WhatsApp — aquela que fica atualizando sozinha por 15 minutos, 1 hora ou 8 —
 * **não existe nesta API**: a referência de webhook da Meta para `location`
 * descreve só o pino estático, e a documentação de BSP afirma que a Business
 * API não recebe live location. Verificado em 27/08/2026.
 *
 * O que dá para fazer é PERGUNTAR. Isto manda um botão; a cliente toca, o
 * aparelho abre a tela de compartilhar, e a posição do momento volta como um
 * `location` comum no webhook — com `context.id` apontando para este pedido.
 *
 * Diferença que a tela precisa deixar clara: é **sob demanda**, não contínuo.
 * Quem quiser acompanhar alguém se deslocando vai ter de pedir de novo.
 *
 * Mensagem livre: vale a janela de 24h como qualquer outra.
 */
export function sendLocationRequest(to: string, texto: string): Promise<EnvioOk> {
  return post({
    to, type: "interactive",
    interactive: {
      type: "location_request_message",
      // 1024 é o teto da Meta para o corpo; cortar aqui evita o 131009 que só
      // apareceria depois do clique
      body: { text: String(texto ?? "").slice(0, 1024) },
      action: { name: "send_location" },
    },
  });
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


/**
 * Envia mídia: primeiro sobe o arquivo (vira um `media_id` na Meta), depois manda
 * a mensagem referenciando esse id. Como texto livre, só funciona dentro da janela
 * de 24h — `foraDaJanela` é sinalizado igual ao sendText.
 */
export async function sendMedia(
  to: string, arquivo: ArrayBuffer | Uint8Array, mime: string, nome: string, legenda?: string,
): Promise<EnvioOk> {
  // Aqui a guarda precisa vir antes do UPLOAD, nao so do post(): subir o
  // arquivo para a Meta ja e uma chamada de rede e ja consome cota.
  if (deveSimular(to)) return { wamid: wamidSimulado() };

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
