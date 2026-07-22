import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Cliente Supabase para o ETL (usa a SERVICE ROLE KEY — só roda no backend/job,
 * nunca no navegador). Lê as credenciais do .env.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env antes de rodar o ETL.");
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
