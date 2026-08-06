// Rota TEMPORÁRIA de teste de envio pela WhatsApp Cloud API (Fase B, passo 1).
// Remover quando as rotas oficiais (send-message/send-template) migrarem do RD
// para a Cloud API.
//
// Segurança: sem sessão/segredo, então o destino é travado numa ALLOWLIST de
// números de teste — o pior caso de abuso é alguém mandar texto pro próprio
// desenvolvedor. Não aceita destino arbitrário.
//
// Após enviar, grava a mensagem em `mensagens` com id = wamid (mesma linha que o
// webhook vai atualizar quando chegarem os statuses sent/delivered/read), vinculada
// ao cliente pelo tel8 — o board mostra a mensagem como de qualquer outro canal.
import { createClient } from "@supabase/supabase-js";
import { sendText } from "../../../../lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// wa_ids autorizados a receber teste (formato E.164 sem '+')
const DESTINOS_PERMITIDOS = new Set(["559184719702"]);

export async function POST(req: Request) {
  try {
    let to: string, texto: string;
    try {
      ({ to, texto } = await req.json());
    } catch {
      return Response.json({ error: "body inválido" }, { status: 400 });
    }
    to = String(to ?? "").replace(/\D/g, "");
    texto = String(texto ?? "").trim();
    if (!DESTINOS_PERMITIDOS.has(to)) {
      return Response.json({ error: "destino não autorizado para teste" }, { status: 403 });
    }
    if (!texto) return Response.json({ error: "mensagem vazia" }, { status: 400 });

    const { wamid } = await sendText(to, texto);

    // espelha no banco (mesmo formato do webhook; o upsert é idempotente por wamid)
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const tel8 = to.slice(-8);
    const { data: candidatos } = await sb
      .from("clientes").select("id,carteira").like("telefone", `%${tel8}`).limit(5);
    const cli = candidatos?.find((c: any) => c.carteira) ?? candidatos?.[0] ?? null;
    if (cli) {
      await sb.from("mensagens").upsert({
        id: wamid,
        cliente_id: cli.id,
        vendedor_carteira: cli.carteira ?? null,
        enviada_por: "operator",
        tipo: "mensagem",
        conteudo: texto,
        status: "wait",
        criada_em: new Date().toISOString(),
      }, { onConflict: "id" });
    }

    return Response.json({ ok: true, wamid, cliente_id: cli?.id ?? null });
  } catch (e: any) {
    const status = e?.foraDaJanela ? 422 : 502;
    return Response.json(
      { error: e?.message ?? String(e), foraDaJanela: Boolean(e?.foraDaJanela), graphCode: e?.graphCode ?? null },
      { status },
    );
  }
}
