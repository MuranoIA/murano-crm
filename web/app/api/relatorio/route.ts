import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import ExcelJS from "exceljs";
import { veTudo } from "../../../lib/papel";
import { cicloAtivo } from "../../../lib/crmConfig";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const brData = (d: any): string => {
  if (!d) return "";
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split("-");
  return y && m && dd ? `${dd}/${m}/${y}` : s;
};
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// POST { codclis:number[], codprods?:number[], filtros?:string[], titulo?:string, vendedor?:string }
// Gera o Excel dos clientes filtrados no board, detalhado (v2/ciclo).
//
// ESCOPO DAS ABAS:
//   - vendedor logado: uma aba, a própria carteira (escopo forçado no server — o
//     p_vendedor do RPC também é a trava contra POST com codclis de outra gente);
//   - admin com um consultor selecionado no board (`vendedor` no body): uma aba só,
//     a dele. Sem isso o admin recebia "Base Completa" + uma aba por consultor mesmo
//     olhando a carteira de um só, porque a atribuição da planilha é pelo RCA oficial
//     (wth_carteira -> carteira_config) e o board mostra em Pedido emitido quem
//     LANÇOU o pedido: cliente de outra carteira atendido por ele gerava aba alheia.
//   - admin sem consultor selecionado: como antes — Base Completa + aba por consultor.
//
// Com consultor selecionado, a planilha espelha o board: os clientes de outra
// carteira que ele atendeu CONTINUAM na lista (é trabalho dele), identificados na
// coluna "Carteira". Pra excluí-los, bastaria passar `escopo` como p_vendedor no RPC.
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

  // admin e home veem todos os consultores; vendedor só a própria carteira
  const admin = veTudo(sessao);
  const vendedorSel: string | null =
    typeof body?.vendedor === "string" && body.vendedor.trim() ? body.vendedor.trim() : null;
  // consultor da planilha: o do login (vendedor) ou o selecionado no board (admin).
  // null = admin olhando todas as carteiras.
  const escopo: string | null = admin ? vendedorSel : sessao;
  const { data: rows, error } = await sb.rpc("relatorio_rows", {
    p_codclis: codclis,
    p_codprods: codprods.length ? codprods : null,
    p_vendedor: admin ? null : sessao,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const linhas: any[] = rows ?? [];

  const temProduto = codprods.length > 0;
  // Motor de ciclo desligado (crm_config, 0097): a coluna derivada sai da planilha
  // em vez de virar uma coluna de traços. "Dias sem Comprar" e "Ticket Médio"
  // ficam — são fato do ERP, não fazem parte do mecanismo em revisão, embora
  // também venham de wth_ciclo.
  const comCiclo = await cicloAtivo(sb);
  // colunas: 5 base (cliente, telefone, dias sem compra, ciclo médio, ticket médio)
  // (+ colunas de produto quando há filtro de produto).
  const cols: { header: string; key: string; width: number; money?: boolean }[] = [
    { header: "Cliente", key: "cliente", width: 34 },
    { header: "Telefone", key: "telefone", width: 16 },
    // com a planilha escopada num consultor, a carteira oficial (RCA) vira coluna:
    // é como o cliente que ele atendeu mas é de outra carteira fica visível em vez
    // de virar uma aba separada.
    // (só faz sentido pro admin: no login de vendedor as linhas já vêm filtradas
    // pela carteira dele no RPC, então a coluna seria constante)
    ...(escopo && admin ? [{ header: "Carteira", key: "carteira", width: 14 }] : []),
    { header: "Dias sem Comprar", key: "dias_sem_comprar", width: 16 },
    ...(comCiclo ? [{ header: "Ciclo Médio (dias)", key: "ciclo_medio", width: 16 }] : []),
    { header: "Ticket Médio (R$)", key: "ticket_medio", width: 16, money: true },
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
    carteira: r.vendedor ? cap(r.vendedor) : "",
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
  linha(`Visão: ${escopo ? "Consultor " + cap(escopo) : (sessao === "admin" ? "Administrador" : "Home") + " (todos os consultores)"}`);
  linha("");
  linha("Filtros aplicados:", true);
  if (filtros.length) for (const f of filtros) linha("• " + f); else linha("• Nenhum filtro específico (toda a carteira visível)");
  linha("");
  linha(`Total de clientes: ${linhas.length}`, true);
  // quem estava no filtro do board mas não tem cadastro na carteira de nenhum consultor
  // ATIVO some no join do relatorio_rows — melhor dizer do que deixar a conta não fechar.
  if (linhas.length < codclis.length) {
    linha(`Clientes no filtro do board: ${codclis.length} — ${codclis.length - linhas.length} ficaram de fora (sem consultor ativo no WinThor)`);
  }
  if (escopo) {
    const deOutra = linhas.filter((r) => r.vendedor && r.vendedor !== escopo).length;
    if (deOutra) linha(`Desses, ${deOutra} são de outra carteira (atendidos por ${cap(escopo)}) — ver coluna "Carteira"`);
  }
  if (temProduto) linha(`Valor total no(s) produto(s): R$ ${linhas.reduce((a, r) => a + Number(r.valor_produto || 0), 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);

  // Um consultor selecionado -> uma aba só, com o nome dele. Sem seleção (admin
  // olhando tudo) -> Base Completa + uma aba por consultor, como antes.
  if (escopo) {
    addSheet(cap(escopo), linhas);
  } else {
    addSheet("Base Completa", linhas);
    if (admin) {
      const porVend = new Map<string, any[]>();
      for (const r of linhas) { const v = r.vendedor ?? "—"; (porVend.get(v) ?? porVend.set(v, []).get(v)!).push(r); }
      for (const [slug, dados] of porVend) addSheet(cap(slug), dados);
    }
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
