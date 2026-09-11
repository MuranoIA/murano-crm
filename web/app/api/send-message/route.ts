import { createClient } from "@supabase/supabase-js";
import { sendText, linhaDaConversa } from "../../../lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// carteira (dono do card) -> employee_id vem da tabela carteira_config (fonte única)

// mensagem livre (não-template) — só funciona dentro da janela de 24h do WhatsApp
// (o cliente falou recentemente). Endpoint: POST /v2/messages/{contact_id}/send.
export async function POST(req: Request) {
  try {
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const faltando = Object.entries({
      SUPABASE_URL: supaUrl, SUPABASE_SERVICE_ROLE_KEY: supaKey,
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
      .select("id,nome_completo,telefone,carteira")
      .eq("id", cliente_id)
      .single();
    if (cliErr || !cli) return Response.json({ error: "cliente não encontrado" }, { status: 404 });

    // Um canal só: WhatsApp Cloud API. O ramo do RD Conversas que vinha
    // depois daqui — com envs próprias, `employee_id` da carteira, FormData e
    // retry de 429 sobre a cota compartilhada — saiu com a conta desativada
    // (0131).
    const to = String(cli.telefone ?? cliente_id.replace(/^wa:/, "")).replace(/\D/g, "");
    if (!to) return Response.json({ error: "cliente sem telefone" }, { status: 400 });
    try {
      // A conversa responde PELO NUMERO EM QUE A CLIENTE FALOU (§dois numeros).
      // Um valor global aqui responderia pelo numero errado e cairia em 131047,
      // porque a janela de 24h e por par (numero, cliente).
      const linha = await linhaDaConversa(sb, cliente_id);
      const { wamid } = await sendText(to, texto, linha);
      // espelha no banco (mesma linha que o webhook atualiza com sent/delivered/read)
      await sb.from("mensagens").upsert({
        id: wamid, cliente_id: cli.id, vendedor_carteira: cli.carteira ?? null,
        enviada_por: "operator", tipo: "mensagem", conteudo: texto,
        status: "wait", criada_em: new Date().toISOString(),
        linha_id: linha,
      }, { onConflict: "id" });
      return Response.json({ ok: true, cliente: cli.nome_completo, canal: "whatsapp" });
    } catch (e: any) {
      if (e?.foraDaJanela) {
        return Response.json({
          error: "Fora da janela de 24h do WhatsApp — envie um template para reabrir a conversa.",
          foraDaJanela: true,
        }, { status: 422 });
      }
      return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
    }
  } catch (e: any) {
    return Response.json({ error: `Falha interna: ${e?.message ?? String(e)}` }, { status: 500 });
  }
}
