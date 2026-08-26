import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { lerCrmConfig, filtroLinhas } from "../../../../lib/crmConfig";
import { canalDeResposta } from "../../../../lib/whatsapp";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Pausa — avisa o cliente que o vendedor vai se ausentar (0106).
//
// A rota NÃO envia por conta própria: ela valida e delega ao /api/send-message,
// que já roteia RD × Cloud, espelha a mensagem em `mensagens` e traduz os erros
// de cada canal. Duplicar o envio aqui criaria um segundo caminho para manter.
//
// ---------------------------------------------------------------------------
// AS DUAS TRAVAS, E POR QUE ELAS SÃO O CORAÇÃO DISTO
//
// 1. **Janela de 24h.** Fora dela o envio livre falha, ou custaria um template
//    (R$ 0,43) — e nenhum aviso de intervalo vale isso. A janela é contada do
//    CANAL DE ENVIO (§37.2): quem respondeu no RD não tem janela aberta na
//    Cloud, e vice-versa.
//
// 2. **Não repetir.** Sem trava, clicar duas vezes manda dois avisos para quem
//    já está esperando — o oposto da cortesia que o botão quer ser. Se a última
//    mensagem nossa já for o aviso, a rota recusa com 409 em vez de enviar.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const cliente_id = String(b?.cliente_id ?? "");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const cfg = await lerCrmConfig(sb);
  const texto = String(cfg.texto_pausa ?? "").trim();
  if (!texto) {
    return Response.json({ error: "o texto do aviso de pausa está vazio — defina em Administração → Mecanismos" }, { status: 422 });
  }

  // Canal de envio efetivo, e a janela CONTADA NELE. Sem isso, um cliente que
  // respondeu no RD faria a rota achar que a janela da Cloud está aberta.
  const canal = await canalDeResposta(sb, cliente_id).catch(() => "rd" as const);

  let q = sb.from("mensagens")
    .select("id,enviada_por,conteudo,criada_em,linha_id")
    .eq("cliente_id", cliente_id)
    .neq("tipo", "evento_sistema")
    .order("criada_em", { ascending: false })
    .limit(20);
  q = filtroLinhas(q, cfg);
  const { data: ultimas, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const doCanal = (m: any) => (canal === "rd" ? !m.linha_id : !!m.linha_id);
  const msgs = (ultimas ?? []).filter(doCanal);

  const ultimaRecebida = msgs.find((m: any) => m.enviada_por === "customer");
  const abertaAte = ultimaRecebida
    ? new Date(ultimaRecebida.criada_em).getTime() + 24 * 3600 * 1000
    : 0;
  if (Date.now() >= abertaAte) {
    return Response.json({
      error: ultimaRecebida
        ? "A janela de 24h fechou — o aviso de pausa não pode ser enviado, e não vale um template."
        : "Esta cliente ainda não respondeu, então não há janela aberta para avisar.",
      foraDaJanela: true,
    }, { status: 422 });
  }

  // Trava de repetição: a ÚLTIMA mensagem nossa já é o aviso?
  const ultimaNossa = msgs.find((m: any) => m.enviada_por === "operator");
  if (ultimaNossa && String(ultimaNossa.conteudo ?? "").trim() === texto) {
    return Response.json({
      error: "Esta cliente já recebeu o aviso de pausa — a última mensagem enviada foi ele.",
      jaAvisado: true,
    }, { status: 409 });
  }

  // Delega o envio: um caminho só, com o roteamento e os erros que já existem.
  const r = await fetch(new URL("/api/send-message", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: req.headers.get("cookie") ?? "" },
    body: JSON.stringify({ cliente_id, texto }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return Response.json(j, { status: r.status });

  return Response.json({ ok: true, texto });
}
