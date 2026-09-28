"use client";

import { useEffect, useRef, useState } from "react";
import {
  AMOSTRA_TEMA_CHAT,
  COOKIE_TEMA_CHAT,
  ROTULO_TEMA_CHAT,
  TEMAS_CHAT,
  type TemaChat,
} from "../../../lib/temaChat";

// ---------------------------------------------------------------------------
// O SELETOR DE TEMA (28/09/2026) — os claros do Café Code, só no chat.
//
// A troca é IMEDIATA e sem recarregar: escreve o cookie (para a próxima
// abertura já nascer certa, no servidor) e muda o `data-tema` do `.v2` na hora.
// Recarregar a página para trocar de cor seria perder a conversa aberta e a
// rolagem — caro demais para uma escolha de gosto.
//
// A bolinha tem DUAS metades, como no Café Code: marca e ação. É o que
// distingue os temas de relance — o Atlântico troca a ação por latão, e uma
// bolinha de uma cor só esconderia justamente isso.
// ---------------------------------------------------------------------------
export function SeletorTema({ tema, aoTrocar }: { tema: TemaChat; aoTrocar: (t: TemaChat) => void }) {
  const [pos, setPos] = useState<null | { top: number; right: number }>(null);
  const botao = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [pos]);

  function escolher(t: TemaChat) {
    setPos(null);
    // um ano, do caminho inteiro: a mesma escolha vale no board embutido e na
    // volta pelo SSO do hub
    try {
      document.cookie = `${COOKIE_TEMA_CHAT}=${t}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {}
    aoTrocar(t);
  }

  return (
    <>
      <button
        ref={botao}
        data-ripple
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label="Tema da tela"
        title={`Tema: ${ROTULO_TEMA_CHAT[tema]}`}
        onClick={() => {
          if (pos) return setPos(null);
          const r = botao.current?.getBoundingClientRect();
          if (!r) return;
          setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
        }}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-white/85 ring-1 ring-inset ring-white/20 hover:bg-white/15"
      >
        <Bolinha tema={tema} tamanho={16} />
      </button>

      {pos && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setPos(null)} aria-hidden />
          <div
            role="menu"
            style={{ top: pos.top, right: pos.right }}
            className="entrar fixed z-50 w-56 rounded-xl bg-v2-superficie py-1 shadow-e3 ring-1 ring-v2-linha"
          >
            <p className="px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">
              tema
            </p>
            {TEMAS_CHAT.map((t) => (
              <button
                key={t}
                data-ripple
                role="menuitemradio"
                aria-checked={t === tema}
                onClick={() => escolher(t)}
                className={[
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-[14px]",
                  t === tema ? "font-semibold text-v2-vinho" : "text-v2-tinta hover:bg-v2-superficie-2",
                ].join(" ")}
              >
                <Bolinha tema={t} tamanho={18} />
                <span className="flex-1">{ROTULO_TEMA_CHAT[t]}</span>
                {t === tema && (
                  <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                )}
              </button>
            ))}
            <p className="px-3 pb-1.5 pt-1 text-[11px] leading-4 text-v2-tinta-fraca">
              Vale só para o chat, e só para você.
            </p>
          </div>
        </>
      )}
    </>
  );
}

/** as duas metades: marca à esquerda, ação à direita */
function Bolinha({ tema, tamanho }: { tema: TemaChat; tamanho: number }) {
  const [marca, acao] = AMOSTRA_TEMA_CHAT[tema];
  return (
    <span
      aria-hidden
      className="block shrink-0 rounded-full ring-1 ring-black/10"
      style={{
        width: tamanho,
        height: tamanho,
        background: `linear-gradient(90deg, ${marca} 0 50%, ${acao} 50% 100%)`,
      }}
    />
  );
}
