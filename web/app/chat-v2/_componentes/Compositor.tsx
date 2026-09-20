"use client";

import { useLayoutEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// A CAIXA DE TEXTO — e a razão principal de o chat ter sido reconstruído.
//
// No chat antigo o texto mora em `useState("")` dentro do componente de 5.400
// linhas (`app/chat/page.tsx:1382`): cada tecla redesenha lista, conversa e
// painel. A fase 0 mediu uma long task de até 136 ms por 20 teclas, com a pior
// interação em 272 ms numa das rodadas.
//
// Aqui o texto NÃO SOBE. Ele nasce e morre neste componente; o pai só recebe o
// evento "enviar". Digitar não pode custar nada ao resto da tela.
//
// ⚠️ Fase 1 é só leitura: dá para digitar (é assim que se mede o atraso), mas
// o envio não existe ainda — e a tela diz isso, em vez de fingir um botão.
// ---------------------------------------------------------------------------

export function Compositor({ podeEnviar, aviso }: { podeEnviar: boolean; aviso?: string | null }) {
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);

  // cresce até ~5 linhas e depois rola por dentro.
  // ⚠️ `height = "0px"` antes de ler o `scrollHeight`: com "auto" o navegador
  // devolve o valor anterior e a caixa nunca encolhe (§51 do CLAUDE.md).
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [texto]);

  return (
    <div className="shrink-0 border-t border-v2-linha bg-v2-superficie px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {aviso && (
        <p className="mb-2 rounded-lg bg-v2-laranja-claro px-3 py-2 text-[12.5px] leading-4 text-v2-laranja">{aviso}</p>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-v2-linha-forte bg-v2-superficie px-2 py-1.5 focus-within:border-v2-azul">
        <button
          data-ripple
          disabled
          title="Anexo chega na fase 3"
          className="grid size-10 shrink-0 place-items-center rounded-full text-v2-tinta-fraca disabled:opacity-40"
          aria-label="Anexar"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M21 11.5 12.5 20a5 5 0 1 1-7-7l8-8a3.5 3.5 0 1 1 5 5l-8 8a2 2 0 1 1-3-3l7.5-7.5" />
          </svg>
        </button>

        <textarea
          ref={campo}
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          // ⚠️ nada de placeholder comprido: o `scrollHeight` de um textarea
          // VAZIO conta a altura do placeholder, e um texto de duas linhas faz
          // a caixa nunca voltar ao tamanho de uma linha (§51).
          placeholder="Mensagem"
          title="Enter envia, Shift+Enter quebra linha (a partir da fase 2)"
          className="max-h-[120px] min-h-[36px] flex-1 resize-none bg-transparent py-1.5 leading-5 outline-none placeholder:text-v2-tinta-fraca"
        />

        <button
          data-ripple
          disabled={!podeEnviar || !texto.trim()}
          title={podeEnviar ? "Enviar" : "A escrita chega na fase 2 — hoje o chat-v2 é só leitura"}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-v2-azul text-white transition-colors disabled:bg-v2-linha-forte disabled:text-white/70"
          aria-label="Enviar"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12 20 4l-7 16-2.5-6.5L4 12Z" />
          </svg>
        </button>
      </div>

      {!podeEnviar && (
        <p className="mt-1.5 text-center text-[11.5px] text-v2-tinta-fraca">
          Fase 1: leitura. Dá para digitar — o envio chega na fase 2.
        </p>
      )}
    </div>
  );
}
