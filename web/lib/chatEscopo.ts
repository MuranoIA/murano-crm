import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Quem atende cada conversa, depois das transferências (migration 0081).
//
// Regra: o dono efetivo de uma conversa no CHAT é
//     transferência vigente  ??  carteira do cliente (vw_funil.vendedor)
//
// A transferência NÃO muda a carteira do cliente — carteira é o dono comercial,
// vem do RCA do WinThor (§10.3) e é escrita pelo ETL. Transferir vale só aqui
// dentro, para o diálogo, como o "transferir atendimento" do RD.
//
// Usado por /api/chat (lista) e /api/chat/buscar (resultados da busca), que
// precisam da MESMA régua — senão uma conversa transferida sumiria de uma e
// apareceria na outra.
// ---------------------------------------------------------------------------
export type Atribuicoes = Map<string, { para: string | null; de: string | null }>;

export async function carregarAtribuicoes(sb: SupabaseClient): Promise<Atribuicoes> {
  // só conversas que já foram transferidas alguma vez — tabela pequena
  const { data } = await sb.from("vw_chat_atribuicao").select("cliente_id,para_carteira,de_carteira");
  return new Map((data ?? []).map((a: any) => [a.cliente_id, { para: a.para_carteira, de: a.de_carteira ?? null }]));
}

/**
 * ⚠️ NÃO é `atrib.get(id)?.para ?? vendedorDoFunil`. Desde a 0112 uma
 * transferência pode ter destino NULO — é assim que se devolve a conversa para
 * a fila. Com `??`, esse nulo seria descartado e o dono da carteira voltaria a
 * atender, que é o oposto de devolver.
 *
 * A régua correta tem dois degraus, não uma coalescência:
 *
 *     existe transferência  ->  vale o `para` dela, MESMO NULO
 *     não existe            ->  a carteira do cliente
 *
 * Mesma armadilha do `??` da §22.6.1: um valor "vazio" que deveria decidir, e
 * que o operador descarta em silêncio.
 */
export const donoEfetivo = (
  clienteId: string,
  vendedorDoFunil: string | null,
  atrib: Atribuicoes,
): string | null => {
  const t = atrib.get(clienteId);
  if (t) return t.para ?? null;      // nulo = devolvida para a fila
  return vendedorDoFunil ?? null;
};

// Anota a conversa com o dono efetivo e de onde ela veio (para o selo na lista),
// e diz se ela pertence ao escopo pedido. `carteira = null` (admin/home) vê tudo.
export function aplicaEscopo<T extends { cliente_id: string; vendedor: string | null }>(
  linhas: T[],
  atrib: Atribuicoes,
  carteira: string | null,
): (T & { vendedor: string | null; carteira_dona: string | null; transferida_de: string | null })[] {
  const out: any[] = [];
  for (const l of linhas) {
    const t = atrib.get(l.cliente_id);
    const dono = donoEfetivo(l.cliente_id, l.vendedor, atrib);
    if (carteira && dono !== carteira) continue;
    // `vendedor` passa a ser o dono EFETIVO: é o que o chat exibe e filtra.
    // De onde veio fica em `transferida_de` para o selo "recebida de fulano".
    // `carteira_dona` = o dono COMERCIAL cru, antes da transferência. A tela
    // precisa dele para saber se "devolver para a fila" faz sentido: cliente com
    // carteira tem dono natural, e devolvê-lo criaria um órfão. Sem isto o botão
    // apareceria e o servidor recusaria depois do clique.
    out.push({ ...l, vendedor: dono, carteira_dona: l.vendedor ?? null, transferida_de: t ? (t.de ?? null) : null });
  }
  return out;
}

// `.in()` com lista gigante estoura o tamanho da URL do PostgREST — quebra em lotes.
export function emLotes<T>(itens: T[], tamanho = 200): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}
