// Variáveis de um template do WhatsApp — os `{{1}}`, `{{2}}`… do corpo aprovado
// na Meta, que o consultor preenche na hora de enviar (compositor do botão
// TEMPLATE, no chat).
//
// Este módulo é PURO de propósito: as mesmas funções rodam no servidor
// (send-template, cadastro do admin) e no navegador. Se a régua morasse só no
// servidor, a tela deixaria digitar algo que a Meta recusa e o erro só
// apareceria depois do clique; se morasse só na tela, a rota confiaria no que o
// navegador mandou. Sem estado, sem env, sem import de nada — é o que permite
// importar dos dois lados.

/** Limite do corpo de um template na Meta, já com as variáveis substituídas. */
export const LIMITE_CORPO = 1024;

/**
 * Números das variáveis presentes no corpo, em ordem e sem repetição.
 * `"Oi {{1}}, {{2}}"` → `[1, 2]`.
 */
export function variaveisDe(corpo?: string | null): number[] {
  const achados = String(corpo ?? "").match(/\{\{\s*\d+\s*\}\}/g) ?? [];
  const nums = achados.map((m) => Number(m.replace(/\D/g, "")));
  return [...new Set(nums)].filter((n) => n > 0).sort((a, b) => a - b);
}

/**
 * A Meta recusa parâmetro com quebra de linha, tabulação ou mais de quatro
 * espaços seguidos. Em vez de barrar o consultor por isso — que é o tipo de
 * coisa que acontece ao colar texto e que ninguém deveria precisar saber — o
 * valor é higienizado antes de sair.
 */
export function limparVariavel(v: unknown): string {
  return String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * Corpo com cada `{{n}}` trocado pelo valor digitado — é o texto que a cliente
 * vai ler, e o que fica gravado em `mensagens`. Campo ainda vazio continua
 * aparecendo como `{{n}}`: na pré-visualização isso mostra o que falta, em vez
 * de abrir um buraco no meio da frase.
 */
export function aplicarVariaveis(corpo: string, valores: string[]): string {
  return String(corpo).replace(/\{\{\s*(\d+)\s*\}\}/g, (bruto, n) => {
    const v = valores[Number(n) - 1];
    return v ? v : bruto;
  });
}

/**
 * A Meta exige numeração seguida a partir de `{{1}}` — um corpo com `{{1}}` e
 * `{{3}}` é recusado na criação. Cobrado no cadastro, onde dá para corrigir.
 */
export function erroDeNumeracao(corpo: string): string | null {
  const vars = variaveisDe(corpo);
  const esperado = vars.map((_, i) => i + 1);
  if (vars.join(",") === esperado.join(",")) return null;
  return "numere os campos em sequência a partir de {{1}} — a Meta recusa {{1}} seguido de {{3}}";
}

/**
 * Mensagem de erro legível, ou `null` se dá para enviar. Mesma régua na tela
 * (que desabilita o botão) e na rota (que não confia na tela).
 *
 * `corpo` nulo é o template do RD Conversas: o texto mora no painel deles, então
 * aqui só dá para conferir que os campos foram preenchidos.
 */
export function conferirVariaveis(corpo: string | null | undefined, valores: string[]): string | null {
  const limpos = valores.map(limparVariavel);
  if (limpos.some((v) => !v)) return "nenhum campo do template pode ficar vazio";

  if (!corpo) return null;

  const vars = variaveisDe(corpo);
  if (limpos.length !== vars.length) {
    return `este template tem ${vars.length} campo${vars.length === 1 ? "" : "s"} para preencher`;
  }
  const texto = aplicarVariaveis(corpo, limpos);
  if (texto.length > LIMITE_CORPO) {
    return `o texto final ficou com ${texto.length} caracteres — o limite da Meta é ${LIMITE_CORPO}`;
  }
  return null;
}
