import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "./papel";

// Peças comuns das rotas de /api/admin/*. Existem porque são QUATRO rotas com a
// mesma guarda: repetir o par sessão+podeAdmin em cada uma é o tipo de código
// que um dia sai errado numa delas — e a que sair errado é a que expõe a
// configuração do sistema inteiro.

export function sbAdmin() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Sessão de admin + e-mail de quem está agindo. `erro` preenchido = pare e devolva. */
export function guardaAdmin(acao: string): { erro: Response } | { erro: null; email: string | null } {
  const ck = cookies();
  const sessao = ck.get("crm_sessao")?.value;
  if (!sessao) return { erro: Response.json({ error: "não autenticado" }, { status: 401 }) };
  if (!podeAdmin(sessao)) {
    return { erro: Response.json({ error: `apenas admin pode ${acao}` }, { status: 403 }) };
  }
  return { erro: null, email: ck.get("crm_email")?.value ?? null };
}

export async function corpo(req: Request): Promise<any | null> {
  try { return await req.json(); } catch { return null; }
}

export const texto = (v: unknown) => String(v ?? "").trim();

/** Slug de carteira: minúsculo, sem espaço nem acento — é chave em meio banco. */
export const slugificar = (v: unknown) =>
  texto(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_]/g, "");
