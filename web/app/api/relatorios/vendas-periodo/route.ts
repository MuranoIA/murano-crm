import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import ExcelJS from "exceljs";
import { veTudo, carteiraDe } from "../../../../lib/papel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Relatório "Clientes que compraram no período".
// GET ?periodo=hoje|ontem|semana|quinzena|mes|todos & format=json|xlsx
// Fonte: RPC relatorio_clientes_periodo (mesma definição de venda do ranking/board).
// Escopo: vendedor vê só a própria carteira; admin/home veem todas.

const PERIODOS: Record<string, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  semana: "Últimos 7 dias",
  quinzena: "Últimos 15 dias",
  mes: "Mês atual",
  todos: "Todos os períodos",
};

const brData = (d: any): string => {
  if (!d) return "";
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split("-");
  return y && m && dd ? `${dd}/${m}/${y}` : s;
};
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const u = new URL(req.url);
  const periodo = (u.searchParams.get("periodo") || "mes").toLowerCase();
  if (!PERIODOS[periodo]) return Response.json({ error: "período inválido" }, { status: 400 });
  const format = (u.searchParams.get("format") || "json").toLowerCase();

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "config ausente" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const carteira = carteiraDe(sessao); // null p/ admin/home (todas as carteiras)
  const { data, error } = await sb.rpc("relatorio_clientes_periodo", { p_periodo: periodo, p_vendedor: carteira });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const linhas: any[] = data ?? [];
  const totalGeral = linhas.reduce((a, r) => a + Number(r.total || 0), 0);
  const escopo = carteira ? cap(carteira) : (veTudo(sessao) ? "Todas as carteiras" : cap(sessao));

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const FONT = { name: "Arial", size: 10 };

    const resumo = wb.addWorksheet("Resumo");
    resumo.getColumn(1).width = 90;
    const linha = (txt: string, bold = false, size = 10) => { const r = resumo.addRow([txt]); r.font = { ...FONT, bold, size }; };
    linha("Clientes que compraram — " + PERIODOS[periodo], true, 14);
    linha(`Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
    linha(`Escopo: ${escopo}`);
    linha("");
    linha(`Total de clientes: ${linhas.length}`, true);
    linha(`Valor total no período: R$ ${totalGeral.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, true);

    const cols = [
      { header: "Cliente", key: "cliente", width: 36 },
      { header: "Telefone", key: "telefone", width: 16 },
      { header: "Vendedor", key: "vendedor", width: 20 },
      { header: "Pedidos", key: "pedidos", width: 10 },
      { header: "Total no Período (R$)", key: "total", width: 18, money: true },
      { header: "Última Compra", key: "ultima_compra", width: 15 },
    ];
    const ws = wb.addWorksheet("Clientes");
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).font = { ...FONT, bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF57163F" } };
    ws.getRow(1).alignment = { vertical: "middle" };
    for (const r of linhas) {
      ws.addRow({
        cliente: r.cliente ?? "",
        telefone: r.telefone ?? "",
        vendedor: r.vendedor ?? cap(r.vendedor_slug ?? ""),
        pedidos: Number(r.pedidos ?? 0),
        total: Number(r.total ?? 0),
        ultima_compra: brData(r.ultima_compra),
      });
    }
    ws.eachRow((row, i) => { if (i > 1) row.font = FONT; });
    ws.getColumn(5).numFmt = "#,##0.00";
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

    const buf = await wb.xlsx.writeBuffer();
    const fname = `clientes_${periodo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new Response(buf as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  }

  // JSON para visualização na tela
  return Response.json({
    periodo,
    periodoLabel: PERIODOS[periodo],
    escopo,
    clientes: linhas.length,
    totalGeral,
    linhas: linhas.map((r) => ({
      codcli: r.codcli,
      cliente: r.cliente,
      telefone: r.telefone,
      vendedor: r.vendedor ?? cap(r.vendedor_slug ?? ""),
      vendedor_slug: r.vendedor_slug,
      pedidos: Number(r.pedidos ?? 0),
      total: Number(r.total ?? 0),
      ultima_compra: r.ultima_compra,
      cliente_id: r.cliente_id,
    })),
  });
}
