import {
  sessaoDeLigacao, falhou, donoDaConversa, COLS_LIGACAO, VIVOS, encerramento,
} from "../../../../../lib/ligacao";
import { preAceitar, aceitar, recusar, encerrar } from "../../../../../lib/whatsappCalling";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Sinalização da chamada de voz — a ponte entre o webhook e a aba do navegador.
//
// POR QUE ESTA ROTA EXISTE: no WebRTC as duas pontas trocam SDP. A nossa metade
// é produzida no navegador (é lá que está o microfone), mas a metade da cliente
// chega pelo WEBHOOK, noutro processo. E o broadcast do Realtime que avisa da
// novidade é um canal PÚBLICO, onde não pode trafegar nem `cliente_id` (que pode
// ser `wa:<telefone>`) nem o SDP. Então o fluxo é:
//
//   webhook grava o SDP em chat_ligacao  ->  trigger toca a campainha só com o
//   call_id  ->  navegador chama GET aqui  ->  esta rota autoriza e entrega.
//
//   GET  ?call_id= | ?id=   -> estado da chamada + SDP da outra ponta
//   POST                    -> atender / recusar / desligar
// ---------------------------------------------------------------------------

const ACOES = ["atender", "recusar", "desligar"] as const;
type Acao = (typeof ACOES)[number];

export async function GET(req: Request) {
  const s = sessaoDeLigacao();
  if (falhou(s)) return s.erro;

  const url = new URL(req.url);
  const callId = url.searchParams.get("call_id");
  const id = Number(url.searchParams.get("id") ?? 0);
  if (!callId && !id) return Response.json({ error: "call_id ou id ausente" }, { status: 400 });

  let q = s.sb.from("chat_ligacao").select(`${COLS_LIGACAO},sdp_remoto,sdp_tipo`);
  q = callId ? q.eq("call_id", callId) : q.eq("id", id);
  const { data: lig } = await q.maybeSingle();
  if (!lig) return Response.json({ error: "ligação não encontrada" }, { status: 404 });

  const { dono, pode } = await donoDaConversa(s, lig.cliente_id);
  if (!pode) return Response.json({ error: "sem acesso a esta conversa" }, { status: 403 });

  // nome do cliente junto: a campainha precisa dizer QUEM está ligando, e o
  // navegador não tem esse dado (o broadcast não carrega cliente_id)
  const { data: cli } = await s.sb
    .from("clientes").select("nome_completo").eq("id", lig.cliente_id).maybeSingle();

  return Response.json({
    ligacao: lig,
    cliente: { id: lig.cliente_id, nome: cli?.nome_completo ?? lig.telefone ?? lig.cliente_id },
    dono,
  });
}

export async function POST(req: Request) {
  const s = sessaoDeLigacao();
  if (falhou(s)) return s.erro;

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const acao = String(b?.acao ?? "") as Acao;
  const callId = String(b?.call_id ?? "").trim();
  const sdp = String(b?.sdp ?? "").trim();
  if (!ACOES.includes(acao)) return Response.json({ error: `ação inválida: ${acao}` }, { status: 400 });
  if (!callId) return Response.json({ error: "call_id ausente" }, { status: 400 });

  const { data: lig } = await s.sb
    .from("chat_ligacao").select("id,cliente_id,canal,call_id,status,atendida_em,carteira")
    .eq("call_id", callId).maybeSingle();
  if (!lig) return Response.json({ error: "ligação não encontrada" }, { status: 404 });

  const { dono, pode } = await donoDaConversa(s, lig.cliente_id);
  if (!pode) return Response.json({ error: "essa conversa não está com você" }, { status: 403 });

  // ---- ATENDER --------------------------------------------------------------
  if (acao === "atender") {
    if (!sdp) return Response.json({ error: "sdp ausente (resposta do navegador)" }, { status: 400 });
    if (!(VIVOS as unknown as string[]).includes(lig.status)) {
      return Response.json({ error: "essa chamada já terminou" }, { status: 409 });
    }
    // Quem atendeu primeiro fica com ela. `atendida_em is null` no WHERE é a
    // trava: com o time inteiro vendo a campainha de uma conversa sem dono, dois
    // cliques simultâneos chegariam aqui juntos — o segundo não encontra linha
    // para atualizar e recebe o 409, em vez de os dois acharem que atenderam.
    const { data: ganhou } = await s.sb.from("chat_ligacao")
      .update({ atendida_em: new Date().toISOString(), por: s.usuario, carteira: lig.carteira ?? s.carteira ?? dono })
      .eq("id", lig.id).is("atendida_em", null)
      .select("id").maybeSingle();
    if (!ganhou) return Response.json({ error: "outra pessoa já atendeu esta chamada" }, { status: 409 });

    try {
      // pre_accept antes de accept: já abre o caminho de mídia e corta o silêncio
      // dos primeiros segundos (recomendação da Meta). Falha nele não é fatal —
      // o accept sozinho conecta.
      try { await preAceitar(callId, sdp); } catch { /* segue para o accept */ }
      await aceitar(callId, sdp);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      await s.sb.from("chat_ligacao")
        .update({ status: "falhou", encerrada_em: new Date().toISOString(), erro: msg.slice(0, 500) })
        .eq("id", lig.id);
      return Response.json({ error: msg }, { status: 502 });
    }

    // o SDP da outra ponta foi consumido: limpa para o navegador não reaplicar
    // uma oferta velha se a tela recarregar no meio da conversa
    const { data } = await s.sb.from("chat_ligacao")
      .update({ status: "em_curso", sdp_remoto: null, sdp_tipo: null })
      .eq("id", lig.id).select(COLS_LIGACAO).single();
    return Response.json({ ok: true, ligacao: data });
  }

  // ---- RECUSAR / DESLIGAR ---------------------------------------------------
  let erroGraph: string | null = null;
  try {
    if (acao === "recusar") await recusar(callId);
    else await encerrar(callId);
  } catch (e: any) {
    // a chamada pode já ter caído do outro lado; fechar o registro local é o que
    // importa — sem isso a barra de chamada nunca sai da tela
    erroGraph = e?.message ?? String(e);
  }

  const status = acao === "recusar" ? "recusada" : (lig.atendida_em ? "concluida" : "cancelada");
  const { data, error } = await s.sb.from("chat_ligacao")
    .update(encerramento(lig, status, {
      sdp_remoto: null, sdp_tipo: null,
      ...(erroGraph ? { erro: erroGraph.slice(0, 500) } : {}),
    }))
    .eq("id", lig.id).select(COLS_LIGACAO).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, ligacao: data, avisoGraph: erroGraph });
}
