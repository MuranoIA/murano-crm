// ---------------------------------------------------------------------------
// A JANELA DE 24H, perguntada ao banco antes de falar com a Meta.
//
// Mensagem livre (texto, mídia, localização) só sai enquanto a cliente tiver
// falado nas últimas 24 horas. Passou disso, a Meta recusa com **131047** e só
// um template reabre a conversa.
//
// POR QUE ISTO EXISTE, e não bastava tratar o erro que a Meta devolve:
//
// Relatado em 12/09/2026 — "envio de localização não está funcionando". Fomos
// ao banco: **12 tentativas naquele dia, entre 13:46 e 14:59, todas para a
// mesma cliente, todas `failed` com 131047**. O envio não estava quebrado; a
// janela estava fechada e a tela não disse.
//
// ⚠️ E o erro NÃO chega na hora. Para a localização a Meta ACEITOU a chamada e
// devolveu um `wamid` de verdade — a falha só apareceu minutos depois, pelo
// webhook. Duas daquelas tentativas continuam presas em `status: "wait"` até
// hoje, sem recibo nenhum. Ou seja: tratar `e.foraDaJanela` no `catch`, como as
// rotas irmãs fazem, **não pega este caso**, porque não há exceção para pegar.
//
// O único jeito de avisar ANTES é olhar o que já sabemos: a última mensagem
// recebida daquela cliente, naquele número. O dado está aqui, custa uma consulta
// de índice, e é exatamente a mesma régua que a faixa do chat já desenha.
// ---------------------------------------------------------------------------

const VINTE_E_QUATRO_HORAS = 24 * 3600 * 1000;

export type Janela = {
  aberta: boolean;
  /** Quando a cliente falou por último naquele número (ISO), ou `null`. */
  ultimaRecebida: string | null;
  /** Quanto falta, em ms. Negativo ou `null` = fechada. */
  restaMs: number | null;
};

/**
 * A janela desta conversa NAQUELE número.
 *
 * ⚠️ A JANELA É POR NÚMERO (0102), não por conversa. Uma cliente que respondeu
 * há 10 minutos em OUTRA linha não tem janela aberta nesta — contar sobre a
 * conversa inteira faria a checagem liberar o envio e a Meta recusar mesmo
 * assim, que é o oposto do ponto.
 *
 * Sem saber a linha (`linha` nulo), vale qualquer mensagem que tenha linha —
 * o mesmo comportamento que a tela usa quando o servidor não informou o número.
 *
 * FALHA PARA O LADO DE DEIXAR PASSAR: se a consulta der erro, devolve `aberta`.
 * Uma instabilidade do banco não pode impedir uma mensagem legítima de sair —
 * e se a janela estiver mesmo fechada, a Meta recusa depois, que é o
 * comportamento de antes desta guarda existir.
 */
export async function janelaDaConversa(
  sb: { from: (t: string) => any },
  clienteId: string,
  linha?: string | null,
): Promise<Janela> {
  const abertaPorPadrao: Janela = { aberta: true, ultimaRecebida: null, restaMs: null };
  try {
    let q = sb
      .from("mensagens")
      .select("criada_em")
      .eq("cliente_id", clienteId)
      .eq("enviada_por", "customer")
      // Eventos de sistema não são fala da cliente — ficam de fora pela mesma
      // razão que ficam fora da régua de etapa do funil.
      .neq("tipo", "evento_sistema");
    q = linha ? q.eq("linha_id", linha) : q.not("linha_id", "is", null);

    const { data, error } = await q.order("criada_em", { ascending: false }).limit(1);
    if (error) return abertaPorPadrao;

    const ultima = data?.[0]?.criada_em ? String(data[0].criada_em) : null;
    if (!ultima) {
      // Nunca respondeu POR ESTE NÚMERO: para quem vai escrever é tão fechado
      // quanto a que expirou. O motivo muda o recado, a ação é a mesma.
      return { aberta: false, ultimaRecebida: null, restaMs: null };
    }
    const resta = VINTE_E_QUATRO_HORAS - (Date.now() - new Date(ultima).getTime());
    return { aberta: resta > 0, ultimaRecebida: ultima, restaMs: resta };
  } catch {
    return abertaPorPadrao;
  }
}

/** O recado que a tela mostra. Diz o motivo E a saída, nas duas situações. */
export function recadoDeJanelaFechada(j: Janela): string {
  return j.ultimaRecebida
    ? "Fora da janela de 24h do WhatsApp — a cliente não responde há mais de um dia. "
      + "Envie um TEMPLATE para reabrir a conversa."
    : "A cliente ainda não respondeu por este número, então a janela de 24h nunca "
      + "abriu. Só um TEMPLATE chega até ela.";
}
