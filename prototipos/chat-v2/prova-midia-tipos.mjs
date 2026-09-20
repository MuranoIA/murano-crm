// -----------------------------------------------------------------------------
// OS TIPOS DE MIDIA que o WhatsApp aceita, conferidos um a um.
//
//   node prototipos/chat-v2/prova-midia-tipos.mjs
//
// A lista de referencia e a da Meta (Cloud API > Reference > Media), conferida
// em 20/09/2026. A regra antiga era `image/*` -> foto e `video/*` -> video, e
// por isso um `.gif`, um `.webp`, um `.heic` do iPhone ou um `.mov` da camera
// entravam como foto/video e a META RECUSAVA O UPLOAD -- a consultora via "nao
// consegui enviar" num arquivo que o WhatsApp dela manda sem reclamar (porque
// o aplicativo converte antes, e nos nao).
//
// O que este teste cobra:
//   · o que a Meta aceita como foto/audio/video/figurinha e classificado assim;
//   · o que ela NAO aceita cai em DOCUMENTO -- chega a cliente num cartao em
//     vez de na foto, que e infinitamente melhor que nao chegar;
//   · figurinha acima do teto vira documento, em vez de virar erro do Graph;
//   · as grafias do mundo real (`image/jpg`, `audio/mp3`, `video/3gp`) sao
//     normalizadas antes;
//   · quem envia e AVISADO do desvio, com a frase que diz o que fazer.
//
// Teste de mesa: nao sobe arquivo nenhum e nao fala com a Meta. O que ele
// verifica e a REGUA -- e errar a regua e o que fazia o upload falhar.
// -----------------------------------------------------------------------------
// ⚠️ roda com `node --experimental-strip-types`: o alvo é um `.ts` de verdade,
// e o ponto é testar a MESMA régua que o servidor usa — uma cópia em JS aqui
// divergiria no primeiro formato novo.
import { tipoDoMime, viraDocumento, limiteDe, MIMES_META } from "../../web/lib/midia.ts";

const passos = [];
const ok = (n, d = "") => passos.push({ n, ok: true, d });
const falha = (n, d = "") => passos.push({ n, ok: false, d });

const KB = 1024;
const MB = 1024 * KB;

// ---- 1. tudo que a Meta aceita, classificado certo -------------------------
for (const [tipo, mimes] of Object.entries(MIMES_META)) {
  const errados = mimes.filter((m) => tipoDoMime(m, 10 * KB) !== tipo);
  errados.length
    ? falha(`Meta ${tipo}: classificado certo`, errados.join(", "))
    : ok(`Meta ${tipo}: classificado certo`, mimes.join(", "));
}

// ---- 2. o que ela NAO aceita cai em documento ------------------------------
const CAI_EM_DOCUMENTO = [
  ["image/gif", "meme, muito comum"],
  ["image/heic", "foto de iPhone"],
  ["image/heif", "foto de iPhone"],
  ["image/bmp", "print antigo"],
  ["image/tiff", "digitalizacao"],
  ["video/quicktime", ".mov da camera do iPhone"],
  ["video/webm", "gravacao de tela"],
  ["video/x-msvideo", ".avi"],
  ["audio/webm", "gravacao do Chrome sem remux"],
  ["audio/flac", "audio sem perdas"],
  ["application/zip", "pasta compactada"],
  ["text/csv", "planilha simples"],
  ["application/octet-stream", "tipo desconhecido"],
];
const erros2 = CAI_EM_DOCUMENTO.filter(([m]) => tipoDoMime(m, 1 * MB) !== "document");
erros2.length
  ? falha("o que a Meta nao aceita cai em documento", erros2.map(([m]) => m).join(", "))
  : ok("o que a Meta nao aceita cai em documento", `${CAI_EM_DOCUMENTO.length} formatos`);

