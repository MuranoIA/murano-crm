import {
  sessaoDeLigacao, falhou, donoDaConversa, telefoneE164, conversaNaCloud,
  COLS_LIGACAO, VIVOS, encerramento,
} from "../../../../lib/ligacao";
import { iniciarChamada, consultarPermissao, encerrar, GraphCallingError } from "../../../../lib/whatsappCalling";
import { linhaDeEnvio } from "../../../../lib/whatsapp";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Ligações de uma conversa: listar, iniciar e encerrar.
//
//   GET    ?cliente_id=  -> histórico da conversa + chamada viva, se houver
//   GET    ?ativas=1     -> chamadas vivas no escopo (o que a tela procura ao abrir)
//   POST                 -> inicia a chamada (exige o SDP do navegador)
//   PATCH                -> encerra / registra o desfecho
//
// ESCOPO: só conversas que já correm na Cloud API — hoje, a linha piloto. Conversa
// do RD/Tallos não tem ligação (decisão do usuário em 17/08/2026); o RD não tem
// API de voz e não faria sentido oferecer meia funcionalidade ali.
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const s = sessaoDeLigacao();
  if (falhou(s)) return s.erro;

  const url = new URL(req.url);

  // ---- chamadas vivas (campainha / reconexão depois de um F5) ----
  if (url.searchParams.get("ativas")) {
    let q = s.sb.from("vw_chat_ligacao_ativa").select("*").order("iniciada_em", { ascending: false });
    // vendedor vê as próprias e as SEM DONO (fila) — senão chamada de contato
    // novo não tocaria para ninguém
    if (!s.tudo && s.carteira) q = q.or(`carteira.eq.${s.carteira},carteira.is.null`);
    const { data, error } = await q.limit(20);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ativas: data ?? [] });
  }

  const cliente_id = url.searchParams.get("cliente_id");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  // histórico não escopa por carteira, pela mesma razão do /api/chat/thread:
  // filtrar cortaria o histórico de quem trocou de RCA
  const { data, error } = await s.sb
    .from("chat_ligacao").select(COLS_LIGACAO)
    .eq("cliente_id", cliente_id)
    .order("iniciada_em", { ascending: true })
    .limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ligacoes: data ?? [] });
}

