import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../lib/papel";
import { usuarioDaSessao } from "../../../lib/chatUsuario";

export const dynamic = "force-dynamic";

// Lista de conversas do CHAT (sidebar). Fonte: vw_funil — 1 linha por cliente com
// última mensagem/atividade, já com o dono (RCA atual) resolvido. Só clientes com
// conversa de verdade (ultima_atividade não nula — corta a fila de prospecção).
// Vendedor vê a própria carteira (filtro no SERVIDOR); admin/home veem tudo.
export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const carteira = carteiraDe(sessao);

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // paginado: o PostgREST corta em 1000 linhas
  const PAGE = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("vw_funil")
      .select("cliente_id,cliente,vendedor,etapa,telefone,ultima_atividade,ultima_mensagem,ultima_enviada_por")
      .not("ultima_atividade", "is", null)
      .order("ultima_atividade", { ascending: false })
      .range(from, from + PAGE - 1);
    if (carteira) q = q.eq("vendedor", carteira);
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // ids sintéticos (winthor:/venda:) não têm thread de mensagens — fora do chat
  const conversas = out.filter((c: any) =>
    typeof c.cliente_id === "string" &&
    !c.cliente_id.startsWith("winthor:") && !c.cliente_id.startsWith("venda:")
  );

  // ---- não lidas + status (P0 itens 3 e 4) --------------------------------
  // "não lida" = tem mensagem DO CLIENTE mais recente que a marca de leitura
  // deste usuário. Sem marca, a conversa inteira conta como não lida.
  const usuario = usuarioDaSessao();
  const [{ data: leituras }, { data: estados }] = await Promise.all([
    sb.from("chat_leitura").select("cliente_id,lida_ate").eq("usuario", usuario ?? ""),
    sb.from("chat_conversa").select("cliente_id,status,motivo"),
  ]);
  const lidaAte = new Map((leituras ?? []).map((l: any) => [l.cliente_id, l.lida_ate]));
  const estado = new Map((estados ?? []).map((e: any) => [e.cliente_id, e]));

  for (const c of conversas) {
    const marca = lidaAte.get(c.cliente_id);
    c.nao_lida = c.ultima_enviada_por === "customer" &&
      (!marca || new Date(c.ultima_atividade) > new Date(marca));
    const e = estado.get(c.cliente_id);
    c.status = e?.status ?? "aberta";
    c.motivo = e?.motivo ?? null;
  }

  return Response.json({
    conversas,
    nao_lidas: conversas.filter((c: any) => c.nao_lida).length,
    atualizado_em: new Date().toISOString(),
  });
}
