import { createClient } from "@supabase/supabase-js";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";

export const dynamic = "force-dynamic";

// Status da conversa: aberta | resolvida (+ motivo). É o substituto do "fechar
// atendimento" do RD — e o motivo é a NOSSA tabulação, agora dentro do fluxo
// natural do atendimento (1 clique ao encerrar), em vez de um campo que ninguém
// preenchia no painel antigo. Ver CLAUDE.md §6 e §18.
//
// A conversa REABRE sozinha quando o cliente manda mensagem nova: quem faz isso é
// o webhook (app/api/whatsapp/webhook), não esta rota.
const MOTIVOS = ["venda_realizada", "tentativa_contato", "follow_up", "sem_interesse", "outro"];

export async function POST(req: Request) {
  const usuario = usuarioDaSessao();
  if (!usuario) return Response.json({ error: "não autenticado" }, { status: 401 });

  let cliente_id: string, status: string, motivo: string | undefined, observacao: string | undefined;
  try {
    ({ cliente_id, status, motivo, observacao } = await req.json());
  } catch {
    return Response.json({ error: "body inválido" }, { status: 400 });
  }
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  if (status !== "aberta" && status !== "resolvida") {
    return Response.json({ error: "status inválido" }, { status: 400 });
  }
  if (status === "resolvida" && motivo && !MOTIVOS.includes(motivo)) {
    return Response.json({ error: `motivo inválido (use: ${MOTIVOS.join(", ")})` }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const resolvendo = status === "resolvida";
  const { error } = await sb.from("chat_conversa").upsert({
    cliente_id,
    status,
    motivo: resolvendo ? (motivo ?? null) : null,
    observacao: resolvendo ? (observacao ?? null) : null,
    resolvida_em: resolvendo ? new Date().toISOString() : null,
    resolvida_por: resolvendo ? usuario : null,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "cliente_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, status, motivo: resolvendo ? motivo ?? null : null });
}
