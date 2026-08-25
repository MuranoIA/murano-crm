// Normalização de telefone brasileiro para o formato que a Meta usa: só
// dígitos, com o 55 na frente e sem "+".
//
// Mora aqui, e não dentro da rota, por uma razão do Next: um arquivo `route.ts`
// só pode exportar os handlers (GET/POST/…) e as constantes de config —
// qualquer outro `export` quebra o build com um erro de tipo que não menciona a
// causa ("does not satisfy the constraint { [x: string]: never }").

/**
 * Aceita o que a pessoa digitar: com máscara, com +55, com ou sem o nono dígito.
 * Devolve `null` quando não dá para afirmar que é um número — melhor recusar do
 * que criar um contato com número truncado, que nunca vai receber nada e ainda
 * ocupa a fila como se fosse alguém.
 *
 * Só Brasil por ora: o CRM atende PA e MA (§ Consulta Clientes). Quando houver
 * número de fora, o lugar de afrouxar é aqui, não em cada chamador.
 */
export function normalizarTelefone(bruto: string): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  // 10 = DDD + 8 dígitos (fixo/antigo) · 11 = DDD + 9 dígitos
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  // 12/13 já vêm com o país; qualquer outro tamanho é digitação incompleta
  if (d.length !== 12 && d.length !== 13) return null;
  if (!d.startsWith("55")) return null;
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;
  return d;
}

/** Últimos 8 dígitos — a chave de match do projeto inteiro (§16.3). */
export const tel8De = (bruto: string): string =>
  String(bruto ?? "").replace(/\D/g, "").slice(-8);
