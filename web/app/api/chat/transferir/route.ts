import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe, veTudo } from "../../../../lib/papel";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";
import { carregarAtribuicoes, donoEfetivo } from "../../../../lib/chatEscopo";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Transferir a conversa para outro vendedor — o "transferir atendimento" do RD.
//
// NÃO mexe na carteira do cliente: carteira é o dono comercial, vem do RCA do
// WinThor (§10.3) e é escrita pelo ETL — um update nela seria desfeito no
// próximo upsert (§10.11) e desalinharia o board do ERP. Aqui grava-se uma
// linha em `chat_transferencia` (append-only) e a atribuição vigente passa a
// ser a última linha. Ver migration 0081.
//
// Quem pode: o dono efetivo atual da conversa, ou admin/home. Um vendedor não
// tira conversa da mão do outro.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value ?? null;
  const usuario = usuarioDaSessao();
  if (!sessao || !usuario) return Response.json({ error: "não autenticado" }, { status: 401 });
  const carteira = carteiraDe(sessao);
  const tudo = veTudo(sessao);

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const cliente_id = String(b?.cliente_id ?? "").trim();
  const para = String(b?.para ?? "").trim().toLowerCase();
  const observacao = String(b?.observacao ?? "").trim().slice(0, 500) || null;
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  if (!para) return Response.json({ error: "escolha para quem transferir" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // destino tem de ser vendedor ativo de verdade (carteira_config é a fonte única, §14.1)
  const { data: destino } = await sb
    .from("carteira_config").select("slug,ativo").eq("slug", para).maybeSingle();
  if (!destino || !destino.ativo) {
    return Response.json({ error: `“${para}” não é uma carteira ativa` }, { status: 400 });
  }

  // dono efetivo hoje = transferência vigente ?? carteira do funil
  const [{ data: linha }, atrib] = await Promise.all([
    sb.from("vw_funil").select("cliente_id,vendedor").eq("cliente_id", cliente_id).maybeSingle(),
    carregarAtribuicoes(sb),
  ]);
  const de = donoEfetivo(cliente_id, (linha?.vendedor as string) ?? null, atrib);

  // `de === null` = conversa SEM DONO (contato novo, sem carteira e nunca
  // transferido). Está na fila: qualquer um pode puxar, e é assim que a fila de
  // não atribuídos funciona — "pegar" é uma transferência de ninguém para mim.
  // Fora esse caso, um vendedor não tira conversa da mão do outro.
  if (!tudo && de !== null && de !== carteira) {
    return Response.json({ error: "essa conversa não está com você" }, { status: 403 });
  }
  if (de === para) {
    return Response.json({ error: `a conversa já está com ${para}` }, { status: 409 });
  }

  const { data, error } = await sb
    .from("chat_transferencia")
    .insert({ cliente_id, de_carteira: de, para_carteira: para, por: usuario, observacao })
    .select("id,cliente_id,de_carteira,para_carteira,por,observacao,criada_em")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, transferencia: data });
}
