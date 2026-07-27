import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Produtos p/ o orçamento: nome + preço de tabela + estoque disponível. Fonte = v2 (WinThor),
// LEITURA ANÔNIMA via PostgREST (nenhuma escrita no v2). Preço: vw_tabela_precos.preco_tabela;
// estoque: estoque_winthor.qt_estoque_disponivel (filial 1). A chave anon do v2 vem de bi_config.
const V2_URL = "https://jjvbmqycgjgkwidgcmif.supabase.co";

async function v2All(path: string, key: string): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${V2_URL}/rest/v1/${path}${sep}limit=1000&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`v2 ${path}: HTTP ${r.status}`);
    const chunk = await r.json();
    out.push(...chunk);
    if (!Array.isArray(chunk) || chunk.length < 1000) break;
    offset += 1000;
  }
  return out;
}

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  try {
    const { data: cfg, error: cfgErr } = await sb.from("bi_config").select("valor").eq("chave", "v2_anon_key").single();
    if (cfgErr || !cfg?.valor) return Response.json({ error: "v2_anon_key ausente em bi_config" }, { status: 500 });
    const v2Key = cfg.valor as string;

    const [precos, estoque] = await Promise.all([
      v2All("vw_tabela_precos?select=codprod,produto,marca,secao,preco_tabela&order=produto.asc", v2Key),
      v2All("estoque_winthor?select=codigo_produto,qt_estoque_disponivel&codfilial=eq.1", v2Key),
    ]);

    const estPorCod = new Map<number, number>();
    for (const e of estoque) {
      const cod = Number(e.codigo_produto);
      if (!isNaN(cod)) estPorCod.set(cod, Number(e.qt_estoque_disponivel ?? 0));
    }

    const produtos = precos
      .filter((p: any) => p.preco_tabela != null)
      .map((p: any) => ({
        codprod: p.codprod,
        produto: p.produto,
        marca: p.marca ?? null,
        secao: p.secao ?? null,
        preco: Number(p.preco_tabela),
        estoque: estPorCod.has(Number(p.codprod)) ? estPorCod.get(Number(p.codprod))! : null,
      }));

    return Response.json({ produtos });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}
