import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// carteira (dono do card) -> employee_id (para atribuir o disparo ao vendedor)
const OPERADORES: Record<string, string> = {
  romulo: "6a3a97bbb94e6ad472ee9d02",
  kamilly: "6a3a9851e785f9118ec9141d",
  luana: "6a3a99836da6dc52edf34c5a",
};

export async function POST(req: Request) {
  try {
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const rdUrl = process.env.RD_CONVERSAS_BASE_URL;
    const rdToken = process.env.RD_CONVERSAS_TOKEN;
    const templateId = process.env.TEMPLATE_RECONTATO_ID;

    // valida env vars (falta de qualquer uma = erro claro, não crash vazio)
    const faltando = Object.entries({
      SUPABASE_URL: supaUrl, SUPABASE_SERVICE_ROLE_KEY: supaKey,
      RD_CONVERSAS_BASE_URL: rdUrl, RD_CONVERSAS_TOKEN: rdToken,
      TEMPLATE_RECONTATO_ID: templateId,
    }).filter(([, v]) => !v).map(([k]) => k);
    if (faltando.length) {
      return Response.json({ error: `Config ausente na Vercel: ${faltando.join(", ")}` }, { status: 500 });
    }

    let cliente_id: string;
    try {
      ({ cliente_id } = await req.json());
    } catch {
      return Response.json({ error: "body inválido" }, { status: 400 });
    }
    if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

    const sb = createClient(supaUrl!, supaKey!, { auth: { persistSession: false } });

    // busca o contato (telefone/nome/carteira) server-side (não expõe telefone ao browser)
    const { data: cli, error: cliErr } = await sb
      .from("clientes")
      .select("id,nome_completo,telefone,carteira")
      .eq("id", cliente_id)
      .single();
    if (cliErr || !cli) return Response.json({ error: "cliente não encontrado" }, { status: 404 });
    if (!cli.telefone) return Response.json({ error: "cliente sem telefone" }, { status: 400 });

    const operator_id = OPERADORES[cli.carteira as string];
    const primeiroNome = String(cli.nome_completo ?? "").trim().split(/\s+/)[0] || "";
    const recipient = cli.telefone.startsWith("+") ? cli.telefone : `+${cli.telefone}`;

    const payload: Record<string, unknown> = {
      recipient_number: recipient,
      template_message_id: templateId,
      country_code: "55",
      sent_by: operator_id ? "operator" : "bot",
      variables: [primeiroNome],
    };
    if (operator_id) payload.operator_id = operator_id;

    // dispara na RD
    const rd = await fetch(new URL("/v3/messages/template/send", rdUrl!), {
      method: "POST",
      headers: { Authorization: `Bearer ${rdToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body: any = await rd.json().catch(() => ({}));
    if (!rd.ok) {
      return Response.json({ error: body?.message || `RD ${rd.status}`, detail: body }, { status: 502 });
    }

    // loga o disparo (contagem por clique)
    const msgId = body?.data?.id || `${cliente_id}-${Date.now()}`;
    await sb.from("disparos_template").insert({
      id: msgId,
      cliente_id: cli.id,
      telefone: cli.telefone,
      vendedor: cli.carteira,
      operator_id: operator_id ?? null,
      template_id: templateId,
      status: body?.data?.status ?? "sent",
    });

    return Response.json({ ok: true, id: msgId, cliente: cli.nome_completo });
  } catch (e: any) {
    return Response.json({ error: `Falha interna: ${e?.message ?? String(e)}` }, { status: 500 });
  }
}
