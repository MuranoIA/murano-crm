import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { VIEW_FUNIL_TELA } from "../../../../lib/crmConfig";
import { carteiraDe } from "../../../../lib/papel";
import { carregarAtribuicoes, donoEfetivo } from "../../../../lib/chatEscopo";
import { apontarParaCliente, ligarPorCpf, recadoDoVinculo } from "../../../../lib/vinculoCpf";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";

export const dynamic = "force-dynamic";

// "É A MESMA PESSOA" — o consultor decide o que o sistema não pode decidir.
//
// O CRM sugere o candidato do ERP pelo nome (§ trocou de número), mas nunca
// afirma identidade: homônimo existe. Este endpoint é o gesto humano que
// resolve — e, resolvido, tudo o que depende disso acontece de uma vez:
// o CPF entra em `clientes`, o vínculo se forma na hora, o histórico aparece,
// a conversa passa para o RCA do cadastro, e — se o telefone do ERP for outro —
// nasce o pedido de atualização para quem edita o WinThor (0117).
//
// O CPF NÃO vem do navegador: vem do cadastro do ERP que o consultor escolheu.
// Aceitar um CPF digitado aqui abriria o caminho de vincular um contato a
// qualquer cliente, sem o freio de nome que o caminho automático tem.
export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const cliente_id = String(b?.cliente_id ?? "");
  const codcli = Number(b?.codcli);
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  if (!Number.isFinite(codcli)) return Response.json({ error: "codcli ausente" }, { status: 400 });
  if (/^(winthor|venda):/.test(cliente_id)) {
    return Response.json({ error: "este card não é um contato" }, { status: 422 });
  }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Mesma régua do /api/chat/contato: dono efetivo, ou admin/home. Dono nulo é
  // a fila, e a fila é de todos.
  const minha = carteiraDe(sessao);
  if (minha) {
    const [{ data: f }, atrib] = await Promise.all([
      sb.from(VIEW_FUNIL_TELA).select("vendedor").eq("cliente_id", cliente_id).maybeSingle(),
      carregarAtribuicoes(sb),
    ]);
    const dono = donoEfetivo(cliente_id, (f as any)?.vendedor ?? null, atrib);
    if (dono && dono !== minha) {
      return Response.json({ error: "esta conversa é de outra carteira" }, { status: 403 });
    }
  }

  const por0 = usuarioDaSessao();

  // ---- TROCAR o cadastro de um contato JÁ vinculado (demanda #50) ----------
  //
  // Caminho separado, e não um `ligarPorCpf` com outro CPF: aquele recusa
  // quando já existe vínculo, de propósito. Aqui é o humano desfazendo uma
  // ligação que o sistema fez errado — e é por isso que o pedido precisa vir
  // com `trocar: true`, explícito. Um clique acidental no botão de vincular
  // nunca deve reapontar um contato que já tem dono.
  if (b?.trocar === true) {
    const r2 = await apontarParaCliente(sb, { cliente_id, codcli, por: por0 });
    if (r2.estado === "sem_cadastro") {
      return Response.json({ error: "esse cliente não está ativo no WinThor" }, { status: 422 });
    }
    if (r2.estado === "sem_cpf") {
      return Response.json({
        error: `"${r2.nome}" não tem CPF no cadastro do WinThor, então não há como formar o vínculo`,
      }, { status: 422 });
    }
    // A nota fica na conversa, não só no banco: quem abrir amanhã precisa saber
    // que o nome mudou por decisão de alguém, e de quem foi a decisão.
    await sb.from("chat_nota").insert({
      cliente_id, autor: por0 ?? "sistema",
      texto:
        `Cadastro corrigido: este número é de ${r2.para.nome} (cód. ${r2.para.codcli}` +
        (r2.para.rca_num != null ? `, RCA ${r2.para.rca_num}` : "") + ")." +
        (r2.de ? ` Antes estava em ${r2.de.nome} (cód. ${r2.de.codcli}).` : "") +
        (r2.carteira_muda ? " A conversa passa para a carteira do RCA novo." : ""),
    }).then(() => {}, () => { /* a nota é registro, não pode derrubar a correção */ });

    return Response.json({
      ok: true, ...r2,
      aviso:
        `Agora é ${r2.para.nome} (cód. ${r2.para.codcli}).` +
        (r2.carteira_muda ? " A conversa passa para a carteira do RCA desse cadastro." : ""),
    });
  }

  const { data: alvo } = await sb.from("wth_carteira")
    .select("cpf,nome").eq("codcli", codcli).maybeSingle();
  if (!alvo?.cpf) {
    return Response.json({
      error: "esse cliente do WinThor não tem CPF no cadastro, então não há como formar o vínculo",
    }, { status: 422 });
  }

  const por = por0;
  const r = await ligarPorCpf(sb, {
    cliente_id, cpf: String(alvo.cpf), por,
    // false de propósito: aqui QUEM afirma que é a mesma pessoa é o humano, e
    // ele está olhando os dois nomes na tela. Exigir igualdade justo aqui
    // recusaria o caso mais comum — "MARIA DA SILVA" no ERP e "Maria Silva" no
    // WhatsApp, que é exatamente o que ele acabou de conferir.
    origem: "consultor", exigirNomeIgual: false,
  });

  if (r.estado === "ligado" || r.estado === "ja_vinculado") {
    const recado = recadoDoVinculo(r);
    if (recado) {
      await sb.from("chat_nota").insert({
        cliente_id, autor: por ?? "sistema",
        texto: `Confirmado como a mesma pessoa. ${recado}`,
      });
    }
    return Response.json({
      ok: true, ...r,
      aviso: r.estado === "ja_vinculado"
        ? "este contato já estava vinculado"
        : "vinculado — o histórico aparece em instantes" +
          (r.estado === "ligado" && r.telefone_mudou
            ? ", e o pedido de atualização do telefone foi registrado" : ""),
    });
  }

  return Response.json({ error: `não consegui vincular (${r.estado})`, ...r }, { status: 422 });
}
