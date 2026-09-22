"use client";

import { useEffect } from "react";

// Um ouvinte só: qualquer elemento com `data-ripple` dentro do /chat-v2 ganha a
// onda do Material ao toque.
//
// Por que isto vale o arquivo: é o que faz a interface PARECER rápida. A onda
// sai no `pointerdown`, antes de qualquer estado mudar — então o toque tem
// resposta mesmo quando o servidor ainda está pensando. Sem ela, um botão que
// demora 200 ms parece quebrado; com ela, parece que já começou.
//
// Ouvinte global em vez de um por botão: a lista de conversas é virtualizada e
// os itens entram e saem do DOM o tempo todo; prender um listener em cada um
// seria montar e desmontar centenas deles ao rolar.
export function Ripple() {
  useEffect(() => {
    function aoTocar(e: PointerEvent) {
      const alvo = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-ripple]");
      if (!alvo || alvo.hasAttribute("disabled")) return;
      const r = alvo.getBoundingClientRect();
      const tamanho = Math.hypot(r.width, r.height) * 2;
      const onda = document.createElement("span");
      onda.className = "ripple-onda";
      onda.style.width = onda.style.height = `${tamanho}px`;
      onda.style.left = `${e.clientX - r.left - tamanho / 2}px`;
      onda.style.top = `${e.clientY - r.top - tamanho / 2}px`;
      alvo.appendChild(onda);
      onda.addEventListener("animationend", () => onda.remove());
    }
    document.addEventListener("pointerdown", aoTocar);
    return () => document.removeEventListener("pointerdown", aoTocar);
  }, []);
  return null;
}
