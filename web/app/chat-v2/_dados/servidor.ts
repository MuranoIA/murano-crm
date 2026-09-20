import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { escopoCarteira } from "../../../lib/verComo";
import { usuarioDaSessao } from "../../../lib/chatUsuario";
import { veTudo, carteiraDe } from "../../../lib/papel";

// ---------------------------------------------------------------------------
// A ÚNICA porta do chat-v2 para sessão e banco no servidor.
//
// Por que um arquivo só (spec §6): no Next 15+ `cookies()` vira assíncrono. Com
// o acesso espalhado por dez arquivos, a migração é uma caçada; com ele aqui,
// muda num lugar. A mesma razão vale para o cliente do Supabase — um só,
// service_role, server-side, como o resto do CRM (§12.2: o navegador nunca
// recebe chave).
// ---------------------------------------------------------------------------

export type Sessao = {
  sessao: string;
  usuario: string;
  /** carteira do escopo de LEITURA (respeita o "ver como") — null = vê tudo */
  carteira: string | null;
  /** carteira de verdade da pessoa, para autorização (§31.2) */
  carteiraReal: string | null;
  veTudo: boolean;
};

export function sessaoDoChat(): Sessao | null {
  const c = cookies();
  const sessao = c.get("crm_sessao")?.value;
  if (!sessao) return null;
  return {
    sessao,
    usuario: usuarioDaSessao() ?? sessao,
    carteira: escopoCarteira(),
    carteiraReal: carteiraDe(sessao),
    veTudo: veTudo(sessao),
  };
}

let cliente: SupabaseClient | null = null;

export function banco(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  // reaproveitar o cliente entre requisições evita recriar o pool a cada
  // abertura de tela; ele não guarda sessão de usuário (auth desligado).
  if (!cliente) cliente = createClient(url, key, { auth: { persistSession: false } });
  return cliente;
}
