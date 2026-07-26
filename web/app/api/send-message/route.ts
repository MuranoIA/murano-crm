import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// carteira (dono do card) -> employee_id vem da tabela carteira_config (fonte única)

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

    const { data: cfg } = await sb.from("carteira_config").select("employee_id").eq("slug", cli.carteira as string).maybeSingle();
    const operator_id = cfg?.employee_id ?? null;
    const tokenLimpo = rdToken!.replace(/[^\x21-\x7E]/g, "");

    const form = new FormData();
    form.set("message", texto);
    form.set("sent_by", "operator");
    if (operator_id) form.set("operator", operator_id);

    // retry em 429/5xx — mesmo padrão do send-template. O rate limit do RD (~48 req/min)
    // é compartilhado com o sync de fundo, que pode estar consumindo a cota; a ação do
    // usuário não pode falhar por isso. (Sem isto, enviar durante um run dava "RD 429".)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let rd: Response, body: any = {};
    for (let tent = 0; ; tent++) {
      rd = await fetch(new URL(`/v2/messages/${cliente_id}/send`, rdUrl!), {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenLimpo}` },
        body: form,
      });
      body = await rd.json().catch(() => ({}));
      if (rd.ok || ![429, 500, 502, 503].includes(rd.status) || tent >= 4) break;
      await sleep(1200 * (tent + 1)); // 1.2s, 2.4s, 3.6s, 4.8s (cabe no maxDuration=30)
    }
    if (!rd.ok) {
      return Response.json({ error: body?.message || `RD ${rd.status}`, detail: body }, { status: 502 });
    }

    return Response.json({ ok: true, cliente: cli.nome_completo });
  } catch (e: any) {
    return Response.json({ error: `Falha interna: ${e?.message ?? String(e)}` }, { status: 500 });
  }
}
