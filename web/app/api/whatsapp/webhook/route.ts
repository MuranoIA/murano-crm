// Webhook da WhatsApp Cloud API (Meta) — canal direto, sem RD Conversas.
//
// GET  = verificação de assinatura do webhook (hub.challenge), feita uma vez ao
//        cadastrar a URL no painel da Meta.
// POST = eventos em tempo real: mensagens recebidas de clientes e atualizações
//        de status (sent/delivered/read/failed) das mensagens que enviamos.
//
// Grava nas MESMAS tabelas do ETL do RD (`clientes`, `mensagens`), então o board,
// a vw_funil e o Realtime (migration 0069, trigger de statement em `mensagens`)
// funcionam sem nenhuma mudança. O id da mensagem é o `wamid` da Meta — id real,
// estável e único, então o upsert é idempotente por natureza (a Meta pode
// reentregar o mesmo evento; reentrega vira no-op).
//
// Vínculo com o cliente: pelo telefone (últimos 8 dígitos — mesmo padrão tel8 do
// resto do projeto, porque o telefone vindo do RD às vezes não tem o nono dígito).
// Se não existe, cria um cliente novo com id sintético `wa:<wa_id>` — mesmo
// padrão dos ids sintéticos `winthor:<codcli>` da prospecção.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// GET — verificação do webhook (painel da Meta manda ?hub.mode=subscribe&...)
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// ---------------------------------------------------------------------------
// POST — eventos
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  // A Meta reenvia o evento se não receber 200 rápido — e reenvia PARA SEMPRE um
  // payload que a gente não consegue processar. Por isso: qualquer erro interno é
  // logado e a resposta é 200 mesmo assim (o upsert idempotente torna isso seguro).
  const raw = await req.text();
  try {
    if (!verificarAssinatura(req, raw)) {
      // assinatura inválida É 403 (não 200): payload não veio da Meta.
      return new Response("bad signature", { status: 403 });
    }
    const body = JSON.parse(raw);
    await processar(body);
  } catch (e: any) {
    console.error("[wa-webhook] erro:", e?.message ?? e);
  }
  return new Response("ok", { status: 200 });
}

// Assinatura X-Hub-Signature-256 = HMAC-SHA256(raw body, app secret).
// Se WHATSAPP_APP_SECRET não estiver configurado, aceita sem validar (dev).
function verificarAssinatura(req: Request, raw: string): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  const header = req.headers.get("x-hub-signature-256") ?? "";
  const esperado = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function processar(body: any): Promise<void> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "messages") continue;
      const value = change.value ?? {};
      // nome de perfil por wa_id (vem junto com as mensagens)
      const nomes = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c?.wa_id && c?.profile?.name) nomes.set(c.wa_id, c.profile.name);
      }
      for (const msg of value.messages ?? []) {
        await gravarMensagemRecebida(sb, msg, nomes.get(msg.from));
      }
      for (const st of value.statuses ?? []) {
        await atualizarStatus(sb, st);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mensagem recebida do cliente
// ---------------------------------------------------------------------------
async function gravarMensagemRecebida(sb: any, msg: any, nomePerfil?: string): Promise<void> {
  const waId: string = String(msg.from ?? "");
  const wamid: string = String(msg.id ?? "");
  if (!waId || !wamid) return;

  const cliente = await acharOuCriarCliente(sb, waId, nomePerfil);
  const row = {
    id: wamid,
    cliente_id: cliente.id,
    vendedor_carteira: cliente.carteira ?? null,
    enviada_por: "customer",
    tipo: "mensagem",
    conteudo: extrairConteudo(msg),
    is_reply: Boolean(msg.context?.id) || null,
    status: "success",
    criada_em: new Date(Number(msg.timestamp) * 1000).toISOString(),
  };
  const { error } = await sb.from("mensagens").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`upsert mensagens: ${error.message}`);
}

// Texto puro quando existir; para mídia, um marcador com o caption se houver.
// (Download da mídia em si — imagem/áudio/documento — fica para a fase B/C:
// o webhook só entrega o media_id, que expira; baixar exige chamada ao Graph.)
function extrairConteudo(msg: any): string {
  switch (msg.type) {
    case "text":
      return String(msg.text?.body ?? "");
    case "button":
      return String(msg.button?.text ?? "[botão]");
    case "interactive":
      return String(
        msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "[interativo]",
      );
    case "reaction":
      return `[reação] ${msg.reaction?.emoji ?? ""}`.trim();
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker": {
      const caption = msg[msg.type]?.caption;
      return caption ? `[${msg.type}] ${caption}` : `[${msg.type}]`;
    }
    case "location":
      return "[localização]";
    case "contacts":
      return "[contato compartilhado]";
    default:
      return `[${msg.type ?? "desconhecido"}]`;
  }
}

// ---------------------------------------------------------------------------
// Vínculo mensagem ↔ cliente (match por tel8, criação se não existir)
// ---------------------------------------------------------------------------
async function acharOuCriarCliente(
  sb: any,
  waId: string,
  nomePerfil?: string,
): Promise<{ id: string; carteira: string | null }> {
  const tel8 = waId.replace(/\D/g, "").slice(-8);

  // match pelos 8 últimos dígitos — cobre RD (12 dígitos, sem o nono) e Meta (13)
  const { data: candidatos } = await sb
    .from("clientes")
    .select("id,carteira,telefone")
    .like("telefone", `%${tel8}`)
    .limit(5);
  if (candidatos?.length) {
    // se houver mais de um, prefere quem tem carteira definida
    const escolhido = candidatos.find((c: any) => c.carteira) ?? candidatos[0];
    return { id: escolhido.id, carteira: escolhido.carteira ?? null };
  }

  // contato novo, sem histórico no RD — id sintético estável por wa_id
  const novo = {
    id: `wa:${waId}`,
    nome_completo: nomePerfil ?? waId,
    telefone: waId,
    carteira: null,
    canal: "whatsapp",
  };
  const { error } = await sb.from("clientes").upsert(novo, { onConflict: "id" });
  if (error) throw new Error(`upsert clientes: ${error.message}`);
  return { id: novo.id, carteira: null };
}

// ---------------------------------------------------------------------------
// Status de mensagem ENVIADA por nós (sent → delivered → read; ou failed)
// ---------------------------------------------------------------------------
async function atualizarStatus(sb: any, st: any): Promise<void> {
  const wamid = String(st.id ?? "");
  const status = String(st.status ?? "");
  if (!wamid || !status) return;
  // Mapeia para o vocabulário que o banco já usa (herdado do RD):
  // wait = só enviada · success = entregue · read = lida
  const mapa: Record<string, string> = {
    sent: "wait",
    delivered: "success",
    read: "read",
    failed: "failed",
  };
  const { error } = await sb
    .from("mensagens")
    .update({ status: mapa[status] ?? status })
    .eq("id", wamid);
  if (error) throw new Error(`update status: ${error.message}`);
  if (status === "failed") {
    console.error("[wa-webhook] envio falhou:", JSON.stringify(st.errors ?? st));
  }
}
