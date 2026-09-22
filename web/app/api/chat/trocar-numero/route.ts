import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeMexerNoCadastro } from "../../../../lib/chatEscopo";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";
import { normalizarTelefone, tel8De } from "../../../../lib/telefone";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// TROCAR O NÚMERO DA CLIENTE PELO CHAT (pedido do usuário, 22/09/2026)
//
// A cliente mudou de número, ou o número está errado no WinThor. Ninguém do
// time tem acesso ao WinThor, e o `murano-clientes-v2` é somente leitura
// (§10.1) — além de ser um espelho que o sync reescreveria (0117). Então:
//
//   1. o número muda AQUI, no Pulse, em `clientes.telefone` — e passa a valer
//      NA HORA: é o campo que o envio usa (`/api/send-message`) e o que o
//      webhook usa para ligar a mensagem que chega (8 últimos dígitos);
//   2. a correção vai para a FILA do supervisor, `cadastro_atualizacao`
//      (0117, /admin → 🔄 Atualização cadastral), que a digita no WinThor.
//
// ⚠️ DUAS RECUSAS, e o porquê de cada uma:
//
//   · o número já é de OUTRA conversa do Pulse → não troca e não unifica;
//     devolve a conversa existente para a tela oferecer "abrir". Juntar as duas
//     é o mecanismo de unificar contatos (0141), que não está aplicado.
//
//   · o número é, no WinThor, de OUTRO cliente ativo → não troca. A 0132 faz o
//     telefone da conversa mandar no vínculo: em até 10 minutos a reconciliação
//     passaria esta conversa para aquele cadastro — um erro de digitação
//     transformaria a cliente em outra pessoa (nome, carteira, compras).
//     Número que o WinThor NÃO conhece não tem esse risco: a 0132 não desliga
//     ninguém por isso, e o vínculo por CPF segue.
//
// QUEM PODE: `podeMexerNoCadastro` — quem atende a conversa, quem pegou uma da
// fila, e quem não tem carteira (admin, home e pós-venda). É a mesma régua de
// `/api/chat/cadastro` e `/api/chat/vincular`; esta rota nasceu mais apertada
// (só admin) e o pós-venda batia num 403 (22/09). Decidido aqui e não na tela:
// a aba pode estar aberta desde antes de uma troca de papel.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const usuario = usuarioDaSessao();

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const cliente_id = String(b?.cliente_id ?? "").trim();
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  if (/^(winthor|venda):/.test(cliente_id)) {
    return Response.json({ error: "este card vem do ERP, não é uma conversa" }, { status: 422 });
  }
  const novo = normalizarTelefone(String(b?.telefone ?? ""));
  if (!novo) {
    return Response.json({ error: "Número incompleto. Digite com DDD — ex.: (91) 98166-0019." }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ---- quem pode --------------------------------------------------------
  if (!(await podeMexerNoCadastro(sb, cliente_id, sessao))) {
    return Response.json({ error: "Esta conversa é de outra carteira." }, { status: 403 });
  }

  const { data: cli } = await sb.from("clientes").select("id,telefone,nome_completo").eq("id", cliente_id).maybeSingle();
  if (!cli) return Response.json({ error: "conversa não encontrada" }, { status: 404 });

  // ⚠️ "O MESMO NÚMERO" é DDD + 8 últimos dígitos, não só os 8 (22/09/2026).
  // Comparar só o tel8 recusava justamente a correção mais comum: o número
  // certo com o DDD errado — (94) 8938-1821 → (91) 8938-1821. O nono dígito e
  // o 55 continuam fora da conta: com ou sem eles é o mesmo telefone.
  const t8 = tel8De(novo);
  const dddDe = (t: string | null) => normalizarTelefone(String(t ?? ""))?.slice(2, 4) ?? null;
  if (tel8De(String(cli.telefone ?? "")) === t8 && dddDe(cli.telefone) === dddDe(novo)) {
    return Response.json({ error: "Esse já é o número desta conversa." }, { status: 400 });
  }

  // ---- 1ª recusa: o número já é de outra conversa -------------------------
  const { data: outras } = await sb.from("clientes").select("id,nome_completo,telefone")
    .like("telefone", `%${t8}`).neq("id", cliente_id).limit(5);
  const outra = (outras ?? []).find((o: any) => tel8De(String(o.telefone ?? "")) === t8);
  if (outra) {
    return Response.json({
      error: "Esse número já é de outra conversa. Nada foi trocado — abra a conversa existente.",
      conflito: { cliente_id: outra.id, nome: outra.nome_completo ?? null },
    }, { status: 409 });
  }

  // ---- o vínculo com o WinThor desta conversa -----------------------------
  const { data: vinc } = await sb.from("wth_vinculo").select("codcli").eq("cliente_id", cliente_id).maybeSingle();
  const codcli = vinc?.codcli != null ? Number(vinc.codcli) : null;

  // ---- 2ª recusa: no WinThor o número é de OUTRO cliente ativo -----------
  const { data: noErp } = await sb.from("wth_carteira").select("codcli,nome").eq("tel8", t8).eq("ativo", true).limit(5);
  const deOutro = (noErp ?? []).find((w: any) => Number(w.codcli) !== codcli);
  if (deOutro) {
    return Response.json({
      error: `No WinThor, esse número é de outro cliente (${deOutro.codcli} - ${deOutro.nome}). ` +
        "Trocar aqui passaria esta conversa para aquele cadastro. Confira o número; se estiver certo, o cadastro " +
        "do WinThor precisa ser corrigido antes.",
      erpOutro: { codcli: deOutro.codcli, nome: deOutro.nome },
    }, { status: 409 });
  }

  // ---- a troca, no Pulse ----------------------------------------------------
  const antigo = cli.telefone ?? null;
  const { error: eUp } = await sb.from("clientes").update({ telefone: novo }).eq("id", cliente_id);
  if (eUp) return Response.json({ error: eUp.message }, { status: 500 });

  // ---- a fila do supervisor (só quem tem cadastro no WinThor) ------------
  // Conversa sem vínculo não tem o que corrigir no ERP: a troca vale só aqui.
  let fila: "nova" | "atualizada" | null = null;
  if (codcli != null) {
    const { data: erp } = await sb.from("wth_carteira").select("telefone").eq("codcli", codcli).maybeSingle();
    const observacao = `troca de número pelo chat — antes no Pulse: ${antigo ?? "vazio"}`;
    // um pedido PENDENTE por conversa: trocar duas vezes antes de o supervisor
    // agir atualiza o pedido em vez de empilhar dois números para a mesma pessoa
    const { data: pendente } = await sb.from("cadastro_atualizacao").select("id")
      .eq("cliente_id", cliente_id).eq("campo", "telefone").eq("status", "pendente")
      .order("criada_em", { ascending: false }).limit(1).maybeSingle();
    if (pendente) {
      await sb.from("cadastro_atualizacao")
        .update({ valor_novo: novo, por: usuario ?? sessao, criada_em: new Date().toISOString(), observacao })
        .eq("id", pendente.id);
      fila = "atualizada";
    } else {
      const { error: eFila } = await sb.from("cadastro_atualizacao").insert({
        cliente_id, codcli, campo: "telefone",
        valor_atual: erp?.telefone ?? null, valor_novo: novo,
        origem: "consultor", por: usuario ?? sessao, observacao,
      });
      if (!eFila) fila = "nova";
    }
  }

  return Response.json({
    ok: true,
    telefone: novo,
    fila,
    aviso: fila
      ? "Número trocado. A correção foi para a fila do WinThor (o supervisor digita lá)."
      : "Número trocado. Esta conversa não tem cadastro no WinThor, então não há o que corrigir lá.",
  });
}
