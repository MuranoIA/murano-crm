import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { syncClienteMensagens } from "../../../lib/rdSync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Sync "quase tempo real" da coluna NEGOCIAÇÃO. O board chama isto em loop (~10s) enquanto
// aberto, passando os cliente_ids visíveis. Faz o MESMO full fetch do botão ↻ (rdSync, que
// re-tenta em 429/5xx) para cada card — assim, se o RD estiver com a cota apertada, ele
// insiste em vez de pular (o /exists cru pulava no 429 e a negociação nunca atualizava).
// Idempotente (mesmo id do ETL). Poucos cards, então o full fetch cabe no tempo da função.
export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let ids: string[] = [];
  try { ids = (await req.json())?.cliente_ids ?? []; } catch { /* body vazio */ }
  ids = [...new Set(ids.filter((x) => typeof x === "string" && x && !x.includes(":")))].slice(0, 10);
  if (!ids.length) return Response.json({ atualizados: [] });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: clis } = await sb.from("clientes").select("id,carteira").in("id", ids);
  const cartDe = new Map((clis ?? []).map((c: any) => [c.id, (c.carteira as string | null) ?? null]));

  const atualizados: string[] = [];
  let idx = 0;
  const worker = async () => {
    while (idx < ids.length) {
      const id = ids[idx++];
      try {
        const r = await syncClienteMensagens(sb, id, cartDe.get(id) ?? null);
        if (r.gravadas > 0) atualizados.push(id);
      } catch { /* 429 persistente/erro individual: tenta no próximo ciclo */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]); // conc 3

  return Response.json({ atualizados });
}
