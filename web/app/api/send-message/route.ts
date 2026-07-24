import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// carteira (dono do card) -> employee_id (quem aparece como remetente no RD Conversas)
const OPERADORES: Record<string, string> = {
  romulo: "6a3a97bbb94e6ad472ee9d02",
  kamilly: "6a3a9851e785f9118ec9141d",
  luana: "6a3a99836da6dc52edf34c5a",
};

// mensagem livre (não-template) — só funciona dentro da janela de 24h do WhatsApp
// (o cliente falou recentemente). Endpoint: POST /v2/messages/{contact_id}/send.
export async function POST(req: Request) {
  try {
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const rdUrl = process.env.RD_CONVERSAS_BASE_URL;
    const rdToken = process.env.RD_CONVERSAS_TOKEN;

    const faltando = Object.entries({
      SUPABASE_URL: supaUrl, SUPABASE_SERVICE_ROLE_KEY: supaKey,
      RD_CONVERSAS_BASE_URL: rdUrl, RD_CONVERSAS_TOKEN: rdToken,
    }).filter(([, v]) => !v).map(([k]) => k);
    if (faltando.length) {
      return Response.json({ error: `Config ausente na Vercel: ${faltando.join(", ")}` }, { status: 500 });
    }

    let cliente_id: string, texto: string;
    try {
      ({ cliente_id, texto } = await req.json());
    } catch {
      return Response.json({ error: "body inválido" }, { status: 400 });
    }
    if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
    // cards sintéticos (prospecção/venda sem conversa) não têm customer_id real no RD
    if (cliente_id.startsWith("winthor:") || cliente_id.startsWith("venda:")) {
      return Response.json({ error: "cliente sem conversa no RD Conversas — use o WhatsApp direto" }, { status: 400 });
    }
    texto = String(texto ?? "").trim();
    if (!texto) return Response.json({ error: "mensagem vazia" }, { status: 400 });

    const sb = createClient(supaUrl!, supaKey!, { auth: { persistSession: false } });
    const { data: cli, error: cliErr } = await sb
      .from("clientes")
      .select("id,nome_completo,carteira")
      .eq("id", cliente_id)
      .single();
    if (cliErr || !cli) return Response.json({ error: "cliente não encontrado" }, { status: 404 });

    const operator_id = OPERADORES[cli.carteira as string];
    const tokenLimpo = rdToken!.replace(/[^\x21-\x7E]/g, "");

    const form = new FormData();
    form.set("message", texto);
    form.set("sent_by", "operator");
    if (operator_id) form.set("operator", operator_id);

    const rd = await fetch(new URL(`/v2/messages/${cliente_id}/send`, rdUrl!), {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenLimpo}` },
      body: form,
    });
    const body: any = await rd.json().catch(() => ({}));
    if (!rd.ok) {
      return Response.json({ error: body?.message || `RD ${rd.status}`, detail: body }, { status: 502 });
    }

    return Response.json({ ok: true, cliente: cli.nome_completo });
  } catch (e: any) {
    return Response.json({ error: `Falha interna: ${e?.message ?? String(e)}` }, { status: 500 });
  }
}
