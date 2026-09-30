// Peças de forma repetidas nos formulários do painel (campanha e disparo), no
// padrão do Café Code (demanda #92): cantos quadrados (`rounded-lg`, nunca
// pílula), rótulo em caixa alta pequena, campo com 16px de fonte (abaixo disso o
// iOS dá zoom ao focar e o formulário pula) e alvo de toque de 48px.
// Cores só por token do v2 — nada de hex aqui.
export const ROTULO = "block text-[12px] font-bold uppercase tracking-[0.08em] text-v2-tinta-fraca";

export const CAMPO =
  "mt-1.5 h-12 w-full rounded-lg border border-v2-linha-forte bg-v2-superficie px-3 text-base text-v2-tinta outline-none focus:border-v2-azul";

/** chip de escolha (carteira, etapa, atendente); a cor do estado vem de quem usa */
export const CHIP = "flex h-9 items-center rounded-lg px-3 text-[13px] font-medium ring-1 ring-inset";

export const CHIP_LIGADO = "bg-v2-azul text-white ring-v2-azul";
export const CHIP_DESLIGADO = "bg-v2-superficie text-v2-tinta ring-v2-linha-forte hover:bg-v2-azul-claro";

/** ação secundária: contorno, cor de link */
export const BOTAO_CONTORNO =
  "flex h-10 items-center justify-center rounded-lg bg-v2-superficie px-4 text-[13.5px] font-semibold text-v2-azul ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-azul-claro disabled:opacity-50";
