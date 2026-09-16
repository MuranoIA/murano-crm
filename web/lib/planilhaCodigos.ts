import ExcelJS from "exceljs";

// ---------------------------------------------------------------------------
// Lê SÓ os códigos de cliente de uma planilha — nada mais. O que acontece
// depois (achar o cliente, checar telefone, aplicar as proteções de custo) é
// o MESMO caminho da lista digitada (`lib/publicoManual.ts`), então a
// planilha não é um motor de público separado: é só um jeito rápido de
// preencher a mesma lista.
//
// Formato esperado: uma coluna chamada `codcli` (ou `código`/`code`/`cod`).
// Não adivinha coluna sem cabeçalho batendo — planilha errada tem de dizer
// isso na hora, não importar lixo calado (§36.1, §61.2).
// ---------------------------------------------------------------------------

const SINONIMOS_COLUNA = ["codcli", "codigo", "código", "code", "cod", "cod_cliente", "codigocliente", "codigo cliente", "código do cliente"];

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export type LeituraPlanilha = {
  codclis: number[];
  /** linhas que tinham algo na coluna mas não deu para ler como número */
  invalidos: string[];
  totalLinhas: number;
};

function extraiCodigos(linhas: string[][]): LeituraPlanilha {
  if (!linhas.length) return { codclis: [], invalidos: [], totalLinhas: 0 };

  const cabecalho = linhas[0].map((c) => semAcento(String(c ?? "")));
  const idx = cabecalho.findIndex((c) => SINONIMOS_COLUNA.includes(c));
  if (idx === -1) {
    throw new Error(
      `Não encontrei uma coluna de código (procurei por "codcli", "código" ou "code" no cabeçalho — `
      + `achei: ${linhas[0].filter(Boolean).join(", ") || "nenhum texto na primeira linha"}).`,
    );
  }

  const codclis: number[] = [];
  const invalidos: string[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const bruto = String(linhas[i]?.[idx] ?? "").trim();
    if (!bruto) continue;
    const n = Number(bruto.replace(/\D/g, ""));
    if (Number.isFinite(n) && n > 0) codclis.push(n);
    else invalidos.push(bruto);
  }
  return { codclis, invalidos, totalLinhas: linhas.length - 1 };
}

async function linhasDoXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const linhas: string[][] = [];
  ws.eachRow((row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => { vals.push(String(cell.value ?? "")); });
    linhas.push(vals);
  });
  return linhas;
}

/** `;` é o padrão do Excel em pt-BR (§36.3); `,` é o padrão internacional. */
function linhasDoCsv(texto: string): string[][] {
  const semBom = texto.replace(/^﻿/, "");
  const brutas = semBom.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!brutas.length) return [];
  const delim = (brutas[0].match(/;/g)?.length ?? 0) > (brutas[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  return brutas.map((l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));
}

export async function lerPlanilhaCodigos(buffer: ArrayBuffer, nomeArquivo: string): Promise<LeituraPlanilha> {
  const ext = nomeArquivo.toLowerCase().split(".").pop();
  const linhas = ext === "csv"
    ? linhasDoCsv(Buffer.from(buffer).toString("utf-8"))
    : await linhasDoXlsx(buffer);
  return extraiCodigos(linhas);
}
