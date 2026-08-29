// Prepara, NO NAVEGADOR, o trecho de música que vai tocar na tela de parabéns
// do Ranking. Roda só no cliente (usa AudioContext).
//
// Por que no navegador e não no servidor: extrair áudio de um .mp4 exigiria
// ffmpeg, que não existe no runtime da Vercel. O decodificador do navegador já
// faz isso de graça — `decodeAudioData` lê o container (mp3, m4a, mp4, ogg,
// webm, wav) e devolve SÓ as amostras de áudio. A trilha de vídeo do mp4 é
// descartada aí, sem passo extra: nunca chega a ser decodificada.
//
// O resultado é um WAV PCM mono de no máximo SEGUNDOS_PARABENS segundos, com
// fade de entrada e de saída (corte seco em música soa como falha de som).
// ~90 s mono a 44,1 kHz = ~7,9 MB, que a TV baixa uma vez e mantém em cache.

export const SEGUNDOS_PARABENS = 90;

const FADE_IN = 0.04;
const FADE_OUT = 1.2;

export type TrechoPronto = {
  blob: Blob;          // WAV cortado, pronto pra subir
  segundos: number;    // duração real (pode ser < 90 se a música for curta)
  duracaoOriginal: number;
  temVideo: boolean;   // o arquivo de origem era um container de vídeo
};

function ehVideo(file: File) {
  return /^video\//.test(file.type) || /\.(mp4|m4v|mov|webm|avi|mkv)$/i.test(file.name);
}

// Decodifica -> corta -> mono -> fade. Devolve null quando o navegador não sabe
// decodificar o arquivo (codec fora do que ele suporta); nesse caso o chamador
// sobe o original e o painel corta na hora de tocar.
export async function prepararTrecho(file: File, inicioSeg = 0): Promise<TrechoPronto | null> {
  const AC: typeof AudioContext | undefined =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;

  const ctx = new AC();
  try {
    const bruto = await file.arrayBuffer();
    // decodeAudioData com callbacks: o Safari antigo não devolve Promise.
    const buf: AudioBuffer = await new Promise((ok, falha) => {
      try {
        const p = (ctx as any).decodeAudioData(bruto, ok, falha);
        if (p && typeof p.then === "function") p.then(ok, falha);
      } catch (e) { falha(e); }
    });

    const sr = buf.sampleRate;
    const inicio = Math.max(0, Math.min(inicioSeg, Math.max(0, buf.duration - 1)));
    const de = Math.floor(inicio * sr);
    const quantas = Math.min(buf.length - de, Math.floor(SEGUNDOS_PARABENS * sr));
    if (quantas <= 0) return null;

    // mistura os canais em mono (metade do tamanho; TV de parede é mono na prática)
    const dados = new Float32Array(quantas);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const canal = buf.getChannelData(c);
      for (let i = 0; i < quantas; i++) dados[i] += canal[de + i] / buf.numberOfChannels;
    }

    const nIn = Math.min(Math.floor(FADE_IN * sr), quantas);
    const nOut = Math.min(Math.floor(FADE_OUT * sr), quantas);
    for (let i = 0; i < nIn; i++) dados[i] *= i / nIn;
    for (let i = 0; i < nOut; i++) dados[quantas - 1 - i] *= i / nOut;

    return {
      blob: paraWav(dados, sr),
      segundos: quantas / sr,
      duracaoOriginal: buf.duration,
      temVideo: ehVideo(file),
    };
  } catch {
    return null;
  } finally {
    try { await ctx.close(); } catch { /* já fechado */ }
  }
}

// WAV PCM 16 bits, 1 canal — o formato que qualquer navegador de TV toca sem drama.
function paraWav(amostras: Float32Array, sampleRate: number): Blob {
  const bytes = amostras.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const txt = (pos: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(pos + i, s.charCodeAt(i)); };

  txt(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  txt(8, "WAVEfmt ");
  v.setUint32(16, 16, true);          // tamanho do bloco fmt
  v.setUint16(20, 1, true);           // PCM
  v.setUint16(22, 1, true);           // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // bytes por segundo
  v.setUint16(32, 2, true);           // alinhamento do bloco
  v.setUint16(34, 16, true);          // bits por amostra
  txt(36, "data");
  v.setUint32(40, bytes, true);

  let pos = 44;
  for (let i = 0; i < amostras.length; i++) {
    const s = Math.max(-1, Math.min(1, amostras[i]));
    v.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    pos += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

export function segundosFmt(s: number) {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}
