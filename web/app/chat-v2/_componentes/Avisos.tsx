"use client";

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// FILA de avisos, não um slot só.
//
// O chat antigo tem 18 `setAviso` gravando no MESMO estado: o segundo evento
// apaga o primeiro (achado 4 do laudo de UX). Na prática, a falha de envio some
// porque a mídia terminou de subir, e ninguém fica sabendo que a mensagem não
// saiu.
//
// Aqui cada aviso tem vida própria, some sozinho, e pode carregar uma ação
// ("Reenviar", "Usar template") — que é o que transforma um recado em conserto.
// ---------------------------------------------------------------------------

export type Aviso = {
  id: number;
  texto: string;
  tom: "neutro" | "erro" | "ok";
  acao?: { rotulo: string; fazer: () => void };
};

let proximo = 1;

export function useAvisos() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const fechar = useCallback((id: number) => setAvisos((a) => a.filter((x) => x.id !== id)), []);

  const avisar = useCallback(
    (texto: string, opts: { tom?: Aviso["tom"]; acao?: Aviso["acao"]; ms?: number } = {}) => {
      const id = proximo++;
      const aviso: Aviso = { id, texto, tom: opts.tom ?? "neutro", acao: opts.acao };
      // três é o teto do que dá para ler de uma vez; o mais antigo sai
      setAvisos((a) => [...a.slice(-2), aviso]);
      // aviso com ação fica mais tempo: quem vai clicar precisa de tempo para ler
      setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), opts.ms ?? (opts.acao ? 9000 : 4500));
      return id;
    },
    [],
  );

  return { avisos, avisar, fechar };
}

export function Snackbars({ avisos, fechar }: { avisos: Aviso[]; fechar: (id: number) => void }) {
  if (!avisos.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {avisos.map((a) => (
        <div
          key={a.id}
          role="status"
          className={[
            "entrar pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] shadow-e3",
            a.tom === "erro"
              ? "bg-v2-erro text-white"
              : a.tom === "ok"
                ? "bg-v2-ok text-white"
                : "bg-v2-tinta text-white",
          ].join(" ")}
        >
          <span className="min-w-0 flex-1">{a.texto}</span>
          {a.acao && (
            <button
              data-ripple
              onClick={() => {
                a.acao!.fazer();
                fechar(a.id);
              }}
              className="shrink-0 rounded-lg px-2 py-1 font-semibold uppercase tracking-wide text-white/95 hover:bg-white/15"
            >
              {a.acao.rotulo}
            </button>
          )}
          <button
            onClick={() => fechar(a.id)}
            aria-label="Fechar aviso"
            className="shrink-0 rounded-full p-1 text-white/70 hover:bg-white/15"
          >
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
