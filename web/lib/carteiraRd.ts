// Atribuição de CARTEIRA (dono comercial) no RD Conversas.
//
// Contrato descoberto por sondagem ao vivo em 19/08/2026 — a documentação do RD
// não cobre isto e o caminho "óbvio" está errado de ponta a ponta. O que vale:
//
//     POST /v2/wallets  { customer: "<_id do contato>", wallet: "<nome de exibição>" }
//     -> 204 No Content
//
// Armadilhas já pagas (não repagar):
//  1. `PATCH /v2/customers/{id}` NÃO EXISTE — 404 com "Not Found" em texto cru,
//     igual a qualquer rota inventada. Idem GET e PUT no mesmo path.
//  2. `employee_id` NÃO é carteira. `employee` é quem atendeu; a carteira é
//     `current_wallet`, e os dois concordam em ~59% dos casos (CLAUDE.md §10.3).
//  3. `PATCH /v2/contacts/{telefone}` responde 200 e edita o contato de verdade
//     (nome, e-mail, etc.), mas IGNORA EM SILÊNCIO qualquer campo de carteira.
//     Foi testado com nove nomes diferentes — todos 200, nenhum efeito.
//  4. `customer` é o **_id** do contato. Com telefone, responde 403
//     "Contato Inválido". Felizmente o _id é o mesmo `clientes.id` do Supabase.
//  5. `wallet` é o **nome de exibição** ("Milene Pamplona"), não o slug.
//  6. NÃO EXISTE REMOÇÃO. `DELETE /v2/wallets[/{nome}]` responde 404 cru, e
//     mandar `wallet` nulo ou ausente devolve "Carteira não localizada". Dá para
//     mover um contato ENTRE carteiras; nunca para deixá-lo sem carteira.
//  7. A validação é em duas etapas — contato primeiro ("Contato Inválido",
//     403), carteira depois ("Carteira não localizada", 404). Isso é útil no
//     diagnóstico: a mensagem diz qual das duas pontas está errada.

const RATE_MS = 1250; // ~48 req/min é o teto medido da API (CLAUDE.md §14.5)

export const esperaEntreChamadas = RATE_MS;

function ambiente() {
  const baseUrl = process.env.RD_CONVERSAS_BASE_URL;
  const token = process.env.RD_CONVERSAS_TOKEN;
  if (!baseUrl || !token) throw new Error("RD_CONVERSAS_BASE_URL/RD_CONVERSAS_TOKEN ausentes");
  // mesma higienização do cliente do ETL: caractere invisível colado no segredo
  // já derrubou este projeto duas vezes (RD e Graph) — ver src/lib/rdConversasClient.ts
  return { baseUrl, token: token.replace(/[^\x21-\x7E]/g, "") };
}

async function rd(metodo: string, caminho: string, corpo?: unknown) {
  const { baseUrl, token } = ambiente();
  const resposta = await fetch(new URL(caminho, baseUrl), {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    cache: "no-store",
  });
  const texto = await resposta.text();
  let json: any = null;
  try { json = JSON.parse(texto); } catch { /* 204 e erros crus não são JSON */ }
  return { status: resposta.status, texto, json };
}

/**
 * Slug a partir do nome de exibição da carteira no RD.
 * Réplica EXATA da regra do ETL (src/etl/run.ts): primeira palavra, minúscula.
 * "Milene Pamplona" -> "milene". Tem de ser idêntica, senão o slug daqui não
 * casa com o `clientes.carteira` que o ETL gravou e a tela mostra vazio.
 */
