import { createClient } from "@supabase/supabase-js";
import { canalDoCliente, sendTemplate } from "../../../lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // dá folga p/ a chamada à API da RD (evita timeout de 10s da Vercel)

// carteira (dono do card) -> employee_id vem da tabela carteira_config (fonte única)

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

    let cliente_id: string, template_id: string | undefined;
    try {
      ({ cliente_id, template_id } = await req.json());
    } catch {
      return Response.json({ error: "body inválido" }, { status: 400 });
    }
    if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
    const tplId = template_id || templateId; // usa o escolhido; senão o padrão (recontato)

    const sb = createClient(supaUrl!, supaKey!, { auth: { persistSession: false } });

    // busca o contato (telefone/nome/carteira) server-side (não expõe telefone ao browser)
    const { data: cli, error: cliErr } = await sb
      .from("clientes")
      .select("id,nome_completo,telefone,carteira")
      .eq("id", cliente_id)
      .single();
    if (cliErr || !cli) return Response.json({ error: "cliente não encontrado" }, { status: 404 });
    if (!cli.telefone) return Response.json({ error: "cliente sem telefone" }, { status: 400 });

    const { data: cfg } = await sb.from("carteira_config").select("employee_id").eq("slug", cli.carteira as string).maybeSingle();
    const operator_id = cfg?.employee_id ?? null;
    const primeiroNome = String(cli.nome_completo ?? "").trim().split(/\s+/)[0] || "";

    // ---- canal direto (WhatsApp Cloud API) — clientes wa:* ou interruptor ligado ----
    // Template na Cloud API é outro cadastro (nome aprovado no Gerenciador da Meta,
    // não o id do RD). Enquanto WHATSAPP_TEMPLATE_RECONTATO não existir na Vercel,
    // este desvio responde 501 com instrução clara. O fluxo RD abaixo segue intocado.
    if (canalDoCliente(cliente_id) === "whatsapp") {
      const nomeTemplate = process.env.WHATSAPP_TEMPLATE_RECONTATO;
      if (!nomeTemplate) {
        return Response.json({
          error: "Template da Cloud API não configurado — criar o template no Gerenciador da Meta e definir WHATSAPP_TEMPLATE_RECONTATO na Vercel.",
        }, { status: 501 });
      }
      try {
        const to = String(cli.telefone).replace(/\D/g, "");
        const { wamid } = await sendTemplate(to, nomeTemplate, "pt_BR", [
          { type: "body", parameters: [{ type: "text", text: primeiroNome || "cliente" }] },
        ]);
        await sb.from("disparos_template").insert({
          id: wamid, cliente_id: cli.id, telefone: cli.telefone, vendedor: cli.carteira,
          operator_id: operator_id ?? null, template_id: nomeTemplate, status: "sent",
        });
        // espelha em mensagens como template (o funil usa isso p/ a etapa tentativa_contato)
        await sb.from("mensagens").upsert({
          id: wamid, cliente_id: cli.id, vendedor_carteira: cli.carteira ?? null,
          enviada_por: "operator", tipo: "template", conteudo: `[template] ${nomeTemplate}`,
          status: "wait", criada_em: new Date().toISOString(),
        }, { onConflict: "id" });
        return Response.json({ ok: true, id: wamid, cliente: cli.nome_completo, canal: "whatsapp" });
      } catch (e: any) {
        return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
      }
    }

    const recipient = cli.telefone.startsWith("+") ? cli.telefone : `+${cli.telefone}`;

    const payload: Record<string, unknown> = {
      recipient_number: recipient,
      template_message_id: tplId,
      country_code: "55",
      sent_by: operator_id ? "operator" : "bot",
      variables: [primeiroNome],
    };
    if (operator_id) payload.operator_id = operator_id;

    // remove qualquer caractere inválido para header (ex: "•" colado por engano);
    // JWT só tem ASCII imprimível [0x21-0x7E], então isto é seguro.
    const tokenLimpo = rdToken!.replace(/[^\x21-\x7E]/g, "");

    // dispara na RD — com retry em 429/5xx (o rate limit do RD é apertado e o sync de
    // fundo pode estar consumindo a cota; a ação do usuário não pode falhar por isso).
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let rd: Response, body: any = {};
    for (let tent = 0; ; tent++) {
      rd = await fetch(new URL("/v3/messages/template/send", rdUrl!), {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenLimpo}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      body = await rd.json().catch(() => ({}));
      if (rd.ok || ![429, 500, 502, 503].includes(rd.status) || tent >= 4) break;
      await sleep(1200 * (tent + 1)); // 1.2s, 2.4s, 3.6s, 4.8s (cabe no maxDuration=30)
    }
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
      template_id: tplId,
      status: body?.data?.status ?? "sent",
    });

    return Response.json({ ok: true, id: msgId, cliente: cli.nome_completo });
  } catch (e: any) {
    return Response.json({ error: `Falha interna: ${e?.message ?? String(e)}` }, { status: 500 });
  }
}
