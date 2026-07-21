import * as jose from "node-jose";

let keystorePromise: Promise<jose.JWK.Key> | null = null;

function getKey(privateJwk: string): Promise<jose.JWK.Key> {
  if (!keystorePromise) {
    keystorePromise = jose.JWK.asKey(JSON.parse(privateJwk));
  }
  return keystorePromise;
}

// Alguns eventos do RD Conversas (ex: "Atendimento iniciado") gravam bytes de controle
// ASCII crus dentro do texto da mensagem, o que é JSON inválido e quebra o parser
// caso não sejam escapados antes.
function escapeRawControlChars(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code <= 0x1f ? "\\u" + code.toString(16).padStart(4, "0") : s[i];
  }
  return out;
}

// Alguns templates de mensagem usam aspas retas como marcador de lista (`" Nome completo`)
// sem escapar - isso é JSON inválido. Detecta aspas "de conteúdo" (cercadas por texto comum
// dos dois lados) vs aspas "estruturais" (delimitando chave/valor do JSON) e escapa só as
// primeiras.
function escapeContentQuotes(s: string): string {
  const isStructural = (ch: string | undefined) => ch !== undefined && "{[,:".includes(ch);
  const isClosingStructural = (ch: string | undefined) => ch === undefined || ":,}]".includes(ch);

  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) {
      const len = s[i + 1] === "u" ? 6 : 2;
      out += s.slice(i, i + len);
      i += len;
      continue;
    }
    if (ch === '"') {
      let j = out.length - 1;
      while (j >= 0 && out[j] === " ") j--;
      const prevMeaningful = j >= 0 ? out[j] : undefined;

      let k = i + 1;
      while (k < s.length && s[k] === " ") k++;
      const nextMeaningful = k < s.length ? s[k] : undefined;

      const structural = isStructural(prevMeaningful) || isClosingStructural(nextMeaningful);
      out += structural ? ch : '\\"';
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function safeJsonParse(s: string): unknown {
  return JSON.parse(escapeContentQuotes(escapeRawControlChars(s)));
}

export async function decryptJwe(jwe: string, privateJwk: string): Promise<unknown> {
  const key = await getKey(privateJwk);
  const result = await jose.JWE.createDecrypt(key).decrypt(jwe);
  // RD Station envia o payload em Latin-1 (ISO-8859-1), não UTF-8 - acentos viram U+FFFD se decodificado como utf-8.
  const text = result.plaintext.toString("latin1");
  let parsed: unknown = text;
  try {
    parsed = safeJsonParse(text);
  } catch {
    return text;
  }
  // O payload vem com JSON aninhado (uma string que por sua vez contém o JSON real) - desembrulha até virar objeto/array.
  while (typeof parsed === "string") {
    try {
      parsed = safeJsonParse(parsed);
    } catch {
      break;
    }
  }
  return parsed;
}
