import { sbAdmin, guardaAdmin } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

// Conflitos de atribuição: quem ATENDE (carteira no RD Conversas) x quem FATURA
// (RCA oficial do WinThor). Migration 0093, view `vw_carteira_conflito`.
//
// Por que não devolver a `vw_divergencia_carteira` crua: ela responde "discordam?"
// com sim/não, e a maioria das discordâncias é o negócio funcionando — IS/ISR
// atendendo cliente cujo RCA pertence ao GC ou a um vendedor de fora. Medido em
// 22/08/2026: de 445, só 116 são entre pessoas do MESMO time. Mandar as 445 como
// "corrigir" produziria 3 pedidos indevidos para cada legítimo, e a supervisão
// aprenderia a ignorar a lista inteira.
//
// A view cabe numa resposta só (445 linhas < o teto de 1000 do PostgREST), então
// aqui não há paginação. Se passar disso, paginar como em /api/funil.

// mesmo_time primeiro: é o único grupo em que alguém precisa agir.
const ORDEM: Record<string, number> = { mesmo_time: 0, entre_times: 1, rca_fora_do_crm: 2 };

export async function GET(req: Request) {
  const g = guardaAdmin("ver os conflitos de carteira");
  if (g.erro) return g.erro;

  const sp = new URL(req.url).searchParams;
  const classe = sp.get("classe");           // filtro opcional
  const soInvisiveis = sp.get("invisiveis") === "1";

  try {
    const sb = sbAdmin();
    let q = sb.from("vw_carteira_conflito").select(
      "cliente_id,nome_completo,codcli,carteira_rd,carteira_do_rca,rca_num,rca_nome,time_rd,time_rca,classe,no_board,ultima_atividade,telefone"
    );
    if (classe) q = q.eq("classe", classe);
    if (soInvisiveis) q = q.eq("no_board", false);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const linhas = (data ?? []).sort((a: any, b: any) => {
      const oa = ORDEM[a.classe] ?? 9, ob = ORDEM[b.classe] ?? 9;
      if (oa !== ob) return oa - ob;
      // dentro da classe, atividade mais recente primeiro (sem atividade por último)
      return String(b.ultima_atividade ?? "").localeCompare(String(a.ultima_atividade ?? ""));
    });

    const resumo = {
      total: linhas.length,
      mesmo_time: linhas.filter((l: any) => l.classe === "mesmo_time").length,
      entre_times: linhas.filter((l: any) => l.classe === "entre_times").length,
      rca_fora_do_crm: linhas.filter((l: any) => l.classe === "rca_fora_do_crm").length,
      // invisíveis: têm conversa mas não aparecem no board nem no chat, porque o
      // WHERE da vw_funil exige que o RCA seja de uma carteira ativa
      invisiveis: linhas.filter((l: any) => !l.no_board && l.ultima_atividade).length,
    };

    return Response.json({ linhas, resumo });
  } catch (e: any) {
    return Response.json({ erro: String(e?.message ?? e) }, { status: 500 });
  }
}
