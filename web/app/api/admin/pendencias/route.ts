import { sbAdmin, guardaAdmin } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Pendências — o que o board não consegue colocar em coluna nenhuma.
//
// Pedido do usuário (25/08/2026): os clientes sem telefone, e os que não estão
// na carteira de nenhum vendedor do board, *"não podem ficar sem serem
// visualizados pelo admin"*. As ações que resolvem cada caso vêm depois; esta
// tela existe para o problema ter dono agora.
//
// A rota NÃO resolve nada de propósito. É a mesma razão da view (0101): um
// registro que o sistema não sabe classificar não pode simplesmente não
// aparecer — foi assim que a conversa da §34 ficou invisível por meses.
// ---------------------------------------------------------------------------

const PAGE = 1000;   // o PostgREST corta em 1000; os grupos somam ~440 hoje,
                     // mas B cresce sozinho com a carteira, então pagina.

export async function GET(req: Request) {
  const g = guardaAdmin("ver as pendências do board");
  if (g.erro) return g.erro;

  const grupo = new URL(req.url).searchParams.get("grupo");
  const sb = sbAdmin();

  const linhas: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from("vw_pendencias_admin")
      .select("grupo,chave,codcli,cliente_id,nome,telefone,cpf,carteira,rca_num,rca_nome,detalhe,ultima_atividade")
      .order("grupo")
      .order("nome")
      .range(from, from + PAGE - 1);
    // filtra pelo prefixo da letra ("A", "B", …): o rótulo completo muda quando
    // o texto for ajustado, a letra não
    if (grupo) q = q.like("grupo", `${grupo}%`);
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // contagem por grupo vem SEMPRE do conjunto completo, mesmo com filtro: os
  // chips precisam mostrar o total de cada grupo, não o do grupo aberto
  const totais: Record<string, number> = {};
  if (grupo) {
    const { data } = await sb.from("vw_pendencias_admin").select("grupo").range(0, 9999);
    for (const r of data ?? []) totais[(r as any).grupo] = (totais[(r as any).grupo] ?? 0) + 1;
  } else {
    for (const r of linhas) totais[r.grupo] = (totais[r.grupo] ?? 0) + 1;
  }

  return Response.json({
    pendencias: {
      linhas,
      totais,
      total: Object.values(totais).reduce((a, b) => a + b, 0),
      grupo: grupo ?? null,
    },
  });
}
