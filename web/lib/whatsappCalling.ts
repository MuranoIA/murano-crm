// Cliente da WhatsApp Business Calling API (voz sobre a Cloud API da Meta).
//
// O QUE É: o mesmo número da Cloud API que já troca mensagens passa a receber e
// originar CHAMADAS DE VOZ. O áudio corre por WebRTC direto entre o navegador do
// vendedor e a infraestrutura da Meta — o nosso servidor só faz a SINALIZAÇÃO
// (troca de SDP e comandos de atender/recusar/desligar).
//
// ⚠️ A ASSIMETRIA QUE GOVERNA TODO O DESENHO: a resposta HTTP do Graph confirma
// que o comando foi aceito, mas o SDP da outra ponta chega DEPOIS, pelo WEBHOOK.
// São dois processos diferentes (uma função serverless responde ao Graph; outra
// recebe o webhook), e nenhum dos dois é a aba do navegador que está com o
// microfone aberto. A ponte é a tabela `chat_ligacao` (migration 0087) mais o
// broadcast do Realtime. Não existe caminho "await" para isso.
//
// PRÉ-REQUISITOS NA META (nada disso é código — ver §22 do CLAUDE.md):
//   1. o número precisa estar na Cloud API (o oficial ainda está no RD/Tallos);
//   2. a WABA precisa de limite de mensagens >= 2.000/24h;
//   3. calling tem de ser LIGADO em /PHONE_NUMBER_ID/settings (não vem ligado);
//   4. o app tem de assinar o campo `calls` no webhook (assinar `messages` não
//      basta — é a mesma armadilha nº 3 da §16.4, agora para chamadas).
//
// LIMITE DE CHAMADA INICIADA PELO NEGÓCIO: exige permissão do cliente — 1 por
// dia e 2 por semana por par (número, cliente). Cliente que liga para nós
// concede a permissão automaticamente. Brasil permite chamada iniciada pelo
// negócio (EUA, Canadá, Egito, Vietnã e Nigéria não).
import { envWa } from "./whatsapp";

// A Calling API não existe na v22.0 que o envio de mensagens usa. Constante
// separada de propósito: subir a versão das MENSAGENS (§16.5 item 4) é uma
// mudança com risco próprio e não deve ser arrastada por esta.
const GRAPH_CALLING = "v23.0";

export type Sdp = { sdp_type: "offer" | "answer"; sdp: string };
export type AcaoLigacao = "connect" | "pre_accept" | "accept" | "reject" | "terminate";

export class GraphCallingError extends Error {
  codigo: number | null;
  subcodigo: number | null;
  /** true quando o cliente não autorizou (ou já gastou) a permissão de receber ligação nossa */
  semPermissao: boolean;
  constructor(mensagem: string, codigo: number | null, subcodigo: number | null) {
    super(mensagem);
    this.name = "GraphCallingError";
    this.codigo = codigo;
    this.subcodigo = subcodigo;
    // 138000/138002 = permissão ausente ou esgotada no par negócio↔cliente
    this.semPermissao = codigo === 138000 || codigo === 138002;
  }
}

