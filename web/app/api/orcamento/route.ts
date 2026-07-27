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

    const [precos, estoque, ofertas, ofertaItens] = await Promise.all([
      v2All("vw_tabela_precos?select=codprod,produto,marca,secao,preco_tabela&order=produto.asc", v2Key),
      v2All("estoque_winthor?select=codigo_produto,qt_estoque_disponivel&codfilial=eq.1", v2Key),
      // campanhas de desconto ATIVAS (preco_alvo = preço promocional)
      v2All("ofertas?select=id,titulo,campanha,tipo,preco_alvo&ativo=eq.true", v2Key),
      v2All("oferta_itens?select=codprod,oferta_id", v2Key),
    ]);

    const estPorCod = new Map<number, number>();
    for (const e of estoque) {
      const cod = Number(e.codigo_produto);
      if (!isNaN(cod)) estPorCod.set(cod, Number(e.qt_estoque_disponivel ?? 0));
    }

    // itens por oferta -> só ofertas INDIVIDUAIS de 1 item viram preço de campanha do produto
    // (combos são pacotes, não desconto de item unitário).
    const codsPorOferta = new Map<string, number[]>();
    for (const it of ofertaItens) {
      const arr = codsPorOferta.get(it.oferta_id) ?? [];
      arr.push(Number(it.codprod));
      codsPorOferta.set(it.oferta_id, arr);
    }
    const campPorCod = new Map<number, { nome: string; preco: number }[]>();
    for (const o of ofertas as any[]) {
      if (o.tipo === "combo") continue;
      const cods = codsPorOferta.get(o.id) ?? [];
      if (cods.length !== 1) continue;
      const preco = Number(o.preco_alvo);
      if (!isFinite(preco) || preco <= 0) continue;
      const nome = String(o.campanha || o.titulo || "Campanha").trim();
      const arr = campPorCod.get(cods[0]) ?? [];
      arr.push({ nome, preco });
      campPorCod.set(cods[0], arr);
    }
    // dedup por preço (1 nome por preço), ordenado do menor pro maior
    const campanhasDe = (cod: number) => {
      const arr = campPorCod.get(cod) ?? [];
      const byPreco = new Map<number, string>();
      for (const c of arr) if (!byPreco.has(c.preco)) byPreco.set(c.preco, c.nome);
      return [...byPreco.entries()].map(([preco, nome]) => ({ preco, nome })).sort((a, b) => a.preco - b.preco);
    };

    const produtos = precos
      .filter((p: any) => p.preco_tabela != null)
      .map((p: any) => ({
        codprod: p.codprod,
        produto: p.produto,
        marca: p.marca ?? null,
        secao: p.secao ?? null,
        preco: Number(p.preco_tabela),
        estoque: estPorCod.has(Number(p.codprod)) ? estPorCod.get(Number(p.codprod))! : null,
        campanhas: campanhasDe(Number(p.codprod)),
      }));

    return Response.json({ produtos });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}
