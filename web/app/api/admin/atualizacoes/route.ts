import { guardaAdmin, sbAdmin, corpo } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

// FILA DE ATUALIZAÇÃO CADASTRAL (0117)
//
// O CRM detecta que o cadastro do WinThor está desatualizado — tipicamente o
// telefone, quando a cliente troca de número — e NÃO pode corrigir: o
// `murano-clientes-v2` é espelho, reescrito a cada minuto (ver o cabeçalho da
// migration). Então a correção vira pedido, e o pedido vira `.csv` para quem
// edita o ERP de verdade.
//
// O `.csv` não é enfeite: é o que faz a tela valer HOJE. Sem ele o admin veria
// um número que não pode acionar — a mesma doença que a aba Pendências (§36)
// existe para curar.

const csvEscapar = (v: unknown) => {
  const t = String(v ?? "");
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export async function GET(req: Request) {
  const g = guardaAdmin("ver a fila de atualização cadastral");
  if (g.erro) return g.erro;
  const sb = sbAdmin();

  const u = new URL(req.url);
  const status = u.searchParams.get("status") ?? "pendente";
  const csv = u.searchParams.get("csv") === "1";

  let q = sb.from("cadastro_atualizacao")
    .select("id,cliente_id,codcli,campo,valor_atual,valor_novo,origem,por,criada_em,status,tratado_por,tratado_em,observacao")
    .order("criada_em", { ascending: false });
  if (status !== "todos") q = q.eq("status", status);
  const { data, error } = await q.limit(2000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const linhas = data ?? [];

  // o nome do cliente não está na tabela de propósito (ele muda no ERP; guardar
  // uma cópia aqui seria mais uma verdade a divergir) — vem no momento de ler
  const codclis = [...new Set(linhas.map((l: any) => l.codcli))];
  const nomes = new Map<number, string>();
  if (codclis.length) {
    const { data: cs } = await sb.from("wth_carteira")
      .select("codcli,nome,rca_num,rca_nome").in("codcli", codclis);
    for (const c of cs ?? []) nomes.set(c.codcli, `${c.nome}`);
  }
  const enriquecidas = linhas.map((l: any) => ({ ...l, nome: nomes.get(l.codcli) ?? null }));

  if (csv) {
    const cab = ["codcli", "nome", "campo", "valor_atual", "valor_novo", "origem", "por", "criada_em", "status"];
    const corpoCsv = [
      cab.join(";"),
      ...enriquecidas.map((l: any) => cab.map((k) => csvEscapar(l[k])).join(";")),
    ].join("\r\n");
    // BOM montado em runtime: escrito como literal, ele sobrevive a uma rodada
    // de escape e morre na seguinte (§36.4). Sem BOM o Excel pt-BR abre com
    // acento quebrado.
    const bom = String.fromCharCode(0xfeff);
    return new Response(bom + corpoCsv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="atualizacao_cadastral_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const { count: pendentes } = await sb.from("cadastro_atualizacao")
    .select("*", { count: "exact", head: true }).eq("status", "pendente");

  return Response.json({ linhas: enriquecidas, pendentes: pendentes ?? 0, status });
}

// Marcar como aplicado (alguém digitou no ERP) ou descartado (era engano).
//
// "Aplicado" NÃO verifica o ERP: quem afirma é a pessoa que digitou. Checar
// exigiria comparar com o espelho, que só atualiza no próximo sync — o botão
// diria "ainda não" por um minuto e ninguém entenderia.
export async function PATCH(req: Request) {
  const g = guardaAdmin("tratar pedido de atualização cadastral");
  if (g.erro) return g.erro;
  const b = await corpo(req);
  const id = Number(b?.id);
  const status = String(b?.status ?? "");
  if (!Number.isFinite(id)) return Response.json({ error: "id ausente" }, { status: 400 });
  if (!["aplicado", "descartado", "pendente"].includes(status)) {
    return Response.json({ error: "status inválido" }, { status: 400 });
  }

  const sb = sbAdmin();
  const { error } = await sb.from("cadastro_atualizacao").update({
    status,
    tratado_por: status === "pendente" ? null : g.email,
    tratado_em: status === "pendente" ? null : new Date().toISOString(),
    observacao: b?.observacao ? String(b.observacao).slice(0, 500) : null,
  }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
