import { sbAdmin, guardaAdmin } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

// Histórico das transferências de carteira (migration 0092).
//
// O nome do cliente é buscado em `clientes` numa segunda consulta em vez de
// desnormalizado na tabela: a transferência é append-only e viveria com o nome
// congelado do dia em que aconteceu — o supervisor procurando "Fulana" não
// acharia a linha depois que o cadastro fosse corrigido no RD.

const LIMITE = 500;

export async function GET(req: Request) {
  const g = guardaAdmin("ver o histórico de carteiras");
  if (g.erro) return g.erro;

  const dias = Math.min(Math.max(Number(new URL(req.url).searchParams.get("dias") ?? 30) || 30, 1), 365);
  const desde = new Date(Date.now() - dias * 86400_000).toISOString();

  try {
    const sb = sbAdmin();

    const { data, error } = await sb
      .from("carteira_transferencia")
      .select("id,cliente_id,de_carteira,para_carteira,por,observacao,sucesso,erro,criada_em")
      .gte("criada_em", desde)
      .order("criada_em", { ascending: false })
      .limit(LIMITE);
    if (error) throw new Error(error.message);

    const linhas = data ?? [];
    const ids = [...new Set(linhas.map((l: any) => l.cliente_id))];
    const nomes = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: cs } = await sb
        .from("clientes").select("id,nome_completo").in("id", ids.slice(i, i + 200));
      for (const c of cs ?? []) if (c.nome_completo) nomes.set(c.id, c.nome_completo);
    }

    return Response.json({
      linhas: linhas.map((l: any) => ({ ...l, nome: nomes.get(l.cliente_id) ?? null })),
      truncado: linhas.length >= LIMITE,
      dias,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? "falha ao carregar histórico" }, { status: 500 });
  }
}
