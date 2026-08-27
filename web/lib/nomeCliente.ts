// Nome do cliente com o código do WinThor na frente: `1234 - ROMULO ALBUQUERQUE`.
//
// Pedido do usuário: é assim que o time fala do cliente no dia a dia — o código
// é o que se digita no ERP, no pedido e na consulta. Ter que abrir o cadastro
// para descobri-lo, com o nome bem ali, é um passo a mais em cada conversa.
//
// Custo: ZERO consulta nova. O `codcli` já vem no mesmo SELECT que traz o nome,
// tanto no board (`vw_funil_visivel.codcli`) quanto no chat — foi só pedir a
// coluna que a view já tinha. Formatar é string, não banco.
//
// Quem não tem código continua aparecendo só com o nome: o contato que ainda
// não casou com o WinThor é justamente o que não tem código, e inventar um
// placeholder ("— - FULANA") criaria a ilusão de cadastro onde não há.

/** `1234 - NOME`, ou só o nome quando não há código. */
export function nomeComCodigo(nome: string | null | undefined, codcli: number | string | null | undefined): string {
  const n = String(nome ?? "").trim();
  const c = codcli == null ? "" : String(codcli).trim();
  if (!c || !n) return n;
  // Já vem prefixado? Acontece com os nomes que a própria view monta como
  // fallback (`'cliente ' || codcli`) e com quem foi cadastrado assim na mão.
  // Prefixar de novo produziria "1234 - 1234 - NOME".
  if (new RegExp(`^${c}\\b`).test(n)) return n;
  return `${c} - ${n}`;
}
