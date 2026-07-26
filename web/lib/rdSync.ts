// Sync sob demanda de UMA conversa: busca o histórico no RD Conversas, decripta e faz
// upsert em `mensagens`. Serve pro "tempo real" do board (ex.: logo após disparar um
// template pelo botão) sem esperar o ciclo do ETL. Espelha a lógica de loadMensagens do
// ETL (src/etl/run.ts) — o id da mensagem é determinístico (idMensagem), então o upsert
// é idempotente e NÃO duplica quando o ETL reprocessar a mesma mensagem depois.
import { createHash } from "node:crypto";
import * as jose from "node-jose";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---- decrypt (porta de src/lib/decryptMessages.ts) ----
let keystorePromise: Promise<jose.JWK.Key> | null = null;
function getKey(privateJwk: string): Promise<jose.JWK.Key> {
  if (!keystorePromise) keystorePromise = jose.JWK.asKey(JSON.parse(privateJwk));
  return keystorePromise;
}
function escapeRawControlChars(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code <= 0x1f ? "\\u" + code.toString(16).padStart(4, "0") : s[i];
  }
  return out;
}
function escapeContentQuotes(s: string): string {
  const isStructural = (ch: string | undefined) => ch !== undefined && "{[,:".includes(ch);
  const isClosingStructural = (ch: string | undefined) => ch === undefined || ":,}]".includes(ch);
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length) { const len = s[i + 1] === "u" ? 6 : 2; out += s.slice(i, i + len); i += len; continue; }
    if (ch === '"') {
      let j = out.length - 1; while (j >= 0 && out[j] === " ") j--;
      const prevMeaningful = j >= 0 ? out[j] : undefined;
      let k = i + 1; while (k < s.length && s[k] === " ") k++;
      const nextMeaningful = k < s.length ? s[k] : undefined;
      const structural = isStructural(prevMeaningful) || isClosingStructural(nextMeaningful);
      out += structural ? ch : '\\"'; i++; continue;
    }
    out += ch; i++;
  }
  return out;
}
function safeJsonParse(s: string): unknown { return JSON.parse(escapeContentQuotes(escapeRawControlChars(s))); }

async function decryptJwe(jwe: string, privateJwk: string): Promise<unknown> {
  const key = await getKey(privateJwk);
  const result = await jose.JWE.createDecrypt(key).decrypt(jwe);
  const text = result.plaintext.toString("latin1"); // RD envia em Latin-1
  let parsed: unknown = text;
  try { parsed = safeJsonParse(text); } catch { return text; }
  while (typeof parsed === "string") { try { parsed = safeJsonParse(parsed); } catch { break; } }
  return parsed;
}

// ---- transform (porta de src/lib/transform.ts) ----
function isSistema(content: string | null | undefined): boolean {
  const c = String(content ?? "").toLowerCase().trim();
  return c.startsWith(">") || c.startsWith("...") ||
    c.includes("atendimento iniciado") || c.includes("atendimento encerrado") ||
    c.includes("atendimento finalizado") || c.includes("atendimento transferido") ||
    c.includes("atendimento retomado");
}
function tipoMensagem(m: any): "evento_sistema" | "template" | "mensagem" {
  if (isSistema(m?.content)) return "evento_sistema";
  if (m?.is_template_message === true) return "template";
  return "mensagem";
}
function idMensagem(clienteId: string, createdAt: string, conteudo: string): string {
  return createHash("sha1").update(`${clienteId}|${createdAt}|${conteudo ?? ""}`).digest("hex");
}
const ts = (v: any): string | null => (v ? String(v) : null);

// ---- fetch de UMA conversa ----
async function fetchHistory(baseUrl: string, token: string, clienteId: string): Promise<any[]> {
  const url = new URL("/v2/messages/history", baseUrl);
  url.searchParams.set("customer_id", clienteId);
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "50");
  const tokenLimpo = String(token ?? "").replace(/[^\x21-\x7E]/g, "");
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tokenLimpo}`, Accept: "application/json" } });
  const text = await r.text();
  if (!r.ok) throw new Error(`RD ${r.status} em /v2/messages/history: ${text.slice(0, 200)}`);
  const h: any = text ? JSON.parse(text) : {};
  if (typeof h?.messages !== "string" || h.messages.length === 0) return [];
  const dec: any = await decryptJwe(h.messages, process.env.RD_CONVERSAS_PRIVATE_JWK!);
  return Array.isArray(dec) ? dec : [];
}

/** Sincroniza as mensagens de UM cliente. Retorna quantas linhas gravou e a data da mais
 *  recente. Idempotente (mesmo id do ETL). Requer envs RD_CONVERSAS_* no ambiente. */
export async function syncClienteMensagens(
  sb: SupabaseClient, clienteId: string, carteira: string | null,
): Promise<{ gravadas: number; ultima: string | null }> {
  const baseUrl = process.env.RD_CONVERSAS_BASE_URL;
  const token = process.env.RD_CONVERSAS_TOKEN;
  if (!baseUrl || !token || !process.env.RD_CONVERSAS_PRIVATE_JWK) {
    throw new Error("Faltam envs RD_CONVERSAS_BASE_URL / RD_CONVERSAS_TOKEN / RD_CONVERSAS_PRIVATE_JWK");
  }
  const msgs = await fetchHistory(baseUrl, token, clienteId);
  const seen = new Set<string>();
  const rows: any[] = [];
  let ultima: string | null = null;
  for (const m of msgs) {
    const id = idMensagem(clienteId, m.created_at, m.content ?? "");
    if (seen.has(id)) continue;
    seen.add(id);
    const criada = ts(m.created_at);
    if (criada && (!ultima || criada > ultima)) ultima = criada;
    rows.push({
      id, cliente_id: clienteId, vendedor_carteira: carteira,
      enviada_por: m.sent_by ?? null, tipo: tipoMensagem(m), conteudo: m.content ?? null,
      is_reply: m.is_reply ?? null, status: m.status ?? null, criada_em: criada,
    });
  }
  if (rows.length) {
    const { error } = await sb.from("mensagens").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`upsert mensagens: ${error.message}`);
  }
  return { gravadas: rows.length, ultima };
}
