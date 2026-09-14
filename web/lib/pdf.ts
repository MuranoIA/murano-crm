import zlib from "zlib";

/**
 * Gerador de PDF mínimo — texto, retângulos, linhas e imagens JPEG.
 *
 * POR QUE ESCREVER EM VEZ DE INSTALAR
 * -----------------------------------
 * `pdfkit` carrega as métricas das fontes (.afm) do disco em runtime, e o
 * bundler do Next não leva esses arquivos para a função serverless. É o clássico
 * "funciona local, quebra em produção" que este projeto já pagou caro em outras
 * frentes. O que precisamos aqui — um documento de texto com bolhas e fotos —
 * cabe nas fontes base-14 do próprio PDF, que não precisam ser embutidas.
 *
 * ⚠️ LIMITES DECLARADOS (não são bugs, são o preço de não embutir fonte):
 *  - o texto sai em WinAnsi (CP1252), que cobre o português inteiro;
 *  - EMOJI NÃO EXISTE nas fontes base-14 e é removido do texto. A conversa
 *    continua legível; o coraçãozinho não vai para o documento. Embutir uma
 *    fonte com emoji custaria alguns MB por PDF;
 *  - imagem entra só em JPEG (é o que o WhatsApp entrega). PNG/WebP viram
 *    marcador com o nome do arquivo.
 *
 * COORDENADAS: aqui o Y cresce PARA BAIXO, a partir do topo da página — o
 * contrário do PDF, que conta do rodapé. A conversão é feita na hora de
 * escrever. Sem isso, montar uma lista que desce a página vira aritmética
 * invertida em todo lugar.
 */

export type Fonte = "normal" | "negrito" | "italico";
export type Cor = [number, number, number]; // 0..1

// ---------------------------------------------------------------------------
// Métricas das fontes base-14 (AFM, milésimos de em).
// Uma linha por faixa; acentuados herdam a largura da letra de base, que é
// exato no Helvetica (á tem a largura de a).
// ---------------------------------------------------------------------------
const N = (s: string) => s.split(",").map(Number);

const HELV = [
  ...N("278,278,355,556,556,889,667,222,333,333,389,584,278,333,278,278"),
  ...N("556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556"),
  ...N("1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778"),
  ...N("667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556"),
  ...N("222,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556"),
  ...N("556,556,333,500,278,556,500,722,500,500,500,334,260,334,584"),
];
const HELV_ALTO = [
  ...N("556,556,222,556,333,1000,556,556,333,1000,667,333,1000,556,611,556"),
  ...N("556,222,222,333,333,350,556,1000,333,1000,500,333,944,556,500,667"),
  ...N("278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333"),
  ...N("400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611"),
  ...N("667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278"),
  ...N("722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611"),
  ...N("556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278"),
  ...N("556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500"),
];
const BOLD = [
  ...N("278,333,474,556,556,889,722,278,333,333,389,584,278,333,278,278"),
  ...N("556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611"),
  ...N("975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778"),
  ...N("667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556"),
  ...N("278,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611"),
  ...N("611,611,389,556,333,611,556,778,556,556,500,389,280,389,584"),
];
const BOLD_ALTO = [
  ...N("556,556,278,556,500,1000,556,556,333,1000,667,333,1000,556,611,556"),
  ...N("556,278,278,500,500,350,556,1000,333,1000,556,333,889,556,500,667"),
  ...N("278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333"),
  ...N("400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611"),
  ...N("722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278"),
  ...N("722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611"),
  ...N("556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278"),
  ...N("611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556"),
];

const larguras = (base: number[], alto: number[]) => {
  const w = new Array(256).fill(base[0]);
  for (let i = 0; i < base.length; i++) w[32 + i] = base[i];
  for (let i = 0; i < alto.length; i++) w[128 + i] = alto[i];
  return w;
};
const W: Record<Fonte, number[]> = {
  normal: larguras(HELV, HELV_ALTO),
  negrito: larguras(BOLD, BOLD_ALTO),
  italico: larguras(HELV, HELV_ALTO), // Oblique tem as mesmas métricas
};
const FONTE_PDF: Record<Fonte, string> = { normal: "F1", negrito: "F2", italico: "F3" };

// ---------------------------------------------------------------------------
// Texto → WinAnsi
// ---------------------------------------------------------------------------