// ---- 3. figurinha: so dentro do teto --------------------------------------
tipoDoMime("image/webp", 80 * KB) === "sticker"
  ? ok("webp pequeno vira FIGURINHA", "80 KB")
  : falha("webp pequeno vira figurinha", tipoDoMime("image/webp", 80 * KB));
tipoDoMime("image/webp", 2 * MB) === "document"
  ? ok("webp GRANDE vira documento, nao erro do Graph", "2 MB")
  : falha("webp grande vira documento", tipoDoMime("image/webp", 2 * MB));
// sem tamanho conhecido, vale a aposta otimista — quem confere de novo com o
// byteLength real e a rota, antes de subir
tipoDoMime("image/webp") === "sticker"
  ? ok("sem tamanho, webp e tratado como figurinha (a rota confere depois)")
  : falha("sem tamanho, webp e figurinha", tipoDoMime("image/webp"));

// ---- 4. grafias do mundo real ---------------------------------------------
const GRAFIAS = [
  ["image/jpg", "image", "o que varios aparelhos mandam, fora do padrao"],
  ["image/pjpeg", "image", "JPEG progressivo de scanner antigo"],
  ["audio/mp3", "audio", "o mime que o mundo usa; o padrao e audio/mpeg"],
  ["audio/x-m4a", "audio", "gravacao de iPhone"],
  ["video/3gp", "video", "sem o segundo p"],
  ["IMAGE/PNG", "image", "maiuscula"],
  ["image/jpeg; charset=binary", "image", "com parametro"],
];
const erros4 = GRAFIAS.filter(([m, esperado]) => tipoDoMime(m, 100 * KB) !== esperado);
erros4.length
  ? falha("grafias do mundo real sao normalizadas", JSON.stringify(erros4))
  : ok("grafias do mundo real sao normalizadas", `${GRAFIAS.length} casos`);

// ---- 5. o limite acompanha o tipo -----------------------------------------
const LIMITES = [
  ["image/jpeg", 5 * MB],
  ["audio/ogg", 16 * MB],
  ["video/mp4", 16 * MB],
  ["application/pdf", 50 * MB],   // teto NOSSO, menor que os 100 MB da Meta
  ["image/gif", 50 * MB],         // vira documento, entao herda o teto de documento
];
const erros5 = LIMITES.filter(([m, esperado]) => limiteDe(m, 1 * KB) !== esperado);
erros5.length
  ? falha("o limite acompanha o tipo", JSON.stringify(erros5.map(([m]) => m)))
  : ok("o limite acompanha o tipo", "foto 5 · audio/video 16 · documento 50 MB");

// ---- 6. o desvio e DITO, com a frase que diz o que fazer -------------------
const gif = viraDocumento("image/gif", 1 * MB);
gif && /JPEG e PNG/.test(gif)
  ? ok("o desvio do GIF e explicado", gif)
  : falha("o desvio do GIF e explicado", String(gif));
const mov = viraDocumento("video/quicktime", 5 * MB);
mov && /MP4/.test(mov)
  ? ok("o desvio do .mov e explicado", mov)
  : falha("o desvio do .mov e explicado", String(mov));
const webpGrande = viraDocumento("image/webp", 2 * MB);
webpGrande && /figurinha/i.test(webpGrande)
  ? ok("o desvio da figurinha grande e explicado", webpGrande)
  : falha("o desvio da figurinha grande e explicado", String(webpGrande));
viraDocumento("image/jpeg", 1 * MB) === null
  ? ok("o que vai como foto NAO gera aviso de desvio")
  : falha("o que vai como foto nao gera aviso");
viraDocumento("application/pdf", 1 * MB) === null
  ? ok("documento de verdade NAO gera aviso de desvio")
  : falha("documento de verdade nao gera aviso");

const bons = passos.filter((p) => p.ok).length;
for (const p of passos) console.log(`${p.ok ? "OK  " : "FALHA"} ${p.n}${p.d ? ` — ${p.d}` : ""}`);
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
