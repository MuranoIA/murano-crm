// Normalização de telefone brasileiro para o formato que a Meta usa: só
// dígitos, com o 55 na frente e sem "+".
//
// Mora aqui, e não dentro da rota, por uma razão do Next: um arquivo `route.ts`
// só pode exportar os handlers (GET/POST/…) e as constantes de config —
// qualquer outro `export` quebra o build com um erro de tipo que não menciona a
// causa ("does not satisfy the constraint { [x: string]: never }").

/**
 * Os 67 DDDs de fato atribuídos no Brasil — não é um intervalo contínuo (não
 * existe 20, 23, 25, 26, 29, 30, 36, 39, 50, 52, 56-60, 70, 72, 76, 78, 80, 90,
 * entre outros). Um cliente de FORA do Brasil cujo número completo (código do
 * país + local) também some 10 ou 11 dígitos passa despercebido por um
 * intervalo `11..99`, mas não por esta lista — foi assim que o número da
 * Mariana (código do Suriname, `597`) virou `55` + `59` (DDD inexistente) +
 * o resto, e ficou incomunicável (16/09/2026).
 */
export const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24,
  27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

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
  if (!DDDS_VALIDOS.has(ddd)) return null;
  return d;
}

/** Últimos 8 dígitos — a chave de match do projeto inteiro (§16.3). */
export const tel8De = (bruto: string): string =>
  String(bruto ?? "").replace(/\D/g, "").slice(-8);
