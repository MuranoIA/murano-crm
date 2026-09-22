// -----------------------------------------------------------------------------
// Cliente HTTP para as rotas do app, com cookie de sessão.
//
// O login deste CRM é um cookie de TEXTO PURO (`web/lib/papel.ts`) — não há
// OAuth a resolver:
//     admin  -> vê tudo + as 4 features restritas
//     home   -> vê todas as carteiras, sem elas
//     <slug> -> vendedor, vê só a própria carteira
// -----------------------------------------------------------------------------

export const BASE = process.env.CRM_BASE ?? "http://localhost:3100";

/**
 * QUAL tela de chat a suíte dirige.
 *
 * O `/chat-v2` é a reconstrução (CLAUDE.md §73), e a fase de paridade precisa
 * rodar a MESMA suíte contra as duas telas — duplicar os casos daria duas
 * verdades que divergiriam no primeiro ajuste.
 *
 *   node testes/run.mjs                       o chat de hoje
 *   CHAT_TELA=/chat-v2 node testes/run.mjs    a reconstrução
 *
 * ⚠️ Quem usa isto são os casos que NAVEGAM na tela. As rotas `/api/chat*` são
 * as mesmas para as duas e não mudam aqui.
 */
export const TELA_CHAT = process.env.CHAT_TELA ?? "/chat";

/** Sessão de teste. `romulo` é a carteira do próprio usuário (§2 da definição). */
export const SESSOES = {
  romulo: { crm_sessao: "romulo", crm_email: "ia@muranoprofessional.com.br" },
  admin: { crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" },
  home: { crm_sessao: "home", crm_email: "ia@muranoprofessional.com.br" },
  // `pos-venda` entrou em uso de verdade em 14/09/2026 (a atendente de
  // pós-venda). Enxerga o mesmo que `home` e não tem as 4 features de admin —
  // e é justamente por ser "igual a outro papel" que ele precisa de sessão
  // própria aqui: um papel novo que cai no ramo errado não dá erro, dá tela
  // vazia (§ o comentário de `tokenDePapel` em lib/papel.ts).
  posVenda: { crm_sessao: "pos-venda", crm_email: "ia@muranoprofessional.com.br" },
  luana: { crm_sessao: "luana", crm_email: "luana.teste@muranoprofessional.com.br" },
  anonimo: null,
};

const cookieHeader = (s) =>
  s ? Object.entries(s).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ") : "";

/**
 * GET/POST/PATCH/DELETE numa rota do app.
 * Devolve SEMPRE {status, json, texto, ms} — nunca lança por status != 200,
 * porque um 4xx costuma ser a resposta esperada de um teste de permissão.
 */
export async function chamar(caminho, { metodo = "GET", sessao = SESSOES.romulo, corpo, headers = {} } = {}) {
  const t0 = Date.now();
  const h = { ...headers };
  const ck = cookieHeader(sessao);
  if (ck) h.cookie = ck;
  let body;
  if (corpo !== undefined) {
    if (corpo instanceof FormData) body = corpo;
    else { h["content-type"] = "application/json"; body = JSON.stringify(corpo); }
  }
  let r;
  try {
    r = await fetch(BASE + caminho, { method: metodo, headers: h, body, redirect: "manual" });
  } catch (e) {
    return { status: 0, json: null, texto: String(e.message), ms: Date.now() - t0, erroRede: true };
  }
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* html ou vazio */ }
  return { status: r.status, json, texto, ms: Date.now() - t0, headers: r.headers };
}

export const get = (c, s) => chamar(c, { sessao: s });
export const post = (c, corpo, s) => chamar(c, { metodo: "POST", corpo, sessao: s });
export const patch = (c, corpo, s) => chamar(c, { metodo: "PATCH", corpo, sessao: s });
export const del = (c, corpo, s) => chamar(c, { metodo: "DELETE", corpo, sessao: s });

/** O servidor está de pé? Usado para PULAR (não falhar) quando não está. */
export async function servidorNoAr() {
  const r = await chamar("/api/chat", { sessao: SESSOES.admin });
  return !r.erroRede;
}

// ---------------------------------------------------------------------------
// Asserts. Lançam Error com mensagem que já explica o que se esperava — o
// runner imprime a mensagem, então ela é o relatório daquele passo.
// ---------------------------------------------------------------------------
export function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function igual(obtido, esperado, msg) {
  if (obtido !== esperado) throw new Error(`${msg}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
}

export function status(r, esperado, msg) {
  if (r.status !== esperado) {
    throw new Error(`${msg}: esperado HTTP ${esperado}, obtido ${r.status} — ${(r.texto ?? "").slice(0, 300)}`);
  }
}

/** Um de vários status aceitáveis. */
export function statusEntre(r, lista, msg) {
  if (!lista.includes(r.status)) {
    throw new Error(`${msg}: esperado HTTP ${lista.join("/")}, obtido ${r.status} — ${(r.texto ?? "").slice(0, 300)}`);
  }
}
