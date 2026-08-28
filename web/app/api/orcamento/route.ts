import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Produtos p/ o orçamento: nome + preço de tabela + estoque disponível + campanhas.
// Fonte = ESPELHO dentro do murano-conversas (wth_catalogo / wth_estoque / wth_campanhas),
// alimentado por pg_cron a partir do v2 (funções wth_sync_catalogo_http / _estoque_http /
// _campanhas_http). A Vercel NÃO lê mais o v2 — só o murano-conversas via service_role.
// Frescor: estoque a cada 30 min; catálogo/campanhas a cada 6 h.

async function allRows(sb: any, table: string, select: string, ordem = "id"): Promise<any[]> {
  const out: any[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    // desempate obrigatorio: `range` sem `order` nao tem ordem prometida entre
    // paginas, e cada pagina e uma consulta separada -- linha repetida numa e
    // ausente da outra. Medido no /api/funil em 27/08/2026: 25 duplicadas e 25
    // perdidas de 4.327. Ordenar por uma coluna unica torna a ordem total.
    const { data, error } = await sb.from(table).select(select)
      .order(ordem, { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < page) break;
    from += page;
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
    const [catalogo, estoque, campanhas] = await Promise.all([
      allRows(sb, "wth_catalogo", "codprod,produto,marca,secao,preco_tabela", "codprod"),
      allRows(sb, "wth_estoque", "codprod,qt_disponivel", "codprod"),
      allRows(sb, "wth_campanhas", "codprod,preco,nome", "codprod"),
    ]);

    const estPorCod = new Map<number, number>();
    for (const e of estoque) {
      const cod = Number(e.codprod);
      if (!isNaN(cod)) estPorCod.set(cod, Number(e.qt_disponivel ?? 0));
    }

    // campanhas já vêm deduplicadas por (codprod, preco) do espelho; só agrupar por produto.
    const campPorCod = new Map<number, { nome: string; preco: number }[]>();
    for (const c of campanhas) {
      const cod = Number(c.codprod);
      if (isNaN(cod)) continue;
      const arr = campPorCod.get(cod) ?? [];
      arr.push({ nome: String(c.nome ?? "Campanha"), preco: Number(c.preco) });
      campPorCod.set(cod, arr);
    }
    const campanhasDe = (cod: number) =>
      (campPorCod.get(cod) ?? []).slice().sort((a, b) => a.preco - b.preco);

    const produtos = catalogo
      .filter((p: any) => p.preco_tabela != null)
      .map((p: any) => ({
        codprod: p.codprod,
        produto: p.produto,
        marca: p.marca ?? null,
        secao: p.secao ?? null,
        preco: Number(p.preco_tabela),
        estoque: estPorCod.has(Number(p.codprod)) ? estPorCod.get(Number(p.codprod))! : null,
        campanhas: campanhasDe(Number(p.codprod)),
      }))
      .sort((a: any, b: any) => String(a.produto).localeCompare(String(b.produto), "pt-BR"));

    return Response.json({ produtos });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}
