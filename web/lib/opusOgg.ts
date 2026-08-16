// Remux de WebM/Opus para Ogg/Opus — troca o CONTAINER sem tocar no áudio.
//
// POR QUE ISSO EXISTE
// O WhatsApp aceita `audio/ogg` só com Opus e `audio/mp4` só com AAC. O
// MediaRecorder do Chrome não grava Ogg: grava Opus dentro de WebM ou, se a
// gente pedir `audio/mp4`, Opus dentro de MP4 — que a Graph API ACEITA no
// upload (ela olha o container) e depois falha na entrega, chegando como
// `status: failed` pelo webhook, com wamid válido. Foi exatamente o que
// aconteceu no primeiro teste de áudio (16/08): dois envios com wamid e
// entrega falhada, e o arquivo no bucket com sample entry `Opus` + box `dOps`
// dentro de um .m4a.
//
// A nota de voz que a CLIENTE manda chega como `audio/ogg` — Opus também.
// Ou seja: o codec já era o certo dos dois lados, só o envelope estava errado.
// Por isso aqui não há conversão, decodificação nem ffmpeg (que não existe no
// runtime da Vercel): os pacotes Opus saem do WebM e entram numa sequência de
// páginas Ogg exatamente como estavam. Sem perda e sem CPU relevante.
//
// Referências: WebM/Matroska (EBML) e RFC 7845 (Ogg Encapsulation for Opus).

const ID_SEGMENT = 0x18538067;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACKENTRY = 0xae;
const ID_CODECID = 0x86;
const ID_CODECPRIVATE = 0x63a2;
const ID_CLUSTER = 0x1f43b675;
const ID_SIMPLEBLOCK = 0xa3;
const ID_BLOCKGROUP = 0xa0;
const ID_BLOCK = 0xa1;

// elementos em que precisamos ENTRAR; o resto é pulado pelo tamanho
const MASTERS = new Set([ID_SEGMENT, ID_TRACKS, ID_TRACKENTRY, ID_CLUSTER, ID_BLOCKGROUP]);

type Achados = { opusHead: Uint8Array | null; pacotes: Uint8Array[]; codec: string | null };

// --- EBML -------------------------------------------------------------------

/** ID de elemento: os bits do marcador FAZEM parte do valor. */
function lerId(b: Uint8Array, p: number): { id: number; tam: number } | null {
  if (p >= b.length || b[p] === 0) return null;
  let tam = 1, mask = 0x80;
  while (!(b[p] & mask)) { mask >>= 1; tam++; }
  if (tam > 4 || p + tam > b.length) return null;
  let id = 0;
  for (let i = 0; i < tam; i++) id = id * 256 + b[p + i];
  return { id, tam };
}

/**
 * Tamanho (vint): o marcador é descartado. `desconhecido` = todos os bits de
 * dados em 1, que o MediaRecorder usa de propósito ao gravar em streaming —
 * ele não sabe o tamanho final do Segment/Cluster quando começa a escrever.
 */
function lerTamanho(b: Uint8Array, p: number): { valor: number; tam: number; desconhecido: boolean } | null {
  if (p >= b.length || b[p] === 0) return null;
  let tam = 1, mask = 0x80;
  while (!(b[p] & mask)) { mask >>= 1; tam++; }
  if (tam > 8 || p + tam > b.length) return null;
  let valor = b[p] & (mask - 1);
  let todosUns = valor === mask - 1;
  for (let i = 1; i < tam; i++) {
    valor = valor * 256 + b[p + i];
    if (b[p + i] !== 0xff) todosUns = false;
  }
  return { valor, tam, desconhecido: todosUns };
}

/** Quadro de um SimpleBlock/Block. Lança em lacing, que não sabemos desempacotar. */
function quadroDoBloco(b: Uint8Array, ini: number, fim: number): Uint8Array | null {
  const trilha = lerTamanho(b, ini);
  if (!trilha) return null;
  const p = ini + trilha.tam + 2; // + timecode int16
  if (p >= fim) return null;
  const lacing = (b[p] >> 1) & 0x03;
  if (lacing !== 0) throw new Error("bloco com lacing");
  return p + 1 < fim ? b.slice(p + 1, fim) : null;
}

