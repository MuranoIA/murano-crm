"use client";

import { useCallback, useRef, useState } from "react";
import { explicarErroGravador, explicarErroMicrofone } from "../../../lib/microfone";
import { ehWebm, webmParaOgg } from "../../../lib/opusOgg";

// ---------------------------------------------------------------------------
// Gravar áudio (PTT). O caminho tem três armadilhas já pagas no chat antigo:
//
// 1. CADA NAVEGADOR GRAVA NUM CONTAINER: Firefox dá ogg/opus (que é o formato
//    final), Chrome/Edge dão webm/opus (MESMO codec, container errado, e a Meta
//    recusa) e o Safari só grava mp4/AAC. `webmParaOgg` reembala o Chrome sem
//    recodificar — por isso a conversão é instantânea.
// 2. `track.stop()` no fim é OBRIGATÓRIO: sem ele a luz do microfone continua
//    acesa e a pessoa acha, com razão, que ainda está sendo ouvida (§22.2).
// 3. O erro de permissão em iframe é IDÊNTICO ao de "o usuário bloqueou", mas a
//    solução é oposta — `explicarErroMicrofone` distingue os casos (§66).
// ---------------------------------------------------------------------------

const FORMATOS = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4"];

export function useGravador(aoPronto: (arquivo: File) => void, aoErro: (msg: string) => void) {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<BlobPart[]>([]);
  const relogio = useRef<any>(null);
  const cancelado = useRef(false);

  const parar = useCallback((cancelar = false) => {
    cancelado.current = cancelar;
    try { rec.current?.stop(); } catch {}
  }, []);

  const gravar = useCallback(async () => {
    if (typeof (window as any).MediaRecorder === "undefined") {
      aoErro("Este navegador não grava áudio.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      aoErro(await explicarErroMicrofone(e));
      return;
    }
    try {
      const mime = FORMATOS.find((f) => (window as any).MediaRecorder?.isTypeSupported?.(f)) ?? "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.current = r;
      pedacos.current = [];
      cancelado.current = false;
      r.ondataavailable = (e) => e.data.size && pedacos.current.push(e.data);
      r.onstop = async () => {
        // a luz do microfone precisa APAGAR aqui, aconteça o que acontecer
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(relogio.current);
        setGravando(false);
        setSegundos(0);
        if (cancelado.current) return;
        const tipo = r.mimeType || mime || "audio/ogg";
        let blob = new Blob(pedacos.current, { type: tipo });
        let ext = tipo.includes("ogg") ? "ogg" : tipo.includes("mp4") ? "m4a" : "webm";
        if (ehWebm(await blob.arrayBuffer().then((b) => new Uint8Array(b)))) {
          const ogg = webmParaOgg(new Uint8Array(await blob.arrayBuffer()));
          if (ogg) {
            blob = new Blob([ogg as unknown as BlobPart], { type: "audio/ogg" });
            ext = "ogg";
          }
        }
        if (blob.size < 800) {
          aoErro("Áudio curto demais — segure o botão para gravar.");
          return;
        }
        aoPronto(new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type }));
      };
      r.start();
      setGravando(true);
      setSegundos(0);
      relogio.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop()); // idem: falhar não pode deixar a luz acesa
      aoErro(explicarErroGravador(e));
    }
  }, [aoPronto, aoErro]);

  return { gravando, segundos, gravar, parar };
}
