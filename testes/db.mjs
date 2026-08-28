// -----------------------------------------------------------------------------
// Acesso ao banco para os testes. service_role => ignora RLS (§12.5).
//
// ⚠️ É O BANCO DE PRODUÇÃO. Não existe ambiente de teste neste projeto.
// Leitura à vontade; escrita só no que este arquivo sabe limpar (ver `limpar`).
//
// Só PostgREST — não há conexão SQL direta aqui de propósito: o que a suíte
// consegue medir é o que o app também consegue, então um teste que passa prova
// algo sobre o app, não sobre um caminho privilegiado que ninguém usa.
// -----------------------------------------------------------------------------
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

/** dotenv minimalista — evita depender do pacote e do cwd. */
export function lerEnv(...arquivos) {
  const env = {};
  for (const a of arquivos) {
    const p = join(RAIZ, a);
    if (!existsSync(p)) continue;
    for (const linha of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linha);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  }
  return env;
}

export const ENV = lerEnv(".env", "web/.env.local");

if (!ENV.SUPABASE_URL || !ENV.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes em .env ou web/.env.local");
}

export const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Contagem EXATA, sem trazer linha.
 *
 * §12: somar linhas de um SELECT mente — o PostgREST corta em 1000 sem avisar,
 * e §61.2 mostra o estrago: um `limit` sobre um universo não medido é um filtro
 * invisível. Toda pergunta "quantos" desta suíte passa por aqui.
 */
export async function contar(tabela, ajusta = (q) => q) {
  const { count, error } = await ajusta(sb.from(tabela).select("*", { count: "exact", head: true }));
  if (error) throw new Error(`contar(${tabela}): ${error.message}`);
  // ⚠️ MEDIDO EM 27/08/2026: com `head:true`, supabase-js NÃO devolve erro para
  // relação inexistente — devolve `error: null` e `count: null` (o corpo do 404
  // é descartado junto com o corpo da resposta). Um `count ?? 0` aqui vira ZERO
  // SILENCIOSO, que é exatamente a doença da §61.2. `null` nunca é zero.
  if (count === null || count === undefined) {
    throw new Error(`contar(${tabela}): count nulo — relação inexistente ou consulta recusada (head:true esconde o erro)`);
  }
  return count;
}

/**
 * Uma view/tabela existe e responde?
 *
 * Usa GET de verdade (limit 1), NÃO `head:true` — ver a nota em `contar`: head
 * mente, dizendo ok para tabela que não existe. Este helper já produziu um
 * falso positivo nesta suíte antes de ser corrigido.
 */
export async function existe(rel) {
  const { error } = await sb.from(rel).select("*").limit(1);
  return { ok: !error, erro: error?.message ?? null };
}

/** Colunas de uma tabela, via uma linha qualquer (vazia => lista vazia). */
export async function colunas(tabela) {
  const { data, error } = await sb.from(tabela).select("*").limit(1);
  if (error) throw new Error(`colunas(${tabela}): ${error.message}`);
  return data?.[0] ? Object.keys(data[0]) : [];
}

// ---------------------------------------------------------------------------
// Rastro de teste: tudo que a suíte escreve no banco é registrado aqui e
// removido no fim. §0 da definição do agente: lixo de teste em tabela de
// produção vira dado de negócio errado três meses depois.
// ---------------------------------------------------------------------------
const rastro = [];

/** Registra algo a apagar. `apagar` recebe o client e faz a remoção. */
export function anotarRastro(descricao, apagar) {
  rastro.push({ descricao, apagar });
}

export function rastroPendente() {
  return rastro.map((r) => r.descricao);
}

/** Remove, na ordem inversa da criação. Devolve o que NÃO conseguiu remover. */
export async function limpar() {
  const sobrou = [];
  while (rastro.length) {
    const r = rastro.pop();
    try {
      await r.apagar(sb);
    } catch (e) {
      sobrou.push(`${r.descricao} — ${e.message}`);
    }
  }
  return sobrou;
}

// ---------------------------------------------------------------------------
// Interruptores globais: ler, anotar, restaurar.
//
// §0 / §60.7: marcar um desenho novo no /admin jogou a equipe inteira para o
// layout `original` em silêncio. Quem liga, desliga — e o valor original tem
// de estar guardado ANTES de qualquer escrita.
// ---------------------------------------------------------------------------
export async function lerConfig() {
  const { data, error } = await sb.from("crm_config").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(`lerConfig: ${error.message}`);
  return data;
}

/** Escreve campos em crm_config e agenda a restauração dos valores anteriores. */
export async function mexerConfig(campos) {
  const antes = await lerConfig();
  const volta = {};
  for (const k of Object.keys(campos)) volta[k] = antes?.[k] ?? null;
  const { error } = await sb.from("crm_config").update(campos).eq("id", 1);
  if (error) throw new Error(`mexerConfig: ${error.message}`);
  anotarRastro(`crm_config ${JSON.stringify(campos)} -> restaurar ${JSON.stringify(volta)}`, async (c) => {
    const { error } = await c.from("crm_config").update(volta).eq("id", 1);
    if (error) throw new Error(error.message);
  });
  return antes;
}

export const AGORA = () => new Date().toISOString();
