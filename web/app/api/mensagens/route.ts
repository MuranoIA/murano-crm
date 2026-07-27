import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { veTudo } from "../../../lib/papel";

export const dynamic = "force-dynamic";

// Histórico recente de uma conversa (pro card ampliado). Últimas ~30 mensagens reais
// (exclui eventos de sistema), em ordem cronológica. Vendedor só lê a própria carteira.
export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const cliente_id = new URL(req.url).searchParams.get("cliente_id");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  let q = sb.from("mensagens")
    .select("conteudo,enviada_por,tipo,criada_em,vendedor_carteira")
    .eq("cliente_id", cliente_id)
    .order("criada_em", { ascending: false })
    .limit(60);
  if (!veTudo(sessao)) q = q.eq("vendedor_carteira", sessao); // vendedor só a própria carteira
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const mensagens = (data ?? [])
    .filter((m: any) => m.tipo !== "evento_sistema")
    .slice(0, 30)
    .reverse() // cronológico (mais antiga em cima)
    .map((m: any) => ({ c: m.conteudo, e: m.enviada_por, t: m.criada_em }));
  return Response.json({ mensagens });
}
