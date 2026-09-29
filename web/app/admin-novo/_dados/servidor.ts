import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../lib/papel";

// ---------------------------------------------------------------------------
// A ÚNICA porta do /admin-novo para sessão e banco no servidor.
//
// Mesmo desenho do `chat-v2/_dados/servidor.ts`, e pelo mesmo motivo (spec §6):
// no Next 15+ `cookies()` vira assíncrono. Com o acesso espalhado por vários
// arquivos, a migração é uma caçada; com ele aqui, muda num lugar.
// ---------------------------------------------------------------------------

export type SessaoAdmin = { sessao: string; email: string | null };

export function sessaoAdmin(): SessaoAdmin | null {
  const c = cookies();
  const sessao = c.get("crm_sessao")?.value;
  if (!sessao || !podeAdmin(sessao)) return null;
  return { sessao, email: c.get("crm_email")?.value ?? null };
}

let cliente: SupabaseClient | null = null;

export function banco(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  if (!cliente) cliente = createClient(url, key, { auth: { persistSession: false } });
  return cliente;
}