// Os 32 lugares em que o CP1252 diverge do Latin-1 — e são justamente os que
// aparecem em texto escrito por gente: aspas curvas que o celular põe sozinho,
// travessão, reticências. Sem este mapa, `Não tá "certo"` perderia as aspas.
const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85,
  "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a,
  "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92,
  "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c,
  "ž": 0x9e, "Ÿ": 0x9f,
};

/**
 * Reduz um texto ao que as fontes base-14 sabem desenhar.
 *
 * O que não couber é DESCARTADO, não substituído por "?" — uma conversa cheia
 * de interrogação lida pior que a mesma conversa sem os emoji. Quem chama
 * decide o que fazer quando sobra vazio (a bolha de um "👍" sozinho).
 */
export function winAnsi(entrada: string): string {
  const s = (entrada ?? "").normalize("NFC");
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 10 || c === 13) { out += ch; continue; }
    if (c === 9) { out += "  "; continue; }
    if (c >= 32 && c <= 126) { out += ch; continue; }
    if (c >= 160 && c <= 255) { out += ch; continue; }
    const mapeado = CP1252[ch];
    if (mapeado !== undefined) { out += String.fromCharCode(mapeado); continue; }
    // fora do alfabeto da fonte (emoji, CJK, variation selectors): cai fora
  }
  return out;
}

const escapar = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const num = (n: number) => (Math.round(n * 100) / 100).toString();

// ---------------------------------------------------------------------------

type Imagem = { id: string; buf: Buffer; w: number; h: number; espaco: string };

export type OpcoesTexto = { fonte?: Fonte; tam?: number; cor?: Cor };

export class Pdf {
  readonly largura: number;
  readonly altura: number;
  readonly margem: number;
  /** cursor vertical, medido do TOPO da página */
  y: number;

  private paginas: string[][] = [];
  private atual: string[] = [];
  private imagens: Imagem[] = [];
  private rodape: ((p: Pdf, pagina: number, total: number) => void) | null = null;
  private titulo = "Documento";

  constructor(op?: { largura?: number; altura?: number; margem?: number; titulo?: string }) {
    this.largura = op?.largura ?? 595.28; // A4
    this.altura = op?.altura ?? 841.89;
    this.margem = op?.margem ?? 42;
    this.titulo = op?.titulo ?? "Documento";
    this.y = this.margem;
    this.paginas.push(this.atual);
  }

  get larguraUtil() { return this.largura - this.margem * 2; }
  get paginaAtual() { return this.paginas.length; }

  novaPagina() {
    this.atual = [];
    this.paginas.push(this.atual);
    this.y = this.margem;
  }

  /** Quebra a página se não couber `h` — o teste que evita texto no rodapé. */
  garantirEspaco(h: number) {
    if (this.y + h > this.altura - this.margem - 24) this.novaPagina();
  }

  larguraTexto(s: string, fonte: Fonte = "normal", tam = 10) {
    const w = W[fonte];
    let t = 0;
    for (let i = 0; i < s.length; i++) t += w[s.charCodeAt(i) & 0xff] ?? 556;
    return (t / 1000) * tam;
  }

  /**
   * Quebra por largura, respeitando as quebras de linha que a pessoa digitou.
   * Palavra maior que a caixa (link colado, sequência sem espaço) é partida no
   * caractere — o contrário deixaria a linha vazar para fora da bolha.
   */
  quebrar(texto: string, larguraMax: number, fonte: Fonte = "normal", tam = 10): string[] {
    const linhas: string[] = [];
    for (const paragrafo of texto.split(/\r?\n/)) {
      if (!paragrafo.trim()) { linhas.push(""); continue; }
      let linha = "";
      for (const palavra of paragrafo.split(/\s+/)) {
        const tentativa = linha ? `${linha} ${palavra}` : palavra;
        if (this.larguraTexto(tentativa, fonte, tam) <= larguraMax) { linha = tentativa; continue; }
        if (linha) { linhas.push(linha); linha = ""; }
        let resto = palavra;
        while (this.larguraTexto(resto, fonte, tam) > larguraMax) {
          let corte = 1;
          while (corte < resto.length && this.larguraTexto(resto.slice(0, corte + 1), fonte, tam) <= larguraMax) corte++;
          linhas.push(resto.slice(0, corte));
          resto = resto.slice(corte);
        }
        linha = resto;
      }
      linhas.push(linha);
    }
    return linhas;
  }

