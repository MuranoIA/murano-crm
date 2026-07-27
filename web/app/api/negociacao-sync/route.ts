import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { syncClienteMensagens } from "../../../lib/rdSync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Sync "quase tempo real" da coluna NEGOCIAÇÃO. O board chama isto em loop (~10s) enquanto
// aberto, passando os cliente_ids visíveis. Faz a checagem BARATA (/exists) de cada um e só
// busca+decripta (item 3) os que têm mensagem NOVA do cliente — assim ciclos sem novidade são
// rápidos e não estouram o tempo da função. Idempotente (mesmo id do ETL). 429 no /exists =
// pula esse card no ciclo (tenta no próximo); o fetch (rdSync) já re-tenta em 429/5xx.
export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let ids: string[] = [];
  try { ids = (await req.json())?.cliente_ids ?? []; } catch { /* body vazio */ }
  ids = [...new Set(ids.filter((x) => typeof x === "string" && x && !x.includes(":")))].slice(0, 12);
  if (!ids.length) return Response.json({ atualizados: [] });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rdUrl = process.env.RD_CONVERSAS_BASE_URL, rdToken = process.env.RD_CONVERSAS_TOKEN;
  if (!url || !key || !rdUrl || !rdToken) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: clis } = await sb.from("clientes").select("id,telefone,carteira").in("id", ids);
  const info = new Map((clis ?? []).map((c: any) => [c.id, c]));
  // baseline: a msg mais recente que já temos por cliente (pra saber se entrou algo novo)
  const { data: ult } = await sb.from("mensagens").select("cliente_id,criada_em").in("cliente_id", ids).order("criada_em", { ascending: false });
  const baseline = new Map<string, number>();
  for (const m of ult ?? []) if (!baseline.has(m.cliente_id)) baseline.set(m.cliente_id, new Date(m.criada_em).getTime());

  const tokenLimpo = String(rdToken).replace(/[^\x21-\x7E]/g, "");
  const atualizados: string[] = [];
  let idx = 0;
  const worker = async () => {
    while (idx < ids.length) {
      const id = ids[idx++];
      const c: any = info.get(id);
      if (!c?.telefone) continue;
      try {
        const ex = await fetch(new URL(`/v2/contacts/${c.telefone}/exists`, rdUrl), { headers: { Authorization: `Bearer ${tokenLimpo}` } });
        if (!ex.ok) continue; // 429/erro: pula, tenta no próximo ciclo
        const j: any = await ex.json();
        const lastRd = j?.data?.last_message_data?.created_at;
        const b = baseline.get(id) ?? 0;
        if (lastRd && new Date(lastRd).getTime() > b + 2000) {
          await syncClienteMensagens(sb, id, (c.carteira as string | null) ?? null);
          atualizados.push(id);
        }
      } catch { /* individual: ignora */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]); // conc 3

  return Response.json({ atualizados });
}
