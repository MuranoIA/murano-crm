import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import ExcelJS from "exceljs";
import { veTudo } from "../../../../lib/papel";
import { escopoCarteira } from "../../../../lib/verComo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Relatório "Clientes SEM comprar no período" (irmão de vendas-periodo).
// GET ?periodo=hoje|ontem|semana|quinzena|mes|todos & format=json|xlsx
// Fonte: RPC relatorio_clientes_sem_comprar (carteira ativa - quem comprou no período).
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
const localDe = (cidade: any, estado: any) => [cidade, estado].filter(Boolean).join("/") || "";

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

  const carteira = escopoCarteira(); // null p/ admin/home (todas as carteiras)
  const { data, error } = await sb.rpc("relatorio_clientes_sem_comprar", { p_periodo: periodo, p_vendedor: carteira });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const linhas: any[] = data ?? [];
  const escopo = carteira ? cap(carteira) : (veTudo(sessao) ? "Todas as carteiras" : cap(sessao));

  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const FONT = { name: "Arial", size: 10 };

    const resumo = wb.addWorksheet("Resumo");
    resumo.getColumn(1).width = 90;
    const linha = (txt: string, bold = false, size = 10) => { const r = resumo.addRow([txt]); r.font = { ...FONT, bold, size }; };
    linha("Clientes SEM comprar — " + PERIODOS[periodo], true, 14);
    linha(`Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
    linha(`Escopo: ${escopo}`);
    linha("");
    linha(`Total de clientes sem compra: ${linhas.length}`, true);

    const cols = [
      { header: "Cliente", key: "cliente", width: 36 },
      { header: "Telefone", key: "telefone", width: 16 },
      { header: "Cidade/UF", key: "local", width: 22 },
      { header: "Vendedor", key: "vendedor", width: 16 },
      { header: "Última Compra", key: "ultima_compra", width: 15 },
      { header: "Dias sem Comprar", key: "dias_sem_comprar", width: 16 },
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
        local: localDe(r.cidade, r.estado),
        vendedor: cap(r.vendedor_slug ?? ""),
        ultima_compra: brData(r.ultima_compra),
        dias_sem_comprar: r.dias_sem_comprar ?? "",
      });
    }
    ws.eachRow((row, i) => { if (i > 1) row.font = FONT; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

    const buf = await wb.xlsx.writeBuffer();
    const fname = `clientes_sem_comprar_${periodo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    linhas: linhas.map((r) => ({
      codcli: r.codcli,
      cliente: r.cliente,
      telefone: r.telefone,
      local: localDe(r.cidade, r.estado),
      vendedor: cap(r.vendedor_slug ?? ""),
      vendedor_slug: r.vendedor_slug,
      ultima_compra: r.ultima_compra,
      dias_sem_comprar: r.dias_sem_comprar,
      cliente_id: r.cliente_id,
    })),
  });
}
