// CPF: normalização, validação por dígito verificador, e caça ao CPF dentro de
// uma mensagem de WhatsApp.
//
// Por que o dígito verificador importa AQUI e não importava na ficha: na ficha
// quem digita é o consultor, olhando um documento. Aqui quem digita é a cliente,
// no meio de uma conversa, e o texto chega junto de preço, quantidade, CEP e
// número de pedido. Sem a checagem, "vou levar 12345678901 unidades" viraria um
// CPF e o contato seria vinculado ao cadastro de outra pessoa.
//
// A chance de 11 dígitos aleatórios passarem nos dois dígitos é ~1%. Com a
// exigência de que o CPF EXISTA no WinThor, o falso positivo fica desprezível.

export const soDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** Dígitos verificadores. Recusa também os 11 dígitos repetidos (111...). */
export function cpfValido(bruto: unknown): boolean {
  const d = soDigitos(bruto);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  for (const [ate, pos] of [[9, 10], [10, 11]] as const) {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (pos - i);
    const resto = (soma * 10) % 11;
    const dv = resto === 10 ? 0 : resto;
    if (dv !== Number(d[ate])) return false;
  }
  return true;
}

/**
 * O primeiro CPF válido dentro de um texto livre.
 *
 * Aceita as três formas que aparecem no WhatsApp: `123.456.789-01`,
 * `12345678901` e `123 456 789 01`. Não aceita uma sequência maior que 11
 * dígitos colados — número de pedido e código de barras entram por aí, e um
 * pedaço de 11 dígitos de dentro deles não é CPF de ninguém.
 */
export function acharCpfNoTexto(texto: unknown): string | null {
  const t = String(texto ?? "");
  // formatado, ou 11 dígitos isolados (delimitados por não-dígito)
  const candidatos = t.match(/\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}/g) ?? [];
  for (const c of candidatos) {
    const d = soDigitos(c);
    if (d.length !== 11) continue;
    // recusa se o trecho estiver colado num número maior (pedido, código)
    const i = t.indexOf(c);
    const antes = t[i - 1], depois = t[i + c.length];
    if ((antes && /\d/.test(antes)) || (depois && /\d/.test(depois))) continue;
    if (cpfValido(d)) return d;
  }
  return null;
}

/** Compara nomes ignorando acento, caixa e espaço repetido. */
export const chaveNome = (n: unknown): string =>
  String(n ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