function varrer(b: Uint8Array, ini: number, fim: number, achados: Achados, prof = 0) {
  let p = ini;
  while (p < fim) {
    const id = lerId(b, p);
    if (!id) return;
    const sz = lerTamanho(b, p + id.tam);
    if (!sz) return;
    const dados = p + id.tam + sz.tam;
    // sem tamanho declarado, o elemento vai até onde o pai vai
    const fimEl = sz.desconhecido ? fim : Math.min(dados + sz.valor, fim);
    if (fimEl < dados) return;

    if (MASTERS.has(id.id)) {
      if (prof < 8) varrer(b, dados, fimEl, achados, prof + 1);
    } else if (id.id === ID_CODECID) {
      achados.codec = new TextDecoder().decode(b.subarray(dados, fimEl)).replace(/\0+$/, "");
    } else if (id.id === ID_CODECPRIVATE) {
      if (!achados.opusHead) achados.opusHead = b.slice(dados, fimEl);
    } else if (id.id === ID_SIMPLEBLOCK || id.id === ID_BLOCK) {
      const q = quadroDoBloco(b, dados, fimEl);
      if (q) achados.pacotes.push(q);
    }

    if (sz.desconhecido) return; // já consumimos até o fim do pai
    p = fimEl;
  }
}

// --- Opus -------------------------------------------------------------------

/**
 * Duração de um pacote Opus em amostras de 48 kHz, lida do byte TOC (RFC 6716
 * §3.1). É disso que sai o granule position de cada página — o campo que diz ao
 * player onde ele está no tempo. Errar aqui dá áudio que toca mas mostra
 * duração errada (ou não mostra barra de progresso).
 */
function amostrasDoPacote(p: Uint8Array): number {
  if (!p.length) return 0;
  const toc = p[0];
  const config = toc >> 3;
  const c = toc & 0x03;
  const quadros = c === 0 ? 1 : c < 3 ? 2 : p.length > 1 ? p[1] & 0x3f : 0;
  const ms =
    config < 12 ? [10, 20, 40, 60][config % 4]      // SILK
    : config < 16 ? [10, 20][config % 2]            // híbrido
    : [2.5, 5, 10, 20][config % 4];                 // CELT
  return Math.round(ms * 48 * quadros);
}

// --- Ogg --------------------------------------------------------------------

// CRC-32 do Ogg: polinômio 0x04c11db7, sem reflexão e sem xor final — NÃO é o
// CRC-32 do zip/PNG. Página com CRC errado é descartada inteira pelo player.
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    t[i] = r >>> 0;
  }
  return t;
})();