  texto(x: number, yTopo: number, s: string, op?: OpcoesTexto) {
    const fonte = op?.fonte ?? "normal";
    const tam = op?.tam ?? 10;
    const [r, g, b] = op?.cor ?? [0, 0, 0];
    // baseline: o Y informado é o topo da caixa de texto; ~0,8em desce até a linha de base
    const yPdf = this.altura - (yTopo + tam * 0.8);
    this.atual.push(
      `${num(r)} ${num(g)} ${num(b)} rg BT /${FONTE_PDF[fonte]} ${num(tam)} Tf 1 0 0 1 ${num(x)} ${num(yPdf)} Tm (${escapar(s)}) Tj ET`,
    );
  }

  retangulo(x: number, yTopo: number, w: number, h: number, op?: { fundo?: Cor; borda?: Cor; raio?: number }) {
    const yPdf = this.altura - (yTopo + h);
    const partes: string[] = [];
    if (op?.fundo) partes.push(`${op.fundo.map(num).join(" ")} rg`);
    if (op?.borda) partes.push(`${op.borda.map(num).join(" ")} RG 0.6 w`);
    const raio = Math.min(op?.raio ?? 0, w / 2, h / 2);
    if (raio > 0) {
      const k = raio * 0.5523;
      const [x0, x1, y0, y1] = [x, x + w, yPdf, yPdf + h];
      partes.push(
        `${num(x0 + raio)} ${num(y0)} m`,
        `${num(x1 - raio)} ${num(y0)} l`,
        `${num(x1 - raio + k)} ${num(y0)} ${num(x1)} ${num(y0 + raio - k)} ${num(x1)} ${num(y0 + raio)} c`,
        `${num(x1)} ${num(y1 - raio)} l`,
        `${num(x1)} ${num(y1 - raio + k)} ${num(x1 - raio + k)} ${num(y1)} ${num(x1 - raio)} ${num(y1)} c`,
        `${num(x0 + raio)} ${num(y1)} l`,
        `${num(x0 + raio - k)} ${num(y1)} ${num(x0)} ${num(y1 - raio + k)} ${num(x0)} ${num(y1 - raio)} c`,
        `${num(x0)} ${num(y0 + raio)} l`,
        `${num(x0)} ${num(y0 + raio - k)} ${num(x0 + raio - k)} ${num(y0)} ${num(x0 + raio)} ${num(y0)} c`,
        "h",
      );
    } else {
      partes.push(`${num(x)} ${num(yPdf)} ${num(w)} ${num(h)} re`);
    }
    partes.push(op?.fundo && op?.borda ? "B" : op?.borda ? "S" : "f");
    this.atual.push(partes.join(" "));
  }

  linha(x1: number, y1: number, x2: number, y2: number, cor: Cor = [0.85, 0.85, 0.87], espessura = 0.6) {
    this.atual.push(
      `${cor.map(num).join(" ")} RG ${num(espessura)} w ${num(x1)} ${num(this.altura - y1)} m ${num(x2)} ${num(this.altura - y2)} l S`,
    );
  }

  /**
   * Registra um JPEG e devolve o nome do XObject, ou null se o arquivo não for
   * um JPEG que saibamos embutir. Null é um resultado normal aqui: quem chama
   * desenha um marcador no lugar da foto, em vez de o documento falhar.
   */
  addJpeg(buf: Buffer): { nome: string; w: number; h: number } | null {
    const info = medirJpeg(buf);
    if (!info) return null;
    const nome = `Im${this.imagens.length + 1}`;
    this.imagens.push({ id: nome, buf, w: info.w, h: info.h, espaco: info.espaco });
    return { nome, w: info.w, h: info.h };
  }

