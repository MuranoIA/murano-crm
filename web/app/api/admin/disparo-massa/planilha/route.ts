import ExcelJS from "exceljs";
import { guardaAdmin } from "../../../../../lib/adminApi";
import { lerPlanilhaCodigos } from "../../../../../lib/planilhaCodigos";
import { LIMITE_LISTA } from "../../../../../lib/publicoManual";

export const dynamic = "force-dynamic";

// Só EXTRAI os códigos da planilha — não resolve cliente, não confere
// telefone, não aplica proteção nenhuma. Isso acontece depois, no MESMO
// caminho da lista digitada (POST /api/admin/disparo-massa com `codclis`):
// duas planilhas com os mesmos códigos e uma lista digitada com os mesmos
// códigos têm de terminar exatamente no mesmo público, sempre.
export async function POST(req: Request) {
  const g = guardaAdmin("subir planilha de público");
  if (g.erro) return g.erro;

  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: "envio inválido" }, { status: 400 }); }

  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File)) return Response.json({ error: "nenhum arquivo enviado" }, { status: 400 });

  const ext = arquivo.name.toLowerCase().split(".").pop();
  if (ext !== "xlsx" && ext !== "csv") {
    return Response.json({ error: "envie um arquivo .xlsx ou .csv" }, { status: 400 });
  }
  // 5 MB é generoso pra uma coluna de códigos — barra arquivo errado cedo,
  // não depois de gastar tempo tentando abrir.
  if (arquivo.size > 5 * 1024 * 1024) {
    return Response.json({ error: "arquivo maior que 5 MB — confira se é mesmo uma lista de códigos" }, { status: 400 });
  }

  try {
    const buffer = await arquivo.arrayBuffer();
    const leitura = await lerPlanilhaCodigos(buffer, arquivo.name);
    // O teto vale AQUI também, e não só na tela: quem chama a rota direto (ou
    // uma aba velha) não pode receber 50 mil códigos e descobrir o teto na
    // conferência. Recusar o arquivo, em vez de cortar em `LIMITE_LISTA`, é de
    // propósito — cortar deixaria de fora clientes que a pessoa pôs na lista
    // sem que ela soubesse quais.
    if (leitura.codclis.length > LIMITE_LISTA) {
      return Response.json({
        error: `A planilha tem ${leitura.codclis.length} códigos diferentes — o teto de uma campanha é `
          + `${LIMITE_LISTA}. Divida em mais de uma planilha e rode uma campanha para cada.`,
      }, { status: 400 });
    }
    return Response.json(leitura);
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 400 });
  }
}

// --- GET: a planilha de EXEMPLO ------------------------------------------------
//
// Baixada pelo botão "Baixar planilha de exemplo", logo abaixo de "Escolher
// planilha". O que ela ensina: UMA coluna chamada `codcli`, um código por linha
// — o resto é ignorado (`lib/planilhaCodigos.ts`).
//
// ⚠️ OS CÓDIGOS DO EXEMPLO NÃO EXISTEM NO WINTHOR, de propósito. Uma planilha de
// exemplo que trouxesse clientes de verdade, subida sem ser apagada, dispararia
// template (e custaria R$ 0,43 cada) para gente real por descuido. Com estes,
// o pior que acontece é a conferência dizer "código não existe no WinThor".
export async function GET() {
  const g = guardaAdmin("baixar a planilha de exemplo");
  if (g.erro) return g.erro;

  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM Murano";

  // ⚠️ A aba de dados vem PRIMEIRO: `lerPlanilhaCodigos` lê `worksheets[0]`.
  const dados = wb.addWorksheet("Codigos");
  dados.columns = [
    { header: "codcli", key: "codcli", width: 14 },
    { header: "nome (opcional — só para você se orientar)", key: "nome", width: 52 },
  ];
  dados.getRow(1).font = { bold: true };
  dados.addRows([
    { codcli: 900000001, nome: "EXEMPLO — apague estas 3 linhas e cole os seus códigos" },
    { codcli: 900000002, nome: "EXEMPLO" },
    { codcli: 900000003, nome: "EXEMPLO" },
  ]);
  dados.views = [{ state: "frozen", ySplit: 1 }];

  const como = wb.addWorksheet("Como usar");
  como.getColumn(1).width = 110;
  [
    "Como montar a planilha do disparo em massa",
    "",
    "1. Na aba \"Codigos\", a primeira linha é o cabeçalho e precisa ter uma coluna chamada codcli (também vale: código, code ou cod).",
    "2. Da segunda linha para baixo, um código de cliente por linha — o mesmo código que aparece no WinThor e antes do nome no chat.",
    "3. As outras colunas (como o nome) são ignoradas. Servem só para você conferir.",
    `4. Até ${LIMITE_LISTA.toLocaleString("pt-BR")} clientes por planilha. Acima disso o sistema recusa o arquivo e pede que você divida.`,
    "5. Código repetido conta uma vez só. Código que não existe no WinThor, ou cliente sem telefone, aparece numa lista à parte depois de conferir.",
    "6. A planilha vale como o público inteiro: não há filtro de proteção por cima. Quem está nela recebe.",
    "",
    "Os 3 códigos de exemplo na aba \"Codigos\" não existem no WinThor — apague-os antes de subir.",
  ].forEach((t, i) => { como.getRow(i + 1).getCell(1).value = t; });
  como.getRow(1).font = { bold: true, size: 13 };
  como.getColumn(1).alignment = { wrapText: true, vertical: "top" };

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="planilha-exemplo-disparo.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
