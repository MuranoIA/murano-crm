import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

// Thread completa de uma conversa (tela de chat). Diferente do /api/mensagens do
// card ampliado, devolve id/status/tipo (pros ticks de entrega e selo de template)
// e um lote maior. Mesma decisão do /api/mensagens: NÃO escopa por carteira —
// mensagens guardam a carteira de QUANDO foram enviadas (RCA anterior), filtrar
// por ela cortaria o histórico de quem trocou de RCA.
export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const cliente_id = new URL(req.url).searchParams.get("cliente_id");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const [{ data: cli }, { data, error }, { data: notas }, { data: transferencias }] = await Promise.all([
    sb.from("clientes").select("id,nome_completo,telefone,carteira").eq("id", cliente_id).maybeSingle(),
    sb.from("mensagens")
      .select("id,conteudo,enviada_por,tipo,status,criada_em,midia_tipo,midia_mime,midia_nome,midia_path")
      .eq("cliente_id", cliente_id)
      .order("criada_em", { ascending: false })
      .limit(200),
    // notas internas (migration 0080) — vêm à parte e o front intercala pela data.
    // Todas, sem limite de janela: são poucas por conversa, e esconder uma nota
    // que caiu fora das 200 últimas mensagens seria perder um recado da equipe.
    sb.from("chat_nota")
      .select("id,autor,texto,criada_em")
      .eq("cliente_id", cliente_id)
      .order("criada_em", { ascending: true }),
    // histórico de transferências (0081) — o "registro" pedido no P1 aparece na
    // própria conversa, no ponto em que a passagem aconteceu
    sb.from("chat_transferencia")
      .select("id,de_carteira,para_carteira,por,observacao,criada_em")
      .eq("cliente_id", cliente_id)
      .order("criada_em", { ascending: true }),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const mensagens = (data ?? [])
    .filter((m: any) => m.tipo !== "evento_sistema")
    .reverse(); // cronológico (mais antiga em cima)

  return Response.json({
    cliente: cli ? { id: cli.id, nome: cli.nome_completo, telefone: cli.telefone, carteira: cli.carteira } : null,
    mensagens,
    notas: notas ?? [],
    transferencias: transferencias ?? [],
    atualizado_em: new Date().toISOString(),
  });
}
