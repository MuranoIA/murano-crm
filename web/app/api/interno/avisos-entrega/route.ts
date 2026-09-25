import { createClient } from "@supabase/supabase-js";
import { sendTemplate, linhaDaConversa } from "../../../../lib/whatsapp";
import { acharOuCriarContato } from "../../../../lib/contatoDoErp";
import { CABECALHO_SEGREDO, recusaDoSegredo, atenderChamada } from "../../../../lib/avisoEntrega";

export const dynamic = "force-dynamic";
// até 20 avisos por chamada, um envio à Meta de cada vez (~1 s cada)
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Aviso de entrega ao cliente (card #19 do Entregas). Quem chama é o pg_cron do
// HUB, a cada minuto, só quando há aviso pendente. Não há sessão: a porta é o
// segredo compartilhado no cabeçalho (`ENTREGAS_AVISO_SEGREDO`). A regra toda
// mora em `lib/avisoEntrega.ts`.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const recusa = recusaDoSegredo(req.headers.get(CABECALHO_SEGREDO), process.env.ENTREGAS_AVISO_SEGREDO);
  if (recusa === 503) return Response.json({ error: "avisos de entrega não configurados" }, { status: 503 });
  if (recusa === 401) return Response.json({ error: "não autorizado" }, { status: 401 });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Sem credencial não se PEGA nada da fila: pegar marca 'enviando', e item
  // nesse estado nunca volta sozinho (contrato). Recusar antes é o único jeito
  // de a falta de configuração não custar avisos.
  if (!url || !key || !process.env.WHATSAPP_TOKEN) {
    return Response.json({ error: "configuração ausente no servidor" }, { status: 503 });
  }

  // Corpo vazio ou inválido = chamada normal do pg_cron (ele manda `{}`).
  // `{ teste: {...} }` = modo de teste: envia UM aviso ao telefone informado e
  // não toca a fila nem o chat (ver `atenderChamada` em lib/avisoEntrega.ts).
  const corpo = await req.json().catch(() => ({}));
  const sb = createClient(url, key, { auth: { persistSession: false } });
  try {
    const r = await atenderChamada({
      sb,
      enviar: sendTemplate,
      acharContato: acharOuCriarContato,
      linhaDe: linhaDaConversa,
    }, corpo);
    return Response.json(r.corpo, { status: r.status });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
