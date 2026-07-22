import { createHash } from "node:crypto";

/** Extrai o nome da carteira a partir das tags do contato (tag "carteira <nome>").
 *  Ex: [{name:"carteira romulo"}] -> "romulo". Retorna null se não houver. */
export function carteiraDe(tags: any[] | undefined | null): string | null {
  const t = (tags ?? []).find((x: any) => String(x?.name ?? "").toLowerCase().startsWith("carteira"));
  if (!t) return null;
  const nome = String(t.name).replace(/^carteira\s*/i, "").trim().toLowerCase();
  return nome || null;
}

/** Detecta eventos de sistema (não são mensagens reais de pessoa).
 *  Ex: ">: Atendimento iniciado.", "...atendimento encerrado." */
export function isSistema(content: string | null | undefined): boolean {
  const c = String(content ?? "").toLowerCase().trim();
  return (
    c.startsWith(">") ||
    c.startsWith("...") ||
    c.includes("atendimento iniciado") ||
    c.includes("atendimento encerrado") ||
    c.includes("atendimento finalizado") ||
    c.includes("atendimento transferido") ||
    c.includes("atendimento retomado")
  );
}

/** Classifica a mensagem em: evento_sistema | template | mensagem */
export function tipoMensagem(m: any): "evento_sistema" | "template" | "mensagem" {
  if (isSistema(m?.content)) return "evento_sistema";
  if (m?.is_template_message === true) return "template";
  return "mensagem";
}

/** A API não fornece id de mensagem. Geramos um hash determinístico
 *  (cliente + data + conteúdo) para o UPSERT ser idempotente. */
export function idMensagem(clienteId: string, createdAt: string, conteudo: string): string {
  return createHash("sha1").update(`${clienteId}|${createdAt}|${conteudo ?? ""}`).digest("hex");
}

/** Converte string vazia/undefined em null (p/ colunas timestamptz). */
export function ts(v: any): string | null {
  return v ? String(v) : null;
}
