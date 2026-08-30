// Regras de mídia compartilhadas entre o navegador e as rotas.
//
// Isto mora fora de `lib/whatsapp.ts` de propósito: aquele módulo lê o token da
// Meta e não pode entrar no bundle do navegador. A tela precisa saber o tipo e o
// limite ANTES de subir o arquivo — avisar depois de 40 MB enviados é o oposto
// de ajudar. `lib/whatsapp.ts` reexporta as duas funções, então quem já
// importava de lá continua funcionando.

export type TipoMidia = "image" | "audio" | "video" | "document";

/** Classifica o mime no tipo que a Cloud API entende. O que não é foto, áudio nem vídeo é documento. */
export function tipoDoMime(mime: string): TipoMidia {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "document";
}

/** Extensão de arquivo a partir do mime — só para o nome no Storage ficar legível. */
export function extensaoDoMime(mime: string): string {
  const mapa: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr", "audio/aac": "aac",
    "video/mp4": "mp4", "video/3gpp": "3gp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  const limpo = mime.split(";")[0].trim().toLowerCase();
  if (mapa[limpo]) return mapa[limpo];
  const sub = limpo.split("/")[1] ?? "bin";
  return sub.replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
}

const MB = 1024 * 1024;

/**
 * Teto de cada tipo NA META (documentado por eles). Acima disso a Graph recusa o
 * upload, então recusar aqui só antecipa o mesmo "não" — de graça, e com um
 * recado que diz o tamanho em vez de um erro em inglês.
 */
export const LIMITE_META: Record<TipoMidia, number> = {
  image: 5 * MB,
  audio: 16 * MB,
  video: 16 * MB,
  document: 100 * MB,
};

/**
 * ⚠️ Teto NOSSO, e é menor que o da Meta só para documento.
 *
 * O arquivo sobe direto do navegador para o Storage (por isso não existe mais o
 * corte de 4,5 MB da Vercel), mas quem repassa os bytes para a Meta é a nossa
 * rota: ela BAIXA do Storage e faz o upload no `/media`. Esse ida-e-volta cabe
 * nos 60s de `maxDuration` até uma certa altura — daí o corte em 50 MB, que é
 * onde dá para prometer com honestidade.
 *
 * Para chegar aos 100 MB da Meta seriam necessários OU um `maxDuration` maior
 * (depende do plano da Vercel) OU mandar a mensagem por `link`, com a Meta
 * buscando o arquivo direto no Storage — desenho descartado em 29/08 por não
 * ter como ser provado sem mandar mensagem de teste a um número real.
 */
export const LIMITE_NOSSO: Record<TipoMidia, number> = {
  ...LIMITE_META,
  document: 50 * MB,
};

export function limiteDe(mime: string): number {
  return LIMITE_NOSSO[tipoDoMime(mime)];
}

/** "12,3 MB" — para o recado de limite dizer o tamanho, não um número de bytes. */
export function emMB(bytes: number): string {
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0).replace(".", ",")} MB`;
}

const NOME_TIPO: Record<TipoMidia, string> = {
  image: "Foto", audio: "Áudio", video: "Vídeo", document: "Documento",
};

/** Recado de recusa por tamanho, igual nos dois lados (tela e rota). */
export function recadoDeLimite(mime: string, tamanho: number): string {
  const tipo = tipoDoMime(mime);
  return `${NOME_TIPO[tipo]} de ${emMB(tamanho)} — o limite é ${emMB(LIMITE_NOSSO[tipo])}.`;
}
