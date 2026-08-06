import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../lib/papel";

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

  return Response.json({ conversas, atualizado_em: new Date().toISOString() });
}