  imagem(nome: string, x: number, yTopo: number, w: number, h: number) {
    const yPdf = this.altura - (yTopo + h);
    this.atual.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(yPdf)} cm /${nome} Do Q`);
  }

  /**
   * Rodapé desenhado no fim, quando o total de páginas já é conhecido — é a
   * única forma de escrever "3 de 7" sem adivinhar quantas páginas virão.
   */
  aoFinalizar(cb: (p: Pdf, pagina: number, total: number) => void) { this.rodape = cb; }

  finalizar(): Buffer {
    if (this.rodape) {
      const total = this.paginas.length;
      for (let i = 0; i < total; i++) { this.atual = this.paginas[i]; this.rodape(this, i + 1, total); }
    }

    const objs: Buffer[] = [];
    const add = (corpo: string | Buffer) => {
      objs.push(Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo, "latin1"));
      return objs.length; // número do objeto (1-based)
    };

    // 1 catálogo, 2 páginas, 3..5 fontes, 6 resources — números fixos para o
    // dicionário de páginas poder apontá-los antes de existirem
    const CATALOGO = 1, PAGINAS = 2, RECURSOS = 6;
    add("<</Type/Catalog/Pages 2 0 R>>");
    let dictPaginas = ""; // preenchido abaixo
    add("");
    add("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>");
    add("<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>");
    add("<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Oblique/Encoding/WinAnsiEncoding>>");
    add(""); // recursos

    const refsImagem: string[] = [];
    for (const img of this.imagens) {
      const cab = `<</Type/XObject/Subtype/Image/Width ${img.w}/Height ${img.h}/ColorSpace /${img.espaco}/BitsPerComponent 8/Filter/DCTDecode/Length ${img.buf.length}>>\nstream\n`;
      const n = add(Buffer.concat([Buffer.from(cab, "latin1"), img.buf, Buffer.from("\nendstream", "latin1")]));
      refsImagem.push(`/${img.id} ${n} 0 R`);
    }
    objs[RECURSOS - 1] = Buffer.from(
      `<</Font<</F1 3 0 R/F2 4 0 R/F3 5 0 R>>${refsImagem.length ? `/XObject<<${refsImagem.join(" ")}>>` : ""}>>`,
      "latin1",
    );

    const idsPagina: number[] = [];
    for (const conteudo of this.paginas) {
      const bruto = Buffer.from(conteudo.join("\n"), "latin1");
      const comprimido = zlib.deflateSync(bruto);
      const nStream = add(Buffer.concat([
        Buffer.from(`<</Length ${comprimido.length}/Filter/FlateDecode>>\nstream\n`, "latin1"),
        comprimido,
        Buffer.from("\nendstream", "latin1"),
      ]));
      idsPagina.push(add(
        `<</Type/Page/Parent ${PAGINAS} 0 R/MediaBox[0 0 ${num(this.largura)} ${num(this.altura)}]/Resources ${RECURSOS} 0 R/Contents ${nStream} 0 R>>`,
      ));
    }
    dictPaginas = `<</Type/Pages/Count ${idsPagina.length}/Kids[${idsPagina.map((n) => `${n} 0 R`).join(" ")}]>>`;
    objs[PAGINAS - 1] = Buffer.from(dictPaginas, "latin1");

    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const dataPdf = `D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
    // ⚠️ O /Title NÃO é WinAnsi: string de texto do PDF é PDFDocEncoding, onde
    // 0x97 não é o travessão — o leitor mostrava "Conversa Š Teste" na aba.
    // UTF-16BE com BOM é o outro formato que a especificação aceita, e é o que
    // funciona para qualquer acento.
    const tituloHex = Buffer.from("﻿" + this.titulo, "utf16le").swap16().toString("hex");
    const nInfo = add(`<</Title <${tituloHex}>/Producer (Murano CRM)/CreationDate (${dataPdf})>>`);

    // montagem final com a tabela de referências cruzadas
    const partes: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    let deslocamento = partes[0].length;
    const offsets: number[] = [];
    objs.forEach((corpo, i) => {
      offsets.push(deslocamento);
      const bloco = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), corpo, Buffer.from("\nendobj\n", "latin1")]);
      partes.push(bloco);
      deslocamento += bloco.length;
    });
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<</Size ${objs.length + 1}/Root ${CATALOGO} 0 R/Info ${nInfo} 0 R>>\nstartxref\n${deslocamento}\n%%EOF\n`;
    partes.push(Buffer.from(xref, "latin1"));
    return Buffer.concat(partes);
  }
}

/**
 * Dimensões e espaço de cor de um JPEG, lendo o marcador SOF.
 *
 * CMYK (4 componentes) devolve null de propósito: JPEG CMYK da Adobe precisa de
 * /Decode invertido e sai com as cores trocadas se embutido cru. Melhor um
 * marcador honesto que uma foto em negativo.
 */
export function medirJpeg(buf: Buffer): { w: number; h: number; espaco: string } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marcador = buf[i + 1];
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) { i += 2; continue; }
    const tam = buf.readUInt16BE(i + 2);
    const ehSOF = marcador >= 0xc0 && marcador <= 0xcf
      && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
    if (ehSOF) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      const comps = buf[i + 9];
      const espaco = comps === 1 ? "DeviceGray" : comps === 3 ? "DeviceRGB" : "";
      if (!espaco || !w || !h) return null;
      return { w, h, espaco };
    }
    i += 2 + tam;
  }
  return null;
}
