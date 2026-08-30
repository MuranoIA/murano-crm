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
  // `devolver: true` é a devolução para a fila (0112): o destino vira NULO.
  // Não é "transferir para ninguém" escrito com outra palavra — é o desfazer do
  // ✋ Pegar, e sem ele quem pega a conversa errada não tem saída.
  const devolver = b?.devolver === true;
  const para = devolver ? null : String(b?.para ?? "").trim().toLowerCase();
  const observacao = String(b?.observacao ?? "").trim().slice(0, 500) || null;
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  if (!devolver && !para) return Response.json({ error: "escolha para quem transferir" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // destino tem de ser vendedor ativo de verdade (carteira_config é a fonte única, §14.1)
  const { data: destino } = devolver ? { data: { ativo: true } } : await sb
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
    return Response.json({
      error: devolver ? "esta conversa já está na fila" : `a conversa já está com ${para}`,
    }, { status: 409 });
  }

  // Só se pode devolver o que NÃO tem dono comercial. Cliente com carteira/RCA
  // tem dono natural: devolvê-lo criaria um órfão que ninguém procura — o certo
  // ali é transferir para alguém, com nome.
  if (devolver && linha?.vendedor) {
    return Response.json({
      error: `este cliente é da carteira de ${linha.vendedor} — em vez de devolver, transfira para quem vai atender`,
    }, { status: 422 });
  }

  // -------------------------------------------------------------------------
  // ✋ PEGAR DA FILA — decisão ATÔMICA, no banco (migration 0120).
  //
  // Medido em 30/08/2026: duas consultoras clicando ao mesmo tempo na mesma
  // conversa recebiam AS DUAS um 200, e uma ficava achando que tinha pegado
  // a conversa da outra, sem aviso. `chat_transferencia` é append-only e não
  // tinha trava.
  //
  // Conferir DEPOIS de gravar não resolve — foi a primeira tentativa e o teste
  // reprovou de novo: ler depois de escrever enxerga quem escreveu ANTES,
  // nunca quem escreve DEPOIS, então cada chamada relia e via a si mesma como
  // a última. A função `chat_pegar_da_fila` faz checagem e inserção dentro de
  // um advisory lock por cliente_id, que é o único lugar onde isso é decidível.
  // -------------------------------------------------------------------------
  if (de === null && !devolver) {
    const { data: r, error: eRpc } = await sb.rpc("chat_pegar_da_fila", {
      p_cliente_id: cliente_id, p_para: para, p_por: usuario, p_observacao: observacao,
    });
    if (eRpc) {
      // Enquanto a 0120 não estiver aplicada a função não existe. Cair no
      // caminho antigo é melhor que recusar o Pegar: volta a haver corrida,
      // que é rara, em vez de a fila parar de funcionar, que é constante.
      if (!/chat_pegar_da_fila|function .* does not exist|PGRST202/i.test(eRpc.message ?? "")) {
        return Response.json({ error: eRpc.message }, { status: 500 });
      }
      console.warn("[transferir] 0120 ausente — pegar da fila sem trava:", eRpc.message);
    } else {
      if (!r?.ok) {
        return Response.json({
          error: `${r?.dono} pegou esta conversa primeiro.`,
          perdeuACorrida: true,
          dono: r?.dono ?? null,
        }, { status: 409 });
      }
      return Response.json({ ok: true, transferencia: r.transferencia });
    }
  }

  const { data, error } = await sb
    .from("chat_transferencia")
    .insert({ cliente_id, de_carteira: de, para_carteira: para, por: usuario, observacao })
    .select("id,cliente_id,de_carteira,para_carteira,por,observacao,criada_em")
    .single();
  if (error) {
    // Enquanto a 0112 não for aplicada, `para_carteira` ainda é NOT NULL e a
    // devolução falha com 23502. Erro cru de Postgres na tela do vendedor não
    // ajuda ninguém — o recado tem de dizer que é atualização pendente, não
    // erro dele.
    if (devolver && /para_carteira/.test(error.message ?? "")) {
      return Response.json({
        error: "devolver ainda não está disponível — falta aplicar a atualização 0112 no banco",
      }, { status: 503 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    ok: true, transferencia: data,
    aviso: devolver ? "Conversa devolvida — voltou para a fila de espera." : undefined,
  });
}
