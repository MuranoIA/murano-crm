import type { SupabaseClient } from "@supabase/supabase-js";
import { sendText, linhaDaConversa } from "./whatsapp";
import { ehEnderecoDePessoa, emailDoEndereco } from "./chatEscopo";

// ---------------------------------------------------------------------------
// Aviso automático de transferência para o pós-venda.
//
// Quando a conversa passa para quem atende o pós-venda, a cliente é avisada —
// em vez de ver, do nada, outra pessoa escrevendo por ali.
//
// Três coisas moldam o comportamento, e as três vieram de medição (14/09/2026),
// não de suposição:
//
//  1. A JANELA DE 24H FECHA EM UMA DE CADA CINCO. Nas 192 transferências já
//     feitas, a cliente tinha falado nas últimas 24h em 82% das que foram para
//     um vendedor e 79% das que foram para quem não tem carteira. Fora dessa
//     janela a Meta recusa mensagem livre (131047) e só um template reabre —
//     e template é cobrado. Então aqui NÃO se envia, e quem transferiu é
//     avisado na tela, na hora: falhar calado seria prometer um aviso que a
//     cliente nunca recebeu.
//
//  2. NÃO REPETE. A transferência vale nos dois sentidos desde 09/09 — o
//     pós-venda devolve e repassa —, então uma conversa que sobe e desce daria
//     à cliente o mesmo recado três ou quatro vezes.
//
//  3. NUNCA DERRUBA A TRANSFERÊNCIA. A transferência já aconteceu e é o que
//     importa; qualquer falha daqui vira um recado na resposta, nunca um erro
//     que faça a tela dizer que a transferência não foi feita.
//
// ⚠️ A trava NÃO pode ser "existe mensagem `tipo='auto'` recente", que é como a
// resposta de fora do horário se protege. As duas gravam `tipo='auto'` — é o
// que as mantém fora do indicador de tempo de resposta (§21.1) — e uma calaria
// a outra: uma cliente avisada de madrugada não seria avisada da transferência
// pela manhã. A marca vive na própria linha de `chat_transferencia`.
// ---------------------------------------------------------------------------

export type ResultadoDoAviso =
  | { enviado: true }
  | { enviado: false; motivo: "desligado" | "nao-e-pos-venda" | "ja-avisada" | "fora-da-janela" | "falhou"; detalhe?: string };

/** O que a tela mostra para cada desfecho. Um lugar só: o texto do recado é
 *  parte do comportamento, e espalhá-lo pela tela faria as duas versões
 *  divergirem no primeiro ajuste. */
export function recadoDoAviso(r: ResultadoDoAviso): string | null {
  if (r.enviado) return "A cliente foi avisada da transferência.";
  switch (r.motivo) {
    case "fora-da-janela":
      return "A cliente NÃO foi avisada: faz mais de 24h que ela não escreve, e fora dessa janela só template chega. Se quiser avisá-la, mande um template.";
    case "falhou":
      return `A transferência foi feita, mas o aviso à cliente não saiu${r.detalhe ? ` (${r.detalhe})` : ""}.`;
    // "já avisada", "desligado" e "não é pós-venda" são silêncio de propósito:
    // são o comportamento esperado, e um recado a cada transferência entre
    // consultores viraria ruído que ninguém lê.
    default:
      return null;
  }
}

/** O destino é alguém do pós-venda? Só endereço de pessoa (`u:<email>`) pode
 *  ser: quem tem carteira é vendedor, e é endereçado pelo slug dela. */
export async function destinoEhPosVenda(
  sb: SupabaseClient,
  destino: string | null,
): Promise<boolean> {
  if (!destino || !ehEnderecoDePessoa(destino)) return false;
  const { data } = await sb
    .from("acesso").select("papel").eq("email", emailDoEndereco(destino)).maybeSingle();
  return data?.papel === "pos-venda";
}

export async function avisarTransferencia(
  sb: SupabaseClient,
  clienteId: string,
  destino: string | null,
  telefone?: string | null,
): Promise<ResultadoDoAviso> {
  try {
    if (!(await destinoEhPosVenda(sb, destino))) return { enviado: false, motivo: "nao-e-pos-venda" };

    // `select("*")`, e não a lista de colunas: pedir uma coluna que ainda não
    // existe não devolve a linha sem o campo, devolve ERRO — e a leitura
    // inteira cairia no padrão. Custou duas horas em 27/08 (§62.6).
    const { data: cfg } = await sb.from("crm_config").select("*").eq("id", 1).maybeSingle();
    if (cfg?.aviso_pos_venda_ativo === false) return { enviado: false, motivo: "desligado" };

    const texto = String(cfg?.aviso_pos_venda_texto ?? "").trim();
    if (!texto) return { enviado: false, motivo: "desligado" };

    // já avisamos esta conversa há pouco?
    const horas = Number(cfg?.aviso_pos_venda_horas ?? 12) || 12;
    const desde = new Date(Date.now() - horas * 3600_000).toISOString();
    const { count: jaAvisou } = await sb
      .from("chat_transferencia")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .gte("avisada_em", desde);
    if ((jaAvisou ?? 0) > 0) return { enviado: false, motivo: "ja-avisada" };

    // A janela de 24h conta da última mensagem RECEBIDA. É a mesma régua da
    // faixa que o compositor mostra — se divergisse, a tela diria "janela
    // aberta" e o aviso falharia no mesmo segundo.
    const corte = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count: falouRecente } = await sb
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("enviada_por", "customer")
      .gte("criada_em", corte);
    if ((falouRecente ?? 0) < 1) return { enviado: false, motivo: "fora-da-janela" };

    const destinoTel = String(telefone ?? clienteId.replace(/^wa:/, "")).replace(/\D/g, "");
    if (!destinoTel) return { enviado: false, motivo: "falhou", detalhe: "sem telefone" };

    const linha = await linhaDaConversa(sb, clienteId);
    const { wamid } = await sendText(destinoTel, texto, linha);

    await sb.from("mensagens").upsert({
      id: wamid,
      cliente_id: clienteId,
      enviada_por: "operator",
      tipo: "auto",                    // fora do indicador de tempo de resposta
      conteudo: texto,
      status: "wait",
      criada_em: new Date().toISOString(),
      linha_id: linha,
    }, { onConflict: "id" });

    return { enviado: true };
  } catch (e: any) {
    console.error("[aviso-transferencia] não avisei:", e?.message ?? e);
    return { enviado: false, motivo: "falhou", detalhe: String(e?.message ?? e).slice(0, 120) };
  }
}

/** Marca a transferência como avisada. Separado do envio porque o id da linha
 *  só existe depois do insert, e porque a coluna pode ainda não existir: se a
 *  0138 não tiver sido aplicada, a mensagem JÁ saiu, e derrubar a resposta aqui
 *  faria a tela dizer que a transferência falhou quando ela foi feita. */
export async function marcarAvisada(sb: SupabaseClient, transferenciaId: number | string) {
  try {
    await sb.from("chat_transferencia")
      .update({ avisada_em: new Date().toISOString() })
      .eq("id", transferenciaId);
  } catch (e: any) {
    console.error("[aviso-transferencia] não marquei:", e?.message ?? e);
  }
}
