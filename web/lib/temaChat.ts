// ---------------------------------------------------------------------------
// OS TEMAS DO CHAT (28/09/2026, pedido do dono)
//
// São os mesmos do Café Code (o Painel de Demandas), com os valores copiados de
// lá — só os CLAROS por enquanto: os escuros pedem outra rodada, porque há ~46
// lugares no chat que hoje assumem fundo claro (texto branco sobre a barra,
// véus brancos, sombras tingidas) e cada um vira ficha antes de o escuro ficar
// legível.
//
// ⚠️ VALE SÓ PARA O /chat-v2. A folha do v2 é escopada em `.v2`, então o tema
// pinta a tela do chat e mais nada — board, /admin e o resto seguem como estão.
// É a decisão do dono: expandir depois, junto com o board v2. Tema pela metade
// no sistema inteiro pareceria defeito; numa tela só, parece escolha.
//
// Como funciona: o `data-tema` no elemento `.v2` redefine as fichas
// `--color-v2-*` (ver `v2.css`). NENHUM componente muda — é a prova de que a
// paleta estava mesmo em fichas, e não espalhada pelo código.
// ---------------------------------------------------------------------------

export const TEMAS_CHAT = ["murano", "atlantico", "cafe"] as const;
export type TemaChat = (typeof TEMAS_CHAT)[number];

export const TEMA_CHAT_PADRAO: TemaChat = "murano";

/** o cookie é lido no SERVIDOR, para a tela não piscar no tema errado */
export const COOKIE_TEMA_CHAT = "crm_chat_tema";

export const ROTULO_TEMA_CHAT: Record<TemaChat, string> = {
  murano: "Murano",
  atlantico: "Atlântico",
  cafe: "Café",
};

/** [marca, ação] — as duas metades da bolinha do seletor */
export const AMOSTRA_TEMA_CHAT: Record<TemaChat, [string, string]> = {
  murano: ["#621244", "#1a5fa8"],
  atlantico: ["#1a5fa8", "#a35c12"],
  cafe: ["#5b3a29", "#1f5c94"],
};

export const ehTemaChat = (v: unknown): v is TemaChat =>
  typeof v === "string" && (TEMAS_CHAT as readonly string[]).includes(v);

/** falha para o padrão: tema desconhecido no cookie não pode deixar a tela sem cor */
export const temaChatDe = (v: unknown): TemaChat => (ehTemaChat(v) ? v : TEMA_CHAT_PADRAO);
