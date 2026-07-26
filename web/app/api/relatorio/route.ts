import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import ExcelJS from "exceljs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const brData = (d: any): string => {
  if (!d) return "";
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split("-");
  return y && m && dd ? `${dd}/${m}/${y}` : s;
};
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// POST { codclis:number[], codprods?:number[], filtros?:string[], titulo?:string }
// Gera o Excel dos clientes filtrados no board, detalhado (v2/ciclo). Admin: aba por
// consultor; vendedor: só a própria carteira (escopo forçado no server).
export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const codclis: number[] = (body?.codclis ?? []).map(Number).filter((x: number) => !isNaN(x));
  const codprods: number[] = (body?.codprods ?? []).map(Number).filter((x: number) => !isNaN(x));
  const filtros: string[] = Array.isArray(body?.filtros) ? body.filtros : [];
  const titulo: string = body?.titulo || "Relatório de clientes";
  if (!codclis.length) return Response.json({ error: "nenhum cliente no filtro" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const admin = sessao === "admin";
  const { data: rows, error } = await sb.rpc("relatorio_rows", {
    p_codclis: codclis,
    p_codprods: codprods.length ? codprods : null,
    p_vendedor: admin ? null : sessao,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const linhas: any[] = rows ?? [];

  const temProduto = codprods.length > 0;
  // colunas: base + ciclo (+ produto se houver filtro de produto)
  const cols: { header: string; key: string; width: number; money?: boolean }[] = [
    { header: "Time", key: "time", width: 7 },
    { header: "Consultor", key: "consultor", width: 24 },
    { header: "Cód. Cliente", key: "cod_cliente", width: 11 },
    { header: "Cliente", key: "cliente", width: 30 },
    { header: "Telefone", key: "telefone", width: 15 },
    { header: "Cidade", key: "cidade", width: 16 },
    { header: "Ciclo", key: "ciclo", width: 13 },
    { header: "Score Urgência", key: "score", width: 13 },
    { header: "Dias sem Comprar", key: "dias_sem_comprar", width: 15 },
    { header: "Ciclo Médio (dias)", key: "ciclo_medio", width: 15 },
    { header: "Ticket Médio (R$)", key: "ticket_medio", width: 15, money: true },
    { header: "Total Pedidos", key: "total_pedidos", width: 12 },
    { header: "Ação Recomendada", key: "acao", width: 18 },
    { header: "Últ. Compra", key: "ult_compra", width: 12 },
    ...(temProduto ? [
      { header: "Produto", key: "produto", width: 34 },
      { header: "Qtd. Produto", key: "qtd", width: 11 },
      { header: "Pedidos c/ Produto", key: "pedidos_produto", width: 15 },
      { header: "Valor Produto (R$)", key: "valor_produto", width: 15, money: true },
      { header: "Últ. Compra Produto", key: "ult_compra_produto", width: 16 },
    ] : []),
  ];
  const mapRow = (r: any) => ({
    time: r.time ?? "", consultor: r.consultor ?? "", cod_cliente: r.cod_cliente,
    cliente: r.cliente ?? "", telefone: r.telefone ?? "", cidade: r.cidade ?? "",
    ciclo: r.ciclo ?? "", score: r.score != null ? Math.round(Number(r.score)) : "",
    dias_sem_comprar: r.dias_sem_comprar ?? "", ciclo_medio: r.ciclo_medio != null ? Math.round(Number(r.ciclo_medio)) : "",
    ticket_medio: r.ticket_medio != null ? Number(r.ticket_medio) : "", total_pedidos: r.total_pedidos ?? "",
    acao: r.acao ?? "", ult_compra: brData(r.ult_compra),
    produto: r.produto ?? "", qtd: r.qtd != null ? Number(r.qtd) : "", pedidos_produto: r.pedidos_produto ?? "",
    valor_produto: r.valor_produto != null ? Number(r.valor_produto) : "", ult_compra_produto: brData(r.ult_compra_produto),
  });

  const wb = new ExcelJS.Workbook();
  const FONT = { name: "Arial", size: 10 };
  const addSheet = (nome: string, dados: any[]) => {
    const ws = wb.addWorksheet(nome.slice(0, 31));
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).font = { ...FONT, bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF57163F" } };
    ws.getRow(1).alignment = { vertical: "middle" };
    for (const r of dados) ws.addRow(mapRow(r));
    ws.eachRow((row, i) => { if (i > 1) row.font = FONT; });
    cols.forEach((c, idx) => { if (c.money) ws.getColumn(idx + 1).numFmt = '#,##0.00'; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  };

  // Resumo
  const resumo = wb.addWorksheet("Resumo");
  resumo.getColumn(1).width = 90;
  const linha = (txt: string, bold = false, size = 10) => { const r = resumo.addRow([txt]); r.font = { ...FONT, bold, size }; };
  linha(titulo, true, 14);
  linha(`Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  linha(`Visão: ${admin ? "Administrador (todos os consultores)" : "Consultor " + cap(sessao)}`);
  linha("");
  linha("Filtros aplicados:", true);
  if (filtros.length) for (const f of filtros) linha("• " + f); else linha("• Nenhum filtro específico (toda a carteira visível)");
  linha("");
  linha(`Total de clientes: ${linhas.length}`, true);
  if (temProduto) linha(`Valor total no(s) produto(s): R$ ${linhas.reduce((a, r) => a + Number(r.valor_produto || 0), 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);

  // Base Completa + abas por consultor (só admin)
  addSheet("Base Completa", linhas);
  if (admin) {
    const porVend = new Map<string, any[]>();
    for (const r of linhas) { const v = r.vendedor ?? "—"; (porVend.get(v) ?? porVend.set(v, []).get(v)!).push(r); }
    for (const [slug, dados] of porVend) addSheet(cap(slug), dados);
  }

  const buf = await wb.xlsx.writeBuffer();
  const fname = `relatorio_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(buf as any, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