// ---------------------------------------------------------------------------
// POST — iniciar
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const s = sessaoDeLigacao();
  if (falhou(s)) return s.erro;

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const cliente_id = String(b?.cliente_id ?? "").trim();
  const sdp = String(b?.sdp ?? "").trim();
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  // cards sintéticos da prospecção não são conversa: não há histórico, não há
  // linha da Cloud, não há para onde a chamada sair
  if (cliente_id.startsWith("winthor:") || cliente_id.startsWith("venda:")) {
    return Response.json({ error: "contato ainda sem conversa — não dá para ligar por aqui" }, { status: 400 });
  }

  const { dono, pode } = await donoDaConversa(s, cliente_id);
  if (!pode) return Response.json({ error: "essa conversa não está com você" }, { status: 403 });

  const { data: cli } = await s.sb
    .from("clientes").select("id,nome_completo,telefone").eq("id", cliente_id).maybeSingle();
  const telefone = telefoneE164(cli?.telefone, cliente_id);
  if (!telefone) return Response.json({ error: "cliente sem telefone" }, { status: 400 });

  // uma chamada viva por conversa: duas linhas 'em_curso' no mesmo cliente
  // deixariam a tela sem saber qual encerrar
  // `limit(1)` antes do maybeSingle: se por qualquer motivo houver mais de uma
  // linha viva, maybeSingle sozinho lançaria erro em vez de barrar a segunda
  // chamada — falharia justamente no caso que ele existe para tratar
  const { data: vivas } = await s.sb
    .from("chat_ligacao").select(COLS_LIGACAO)
    .eq("cliente_id", cliente_id).in("status", VIVOS as unknown as string[])
    .gt("iniciada_em", new Date(Date.now() - 2 * 3600_000).toISOString())
    .order("iniciada_em", { ascending: false }).limit(1);
  const viva = vivas?.[0];
  if (viva) return Response.json({ error: "já há uma ligação em andamento nesta conversa", ligacao: viva }, { status: 409 });

  // A ligação é só do piloto: conversa que ainda vive no RD não tem número nosso
  // na Meta para originar chamada. O front já esconde o botão nesse caso — esta
  // é a trava do servidor, que é a que vale.
  if (!(await conversaNaCloud(s.sb, cliente_id))) {
    return Response.json({
      error: "Esta conversa ainda corre pelo RD Conversas — a ligação existe só nas conversas da linha piloto.",
      foraDoPiloto: true,
    }, { status: 422 });
  }

  if (!sdp) return Response.json({ error: "sdp ausente (oferta do navegador)" }, { status: 400 });

  // checagem barata antes de gastar a chamada: sem permissão o Graph recusa, e o
  // vendedor só descobriria depois de já ter aberto o microfone
  const permissao = await consultarPermissao(telefone);
  if (!permissao.pode_ligar) {
    return Response.json({
      error: "O cliente ainda não autorizou receber ligação nossa pelo WhatsApp. " +
             "Ele autoriza ligando para a nossa linha, ou respondendo ao pedido de autorização.",
      semPermissao: true, permissao,
    }, { status: 422 });
  }

  const base = {
    cliente_id, canal: "whatsapp" as const, direcao: "saida" as const,
    carteira: dono, por: s.usuario, telefone,
  };

  // grava ANTES de chamar o Graph: se o webhook chegar antes da resposta HTTP
  // (acontece — são processos diferentes), a linha já existe para ele atualizar.
  const { data: linhaLig, error: errIns } = await s.sb.from("chat_ligacao")
    .insert({ ...base, status: "discando", linha_id: linhaDeEnvio() })
    .select("id").single();
  if (errIns) return Response.json({ error: errIns.message }, { status: 500 });

  try {
    const { call_id } = await iniciarChamada(telefone, sdp, `lig:${linhaLig.id}`);
    const { data } = await s.sb.from("chat_ligacao")
      .update({ call_id }).eq("id", linhaLig.id).select(COLS_LIGACAO).single();
    return Response.json({ ok: true, canal: "whatsapp", ligacao: data, permissao });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await s.sb.from("chat_ligacao")
      .update({ status: "falhou", encerrada_em: new Date().toISOString(), erro: msg.slice(0, 500) })
      .eq("id", linhaLig.id);
    const semPermissao = e instanceof GraphCallingError && e.semPermissao;
    return Response.json({ error: msg, semPermissao }, { status: semPermissao ? 422 : 502 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — encerrar / registrar o desfecho
//
// Manda `terminate` para a Meta e grava o desfecho: o vendedor informa no que
// deu, e é esse campo que transforma "liguei" em dado — a mesma lógica do motivo
// ao resolver a conversa (§18).
// ---------------------------------------------------------------------------
export async function PATCH(req: Request) {
  const s = sessaoDeLigacao();
  if (falhou(s)) return s.erro;

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const id = Number(b?.id ?? 0);
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  const motivo = String(b?.motivo ?? "").trim().slice(0, 60) || null;
  const observacao = String(b?.observacao ?? "").trim().slice(0, 500) || null;

  const { data: atual } = await s.sb
    .from("chat_ligacao").select("id,cliente_id,canal,call_id,status,atendida_em")
    .eq("id", id).maybeSingle();
  if (!atual) return Response.json({ error: "ligação não encontrada" }, { status: 404 });

  const { pode } = await donoDaConversa(s, atual.cliente_id);
  if (!pode) return Response.json({ error: "essa conversa não está com você" }, { status: 403 });

  // Chamada já encerrada (pelo webhook, por exemplo) só recebe o desfecho — sem
  // reescrever status nem duração, que vieram da Meta e valem mais.
  if (!(VIVOS as unknown as string[]).includes(atual.status)) {
    const { data } = await s.sb.from("chat_ligacao")
      .update({ ...(motivo ? { motivo } : {}), ...(observacao ? { observacao } : {}) })
      .eq("id", id).select(COLS_LIGACAO).single();
    return Response.json({ ok: true, ligacao: data });
  }

  let erroGraph: string | null = null;
  if (atual.call_id) {
    // desligar na Meta pode falhar (chamada já caiu do outro lado). Isso NÃO
    // pode impedir o fechamento do registro local — senão a linha fica viva para
    // sempre e a barra de chamada não sai da tela.
    try { await encerrar(atual.call_id); } catch (e: any) { erroGraph = e?.message ?? String(e); }
  }

  const status = String(b?.status ?? "").trim() ||
    (atual.atendida_em ? "concluida" : "cancelada");

  const { data, error } = await s.sb.from("chat_ligacao")
    .update(encerramento(atual, status, {
      ...(motivo ? { motivo } : {}),
      ...(observacao ? { observacao } : {}),
      ...(erroGraph ? { erro: erroGraph.slice(0, 500) } : {}),
    }))
    .eq("id", id).select(COLS_LIGACAO).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, ligacao: data, avisoGraph: erroGraph });
}
