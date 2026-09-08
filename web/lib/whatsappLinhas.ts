// Descoberta de números Cloud API na Meta, para `chat_linha` não depender de
// alguém digitar o phone_number_id certo à mão (0123).
//
// SÓ LEITURA: `GET /{waba}/phone_numbers` lista os números já cadastrados na
// WABA — nada aqui cria, ativa ou muda número nenhum do lado da Meta. Quem
// decide o que fazer com o resultado é a rota que chama isto
// (app/api/admin/linhas), que faz o upsert em `chat_linha`.
//
// Por que precisa da WABA e não só do token: um token de system user pode
// enxergar várias contas do WhatsApp; sem dizer QUAL WABA, não há como saber
// que números pedir. `WHATSAPP_WABA_ID` (a WABA que este CRM já usa hoje) é o
// padrão — um número novo cadastrado NA MESMA conta aparece sem precisar de
// nada além do rótulo. Uma WABA diferente exige passar `wabaId` explícito
// (a tela aceita o campo, mas ele é opcional).

import { envWa } from "./whatsapp";

const GRAPH_VERSION = "v22.0";

export type NumeroMeta = {
  phone_number_id: string;
  /** display_phone_number da Meta, ex.: "+55 91 8166-0019". Cru, sem normalizar. */
  numero: string | null;
  /** verified_name — o nome que aparece pro cliente no WhatsApp. */
  nome: string | null;
  qualidade: string | null;
};

/**
 * Lista os números Cloud API de uma WABA. Lança se o token não tiver
 * permissão (`whatsapp_business_management`) ou a WABA não existir/não for
 * alcançável por este token — a mesma classe de erro que `/api/whatsapp/diag`
 * já trata em outros lugares deste projeto.
 */
export async function listarNumerosMeta(wabaId?: string): Promise<NumeroMeta[]> {
  const token = envWa("WHATSAPP_TOKEN");
  const waba = (wabaId ?? "").trim() || envWa("WHATSAPP_WABA_ID");

  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${waba}/phone_numbers` +
    `?fields=id,display_phone_number,verified_name,quality_rating`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j?.error ?? {};
    const detalhe = [e.error_data?.details, e.error_user_msg, e.message]
      .map((p: unknown) => String(p ?? "").trim()).find(Boolean) ?? `HTTP ${r.status}`;
    throw new Error(`Graph ${e.code ?? r.status}: ${detalhe}`);
  }

  return (j?.data ?? []).map((d: any) => ({
    phone_number_id: String(d.id),
    numero: d.display_phone_number ? String(d.display_phone_number) : null,
    nome: d.verified_name ? String(d.verified_name) : null,
    qualidade: d.quality_rating ? String(d.quality_rating) : null,
  }));
}

/** "+55 91 8166-0019" -> "+559181660019" — mesmo formato que `chat_linha.numero` já usa. */
export function normalizarNumero(n: string | null): string | null {
  if (!n) return null;
  const limpo = n.replace(/[^\d+]/g, "");
  return limpo || null;
}
