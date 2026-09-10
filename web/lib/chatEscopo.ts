import type { SupabaseClient } from "@supabase/supabase-js";
import { carteiraDe } from "./papel";

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

// ===========================================================================
// ENDEREÇO DE ATENDIMENTO — de quem é a conversa
//
// Até aqui, "dono de conversa" era sempre um slug de `carteira_config`, ou seja,
// um vendedor COM RCA no WinThor. Isso deixava admin, home e pós-venda de fora:
// eles enxergavam tudo e não podiam atender nada — não havia como transferir uma
// conversa para a Lais, nem ela ter as próprias.
//
// A saída ÓBVIA e errada seria criar uma carteira `lais`. `carteira_config` é a
// tabela de vendedor com RCA e alimenta umas trinta rotas comerciais: as colunas
// do board, os chips, o público do disparo em massa, os relatórios de venda, a
// fila de prospecção, a tela de divergência de carteira. A Lais viraria uma
// coluna no board e uma linha de relatório com R$ 0 de faturamento — o oposto do
// que foi pedido ("não haverá RCA ou transferência de cliente para carteira de
// fato, apenas conversas dentro do chat").
//
// Então há DOIS tipos de endereço, e um só por pessoa:
//
//     tem carteira  ->  o slug da carteira      ("milene", "romulo")
//     não tem       ->  `u:` + o e-mail         ("u:lais@muranoprofessional.com.br")
//
// ⚠️ UM SÓ POR PESSOA é a parte que importa. A primeira versão dava os dois
// endereços a quem tem carteira (o slug E o e-mail), e isso criaria duas caixas
// de entrada para a mesma pessoa: uma conversa transferida para
// `u:milene@...` não apareceria para quem filtrasse por `milene`, e ninguém
// entenderia por quê.
//
// ⚠️ E a carteira vem de `acesso`, NÃO do cookie. Romulo entra como `admin` e
// tem a carteira `romulo`: pelo cookie, `carteiraDe("admin")` é null e ele viraria
// `u:romulo@...` — deixando de ser dono das próprias conversas, que estão sob o
// slug. O papel ativo não pode mudar de quem é a conversa.
// ===========================================================================
const PREFIXO_PESSOA = "u:";

export const enderecoDePessoa = (email: string) => PREFIXO_PESSOA + email.trim().toLowerCase();
export const ehEnderecoDePessoa = (e: string | null | undefined): boolean =>
  !!e && e.startsWith(PREFIXO_PESSOA);
export const emailDoEndereco = (e: string): string => e.slice(PREFIXO_PESSOA.length);

/**
 * O endereço sob o qual ESTA pessoa atende, ou null se não há como saber (login
 * por senha, sem e-mail — nesse caso ela só observa).
 *
 * Uma consulta por chamada, pela chave primária de `acesso`. Barata, e é o preço
 * de não deixar o papel ativo decidir de quem é a conversa.
 */
export async function enderecoDeAtendimento(
  sb: SupabaseClient,
  sessao: string | null | undefined,
  usuario: string | null | undefined,
): Promise<string | null> {
  // vendedor logado: o próprio cookie já é o slug, sem ida ao banco
  const doCookie = carteiraDe(sessao);
  if (doCookie) return doCookie;
  if (!usuario || !usuario.includes("@")) return null;

  const { data } = await sb.from("acesso").select("carteira,ativo").eq("email", usuario).maybeSingle();
  if (data?.ativo === false) return null;
  return data?.carteira ? String(data.carteira) : enderecoDePessoa(usuario);
}

// ---------------------------------------------------------------------------
// SOU EU QUEM ATENDE ESTA CONVERSA?
//
// Nasceu para a marca de leitura (§18 item 3): admin, home e pós-venda abrem a
// conversa dos outros para CONFERIR, e conferir não é atender — marcar como
// lida ali apagaria o próprio número de "esperando resposta" no gesto de olhar.
//
// A régua é DONO EFETIVO, não papel, e a diferença não é teórica:
//   · Romulo entra como `admin` e TEM a carteira `romulo` — pelo papel, nunca
//     marcaria as próprias conversas;
//   · quem pega uma conversa da fila passa a atendê-la de verdade e precisa
//     marcar, mesmo sendo admin;
//   · um consultor que abre a conversa de outro também está só conferindo.
// Uma régua por papel erra nos três; esta acerta nos três com uma frase.
//
// Quem não tem endereço de atendimento (login por senha, sem e-mail) apenas
// observa: não marca leitura em conversa nenhuma.
// ---------------------------------------------------------------------------

/**
 * Três consultas pontuais, sendo duas em paralelo — o mesmo par que a rota de
 * transferência já faz para decidir permissão, mais o endereço de quem pergunta.
 * A alternativa barata seria a tela mandar "eu sou o dono": não serve. A aba pode
 * estar aberta desde antes de uma troca de papel (/api/trocar-papel reescreve o
 * cookie sem recarregar a página), e quem decide quem atende não pode ser quem
 * está pedindo.
 */
export async function souDonoDaConversa(
  sb: SupabaseClient,
  clienteId: string,
  sessao: string | null | undefined,
  usuario?: string | null,
): Promise<boolean> {
  const meu = await enderecoDeAtendimento(sb, sessao, usuario);
  if (!meu) return false;   // sem endereço de atendimento, não atende nada

  const [{ data: linha }, atrib] = await Promise.all([
    sb.from("vw_funil").select("cliente_id,vendedor").eq("cliente_id", clienteId).maybeSingle(),
    carregarAtribuicoes(sb),
  ]);
  const dono = donoEfetivo(clienteId, (linha?.vendedor as string) ?? null, atrib);
  return dono !== null && dono === meu;
}