function crcOgg(b: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < b.length; i++) crc = ((crc << 8) ^ TABELA_CRC[((crc >>> 24) ^ b[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

function juntar(partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let off = 0;
  for (const p of partes) { saida.set(p, off); off += p.length; }
  return saida;
}

function pagina(pacotes: Uint8Array[], tipo: number, granulo: number, serial: number, seq: number): Uint8Array {
  // tabela de lacing: cada pacote vira N bytes 255 + um resto (0..254). Pacote
  // múltiplo exato de 255 precisa do 0 final, senão o player concatena com o
  // pacote seguinte.
  const tabela: number[] = [];
  for (const p of pacotes) {
    let n = p.length;
    while (n >= 255) { tabela.push(255); n -= 255; }
    tabela.push(n);
  }
  const corpo = juntar(pacotes);
  const buf = new Uint8Array(27 + tabela.length + corpo.length);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x4f; buf[1] = 0x67; buf[2] = 0x67; buf[3] = 0x53; // "OggS"
  buf[4] = 0;                 // versão
  buf[5] = tipo;              // 0x02 início do fluxo · 0x04 fim
  dv.setUint32(6, granulo >>> 0, true);
  dv.setUint32(10, Math.floor(granulo / 4294967296), true);
  dv.setUint32(14, serial >>> 0, true);
  dv.setUint32(18, seq >>> 0, true);
  dv.setUint32(22, 0, true);  // CRC zerado enquanto se calcula o CRC
  buf[26] = tabela.length;
  buf.set(tabela, 27);
  buf.set(corpo, 27 + tabela.length);
  dv.setUint32(22, crcOgg(buf), true);
  return buf;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("murano-crm");
  const b = new Uint8Array(8 + 4 + vendor.length + 4);
  b.set(new TextEncoder().encode("OpusTags"), 0);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, vendor.length, true);
  b.set(vendor, 12);
  dv.setUint32(12 + vendor.length, 0, true); // zero comentários
  return b;
}

function montarOgg(cabecalho: Uint8Array, pacotes: Uint8Array[], serial: number): Uint8Array {
  const saida: Uint8Array[] = [];
  let seq = 0;
  saida.push(pagina([cabecalho], 0x02, 0, serial, seq++)); // OpusHead sozinho, como manda a RFC
  saida.push(pagina([opusTags()], 0x00, 0, serial, seq++));

  // O contador de granule começa no PRE-SKIP (bytes 10-11 do OpusHead), e não em
  // zero: é a convenção do opusenc e — verificado byte a byte — a do próprio
  // codificador da Meta, cujas páginas trazem granulo = soma das durações + 312,
  // o pre-skip daquele arquivo, em todas as páginas. Começar em zero atrasa a
  // duração informada em ~6 ms; inaudível, mas não há motivo para divergir da
  // referência com que a compatibilidade é medida.
  const preSkip = cabecalho[10] | (cabecalho[11] << 8);

  let lote: Uint8Array[] = [], segmentos = 0, acumulado = preSkip, granuloDaPagina = preSkip;
  const despejar = (ultima: boolean) => {
    saida.push(pagina(lote, ultima ? 0x04 : 0x00, granuloDaPagina, serial, seq++));
    lote = []; segmentos = 0;
  };
  for (const pac of pacotes) {
    const precisa = Math.floor(pac.length / 255) + 1;
    if (precisa > 255) throw new Error("pacote Opus grande demais para uma página");
    if (segmentos + precisa > 255) despejar(false); // teto de 255 segmentos por página
    lote.push(pac);
    segmentos += precisa;
    acumulado += amostrasDoPacote(pac);
    granuloDaPagina = acumulado;
  }
  despejar(true);
  return juntar(saida);
}

// --- API --------------------------------------------------------------------

const ehEbml = (b: Uint8Array) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;

/** O arquivo é um WebM/Matroska? (assinatura, não o mime declarado) */
export function ehWebm(bytes: ArrayBuffer | Uint8Array): boolean {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return b.length > 4 && ehEbml(b);
}

/**
 * MP4 com Opus dentro — o caso que o WhatsApp aceita no upload e depois não
 * entrega. Procura o box `dOps` (presente só quando a trilha é Opus); o `moov`
 * do MediaRecorder fica no início do arquivo, então basta olhar o começo.
 */
export function mp4ComOpus(bytes: ArrayBuffer | Uint8Array): boolean {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 12 || !(b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)) return false; // "ftyp"
  const ate = Math.min(b.length - 4, 262144);
  for (let i = 8; i < ate; i++) {
    if (b[i] === 0x64 && b[i + 1] === 0x4f && b[i + 2] === 0x70 && b[i + 3] === 0x73) return true; // "dOps"
  }
  return false;
}

/**
 * WebM/Opus → Ogg/Opus. Devolve `null` quando não dá para remuxar com
 * segurança (não é WebM, a trilha não é Opus, falta o OpusHead, blocos com
 * lacing) — o chamador decide o que fazer, e é melhor recusar o envio do que
 * mandar algo que a Meta aceita e nunca entrega.
 */
export function webmParaOgg(bytes: ArrayBuffer | Uint8Array, serial?: number): Uint8Array | null {
  try {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length < 4 || !ehEbml(b)) return null;

    const achados: Achados = { opusHead: null, pacotes: [], codec: null };
    varrer(b, 0, b.length, achados);

    if (achados.codec && !/opus/i.test(achados.codec)) return null;
    const cab = achados.opusHead;
    if (!cab || cab.length < 19) return null;
    // o CodecPrivate de uma trilha Opus é o próprio OpusHead
    if (!(cab[0] === 0x4f && cab[1] === 0x70 && cab[2] === 0x75 && cab[3] === 0x73)) return null; // "Opus"
    if (!achados.pacotes.length) return null;

    return montarOgg(cab, achados.pacotes, serial ?? (Date.now() & 0x7fffffff));
  } catch {
    return null;
  }
}
