"use client";

import { useEffect, useRef, useState } from "react";
import { explicarErroMicrofone } from "../../../lib/microfone";

// ---------------------------------------------------------------------------
// TIRAR FOTO E MANDAR (28/09/2026, pedido do dono)
//
// Dois caminhos, porque os dois aparelhos pedem coisas diferentes:
//
//   · CELULAR: `<input type="file" accept="image/*" capture="environment">`.
//     O sistema abre a câmera nativa, com foco, flash e HDR — melhor do que
//     qualquer coisa que a gente desenhe, e sem pedir permissão de câmera ao
//     navegador. Por isso a tela nem tenta o caminho de baixo ali;
//
//   · COMPUTADOR: `getUserMedia` + um quadro do vídeo no canvas. O navegador
//     não tem câmera nativa para abrir, então a prévia é nossa.
//
// ⚠️ DENTRO DO HUB A CÂMERA PODE ESTAR BLOQUEADA, e do mesmo jeito silencioso
// que o microfone já foi (§22.5, §66): em iframe de outra origem o padrão de
// `camera` é `self`, então sem `allow="camera"` no quadro pai o pedido é
// RECUSADO SEM PROMPT — erro idêntico ao de "a pessoa clicou em bloquear",
// solução oposta. Aqui isso vira uma frase que diz o que fazer, em vez de um
// "permissão negada" que manda a pessoa procurar no cadeado o que não existe.
// ---------------------------------------------------------------------------

/** o quadro pai delegou a câmera para esta tela? */
function cameraLiberadaNoQuadro(): boolean | null {
  try {
    const pp: any = (document as any).permissionsPolicy ?? (document as any).featurePolicy;
    if (pp?.allowsFeature) return !!pp.allowsFeature("camera");
  } catch {}
  return null; // não dá para saber — não invente
}

export function Camera({
  aberta,
  aoFechar,
  aoFoto,
  aoErro,
}: {
  aberta: boolean;
  aoFechar: () => void;
  aoFoto: (arquivo: File) => void;
  aoErro: (msg: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const fluxo = useRef<MediaStream | null>(null);
  const [pronta, setPronta] = useState(false);
  const [previa, setPrevia] = useState<{ arquivo: File; url: string } | null>(null);

  useEffect(() => {
    if (!aberta) return;
    let vivo = true;

    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 } },
          audio: false,
        });
        if (!vivo) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        fluxo.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        setPronta(true);
      } catch (e) {
        const noQuadro = cameraLiberadaNoQuadro();
        aoErro(
          noQuadro === false
            ? "A câmera está bloqueada porque o CRM está aberto dentro do hub. " +
              "Abra crm.muranoprofessional.com.br direto — ou peça para liberarem a câmera no hub."
            : await explicarErroMicrofone(e).then((m) => m.replace(/microfone/gi, "câmera")),
        );
        aoFechar();
      }
    })();

    return () => {
      vivo = false;
      // ⚠️ a luz da câmera precisa APAGAR aqui, aconteça o que acontecer — é a
      // mesma regra do microfone (§22.2): luz acesa depois de fechar faz a
      // pessoa achar, com razão, que ainda está sendo filmada
      fluxo.current?.getTracks().forEach((t) => t.stop());
      fluxo.current = null;
      setPronta(false);
    };
  }, [aberta, aoErro, aoFechar]);

  // a prévia é um objeto de URL: soltar ao trocar, senão a memória vai junto
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa.url); }, [previa]);

  if (!aberta) return null;

  function tirar() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    // JPEG 0,85: a foto de uma etiqueta ou de um produto não precisa de PNG, e
    // o limite da Meta para imagem é 5 MB
    c.toBlob(
      (b) => {
        if (!b) return aoErro("Não consegui capturar a foto.");
        const arquivo = new File([b], `foto-${Date.now()}.jpg`, { type: "image/jpeg" });
        setPrevia({ arquivo, url: URL.createObjectURL(arquivo) });
      },
      "image/jpeg",
      0.85,
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tirar foto"
      className="fixed inset-0 z-[60] flex flex-col bg-black/90 text-white"
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="flex-1 text-[13px] text-white/80">{previa ? "Conferir a foto" : "Tirar foto"}</span>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar"
          className="grid size-10 place-items-center rounded-full hover:bg-white/10"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        {previa ? (
          <img src={previa.url} alt="foto tirada agora" className="max-h-full max-w-full rounded-lg object-contain" />
        ) : (
          <video ref={video} playsInline muted className="max-h-full max-w-full rounded-lg" />
        )}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-3 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        {previa ? (
          <>
            <button
              type="button"
              onClick={() => setPrevia(null)}
              className="rounded-full px-4 py-2 text-[14px] text-white/90 hover:bg-white/10"
            >
              Tirar outra
            </button>
            <button
              type="button"
              onClick={() => {
                aoFoto(previa.arquivo);
                setPrevia(null);
                aoFechar();
              }}
              className="rounded-full bg-v2-azul px-5 py-2 text-[14px] font-semibold text-white"
            >
              Enviar foto
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={tirar}
            disabled={!pronta}
            aria-label="Tirar a foto"
            className="grid size-16 place-items-center rounded-full ring-4 ring-white/80 disabled:opacity-40"
          >
            <span className="block size-12 rounded-full bg-white" />
          </button>
        )}
      </div>
    </div>
  );
}
