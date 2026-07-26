import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { syncClienteMensagens } from "../../../lib/rdSync";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // dá folga p/ o retry enquanto o RD registra a msg enviada

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sincroniza SÓ uma conversa, sob demanda (tempo real do board — ex.: após disparar
// template). Idempotente: usa o mesmo id do ETL, então não duplica.
export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let cliente_id: string;
  try { ({ cliente_id } = await req.json()); }
  catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  if (!cliente_id || String(cliente_id).includes(":")) {
    return Response.json({ error: "cliente_id inválido (só conversas reais do RD)" }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // carteira do cliente + escopo (vendedor só sincroniza a própria carteira)
  const { data: cli } = await sb.from("clientes").select("carteira").eq("id", cliente_id).maybeSingle();
  const carteira = (cli?.carteira as string | null) ?? null;
  if (sessao !== "admin" && carteira && carteira !== sessao) {
    return Response.json({ error: "fora da sua carteira" }, { status: 403 });
  }

  // baseline: data da msg mais recente que já temos (pra saber se algo novo entrou)
  const { data: antes } = await sb.from("mensagens").select("criada_em")
    .eq("cliente_id", cliente_id).order("criada_em", { ascending: false }).limit(1).maybeSingle();
  const baseline = antes?.criada_em ?? null;

  // tenta até 3x (o RD leva alguns segundos p/ registrar a msg recém-enviada no histórico)
  try {
    let ultima: string | null = null, gravadas = 0;
    for (let tent = 0; tent < 3; tent++) {
      const r = await syncClienteMensagens(sb, cliente_id, carteira);
      ultima = r.ultima; gravadas = r.gravadas;
      if (!baseline || (ultima && ultima > baseline)) break; // já pegou algo novo
      if (tent < 2) await sleep(2200);
    }
    return Response.json({ ok: true, gravadas, ultima, novo: !!(ultima && (!baseline || ultima > baseline)) });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}