export const slugDaCarteira = (nome: string): string =>
  String(nome ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";

// Cache curto da lista de carteiras. Não é micro-otimização: a transferência de
// uma carteira grande é fatiada em dezenas de requisições, e cada uma precisa
// validar o destino — sem cache, são dezenas de chamadas gastas só para reler
// oito nomes que praticamente não mudam, dentro de uma cota de ~48/min que já é
// disputada com o ETL. O TTL é curto para carteira criada agora no painel do RD
// aparecer sem ninguém precisar reiniciar nada.
const CACHE_MS = 5 * 60_000;
let cache: { em: number; nomes: string[] } | null = null;

/** Nomes de exibição das carteiras existentes no RD. */
export async function carteirasDoRd(): Promise<string[]> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.nomes;

  const r = await comRetentativa(() => rd("GET", "/v2/wallets"));
  if (r.status !== 200) {
    // Cai para o cache vencido antes de desistir: perder a lista por um 429
    // passageiro cancelaria um lote inteiro que já estava no meio do caminho.
    if (cache) return cache.nomes;
    throw new Error(`GET /v2/wallets respondeu ${r.status}: ${r.texto.slice(0, 120)}`);
  }
  const lista = r.json?.wallets;
  if (!Array.isArray(lista)) throw new Error("GET /v2/wallets devolveu formato inesperado");

  const nomes = lista.map((n: unknown) => String(n));
  cache = { em: Date.now(), nomes };
  return nomes;
}

/**
 * Repete em 429 e 5xx, com espera crescente. A cota do RD é compartilhada com o
 * ETL e com os envios do board (§14.5), então 429 no meio de um lote é
 * ocorrência esperada, não excepcional — sem isso, um pico do ETL marcaria
 * dezenas de clientes como "falha" quando o que faltava era esperar.
 * Não repete 4xx de dado errado: contato inexistente não melhora com espera.
 */
async function comRetentativa<T extends { status: number }>(fn: () => Promise<T>, tentativas = 3): Promise<T> {
  let ultima!: T;
  for (let i = 0; i < tentativas; i++) {
    ultima = await fn();
    if (ultima.status !== 429 && ultima.status < 500) return ultima;
    if (i < tentativas - 1) await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  return ultima;
}

export type ResultadoAtribuicao =
  | { ok: true }
  | { ok: false; status: number; erro: string; recuperavel: boolean };

/**
 * Move UM contato para uma carteira. Idempotente: reatribuir à mesma carteira
 * responde 204 de novo, então repetir um lote que falhou no meio é seguro.
 */
export async function atribuirCarteira(customerId: string, nomeCarteira: string): Promise<ResultadoAtribuicao> {
  let r;
  try {
    r = await comRetentativa(() => rd("POST", "/v2/wallets", { customer: customerId, wallet: nomeCarteira }));
  } catch (e: any) {
    // falha de rede: vale a pena tentar de novo mais tarde
    return { ok: false, status: 0, erro: `rede: ${e?.message ?? e}`, recuperavel: true };
  }

  if (r.status === 204 || r.status === 200) return { ok: true };

  // A API devolve a mensagem útil em `message`; `error` é só o rótulo do status.
  const msg = String(r.json?.message ?? r.json?.error ?? r.texto ?? "").trim() || `HTTP ${r.status}`;
  return {
    ok: false,
    status: r.status,
    erro: msg,
    // 429 e 5xx passam; 403 (contato inválido) e 404 (carteira inexistente) não
    // melhoram com repetição — são dado errado, não instabilidade.
    recuperavel: r.status === 429 || r.status >= 500,
  };
}

/** Mensagem de erro pronta para a tela, a partir do status do RD. */
export function explicarErro(status: number, erro: string): string {
  if (status === 401) return "Token da API do RD expirado ou inválido. Contate o administrador.";
  if (status === 403) return `Contato recusado pelo RD (${erro}). O contato pode ter sido apagado lá.`;
  if (status === 404) return `Carteira não encontrada no RD (${erro}).`;
  if (status === 429) return "Limite de chamadas do RD atingido — tente de novo em instantes.";
  if (status >= 500) return `RD Conversas instável (${status}).`;
  if (status === 0) return erro;
  return `${erro} (HTTP ${status})`;
}