async function graph(caminho: string, init: RequestInit): Promise<any> {
  const token = envWa("WHATSAPP_TOKEN");
  const r = await fetch(`https://graph.facebook.com/${GRAPH_CALLING}/${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = body?.error ?? {};
    throw new GraphCallingError(
      `Graph ${e.code ?? r.status}: ${e.error_data?.details ?? e.message ?? `HTTP ${r.status}`}`,
      typeof e.code === "number" ? e.code : null,
      typeof e.error_subcode === "number" ? e.error_subcode : null,
    );
  }
  return body;
}

/** phone_number_id da linha que origina/atende chamadas hoje (mesma env do envio). */
export function linhaDeLigacao(): string {
  return envWa("WHATSAPP_PHONE_NUMBER_ID");
}

// ---------------------------------------------------------------------------
// Originar chamada (negócio → cliente)
// ---------------------------------------------------------------------------

/**
 * Liga para o cliente. `to` = E.164 sem '+'. `sdpOffer` é a oferta produzida
 * pelo navegador do vendedor.
 *
 * Devolve só o `call_id`: quem manda de verdade é o webhook, que depois entrega
 * o SDP `answer` (evento `connect`) quando a cliente aceita. Enquanto isso a
 * chamada fica em 'discando' → 'tocando'.
 */
export async function iniciarChamada(
  to: string,
  sdpOffer: string,
  rastro?: string,
): Promise<{ call_id: string }> {
  const body = await graph(`${linhaDeLigacao()}/calls`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      action: "connect",
      session: { sdp_type: "offer", sdp: sdpOffer },
      ...(rastro ? { biz_opaque_callback_data: rastro.slice(0, 512) } : {}),
    }),
  });
  const id = body?.calls?.[0]?.id;
  if (!id) throw new GraphCallingError("Graph aceitou a chamada mas não devolveu call_id", null, null);
  return { call_id: String(id) };
}

// ---------------------------------------------------------------------------
// Chamada recebida (cliente → negócio) e comandos de controle
// ---------------------------------------------------------------------------

/**
 * `pre_accept` antes de `accept` é recomendação da Meta, não capricho: ele já
 * estabelece o caminho de mídia enquanto o vendedor ainda está clicando, o que
 * corta o silêncio inicial dos primeiros segundos da chamada.
 */
export function preAceitar(callId: string, sdpAnswer: string): Promise<any> {
  return comando(callId, "pre_accept", { sdp_type: "answer", sdp: sdpAnswer });
}

export function aceitar(callId: string, sdpAnswer: string): Promise<any> {
  return comando(callId, "accept", { sdp_type: "answer", sdp: sdpAnswer });
}

export function recusar(callId: string): Promise<any> {
  return comando(callId, "reject");
}

/** Desligar. Serve tanto para cancelar o que está tocando quanto para encerrar o que está em curso. */
export function encerrar(callId: string): Promise<any> {
  return comando(callId, "terminate");
}

function comando(callId: string, action: AcaoLigacao, session?: Sdp): Promise<any> {
  return graph(`${linhaDeLigacao()}/calls`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      call_id: callId,
      action,
      ...(session ? { session } : {}),
    }),
  });
}

// ---------------------------------------------------------------------------
// Permissão de chamada
// ---------------------------------------------------------------------------
export type Permissao = {
  /** 'temporary' = pode ligar agora; 'no_permission' = precisa pedir antes */
  status: string;
  expira_em: string | null;
  pode_ligar: boolean;
};

/**
 * Consulta se podemos ligar para este cliente AGORA. Vale a pena checar antes de
 * discar: sem isso o vendedor só descobre a recusa pelo erro do Graph, depois de
 * já ter pedido o microfone e montado a oferta.
 *
 * Falha de consulta NÃO bloqueia a discagem — devolve `pode_ligar: true` e deixa
 * o Graph decidir. Uma indisponibilidade da consulta não deve impedir o trabalho.
 */
export async function consultarPermissao(waId: string): Promise<Permissao> {
  try {
    const body = await graph(
      `${linhaDeLigacao()}/call_permissions?user_wa_id=${encodeURIComponent(waId)}`,
      { method: "GET" },
    );
    const p = body?.permission ?? body?.data?.[0] ?? body ?? {};
    const status = String(p.status ?? p.permission_status ?? "desconhecido");
    return {
      status,
      expira_em: p.expiration_time ? new Date(Number(p.expiration_time) * 1000).toISOString() : null,
      pode_ligar: status !== "no_permission",
    };
  } catch {
    return { status: "indisponivel", expira_em: null, pode_ligar: true };
  }
}

// ---------------------------------------------------------------------------
// Configuração da linha (admin) — calling NÃO vem ligado
// ---------------------------------------------------------------------------

/** Lê as configurações de chamada da linha: se está habilitada, ícone, horários. */
export async function lerConfigChamadas(): Promise<any> {
  const body = await graph(`${linhaDeLigacao()}/settings?include=calling`, { method: "GET" });
  return body?.calling ?? body ?? null;
}

/**
 * Liga/desliga a chamada na linha. É uma escrita na conta da Meta — a rota que
 * chama isto exige admin, e a linha só pode ser a que está na env (o número
 * oficial de produção nunca passa por aqui; mesmo recorte da §20.3).
 */
export function definirConfigChamadas(ligado: boolean): Promise<any> {
  return graph(`${linhaDeLigacao()}/settings`, {
    method: "POST",
    body: JSON.stringify({
      calling: {
        status: ligado ? "ENABLED" : "DISABLED",
        call_icon_visibility: ligado ? "DEFAULT" : "DISABLE_ALL",
        // cliente que LIGA para nós concede permissão de retorno automaticamente
        // — é o caminho mais limpo para conseguir permissão sem gastar template
        callback_permission_status: ligado ? "ENABLED" : "DISABLED",
      },
    }),
  });
}
