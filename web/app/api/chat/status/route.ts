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

  // ---- histórico de resolução (0114) --------------------------------------
  // `chat_conversa` é upsert por cliente: guarda o ESTADO, não a história. Como
  // a conversa reabre sozinha quando a cliente responde, medir tempo de
  // resolução ali daria uma média que encolhe conforme a operação piora — cada
  // reabertura apagaria a resolução que ela deveria contar.
  //
  // Por isso a linha vai para uma tabela append-only, mesma razão de
  // `chat_transferencia` (§18).
  if (resolvendo) {
    try {
      // Quando esta conversa abriu? É a primeira mensagem da cliente DEPOIS da
      // resolução anterior — e não "a primeira de todas", senão uma cliente de
      // dois anos apareceria com resolução de 700 dias.
      const { data: ant } = await sb.from("chat_resolucao")
        .select("resolvida_em").eq("cliente_id", cliente_id)
        .order("resolvida_em", { ascending: false }).limit(1);
      const desde = ant?.[0]?.resolvida_em ?? null;

      let q = sb.from("mensagens").select("criada_em,vendedor_carteira")
        .eq("cliente_id", cliente_id).eq("enviada_por", "customer")
        .neq("tipo", "evento_sistema")
        .order("criada_em", { ascending: true }).limit(1);
      if (desde) q = q.gt("criada_em", desde);
      const { data: prim } = await q;

      await sb.from("chat_resolucao").insert({
        cliente_id,
        vendedor: prim?.[0]?.vendedor_carteira ?? null,
        // sem mensagem da cliente no ciclo, `aberta_em` fica NULO — a conversa
        // entra na contagem de resolvidas mas fora da média de tempo. É melhor
        // que inventar um início: a view separa `resolvidas` de `com_tempo`.
        aberta_em: prim?.[0]?.criada_em ?? null,
        resolvida_em: new Date().toISOString(),
        motivo: motivo ?? null,
        por: usuario,
      });
    } catch {
      // A tabela pode ainda não existir (0114 não aplicada). Registrar o
      // histórico NUNCA pode impedir alguém de encerrar uma conversa.
    }
  }

  return Response.json({ ok: true, status, motivo: resolvendo ? motivo ?? null : null });
}
