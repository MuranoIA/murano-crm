import type { SupabaseClient } from "@supabase/supabase-js";
import { podeCitar } from "./whatsapp";

// ---------------------------------------------------------------------------
// CITAR UMA MENSAGEM (responder citando, como no WhatsApp).
//
// Vale para mensagem da cliente e nossa, e para mídia — foto, áudio, vídeo,
// documento. Quem cita é sempre o operador; a cliente cita pelo aparelho dela e
// a citação já chegava pela `context` do webhook.
//
// ⚠️ A VALIDAÇÃO É NO SERVIDOR, e não é formalidade. `context.message_id` vai
// direto para a Meta: sem conferir, a tela poderia pedir para citar o wamid de
// OUTRA conversa. O Graph provavelmente recusaria, mas "provavelmente" não é
// régua de segurança — e o caminho em que ele aceita expõe a mensagem de uma
// cliente dentro da conversa de outra.
//
// ⚠️ E a citação é DESCARTÁVEL. Se o alvo não serve (id nosso `tmp:`, id
// herdado do RD, mensagem de outra conversa), a mensagem sai SEM citação em vez
// de falhar. Perder o enfeite é aborrecido; perder o que a pessoa escreveu, não
// é aceitável — e é o que aconteceria com um 131009 da Meta.
// ---------------------------------------------------------------------------

/**
 * Devolve o wamid que pode ser citado, ou `null`.
 *
 * Uma consulta, pela chave primária de `mensagens`, só quando há citação.
 */
export async function wamidParaCitar(
  sb: SupabaseClient,
  clienteId: string,
  alvo: unknown,
): Promise<string | null> {
  if (!podeCitar(alvo)) return null;
  const id = String(alvo);
  const { data } = await sb
    .from("mensagens")
    .select("id,cliente_id")
    .eq("id", id)
    .maybeSingle();
  // a mensagem tem de existir E ser DESTA conversa
  if (!data || data.cliente_id !== clienteId) return null;
  return id;
}
