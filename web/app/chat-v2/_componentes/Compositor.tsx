"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// A CAIXA DE TEXTO — e a razão principal de o chat ter sido reconstruído.
//
// No chat antigo o texto mora em `useState("")` dentro do componente de 5.400
// linhas (`app/chat/page.tsx:1382`): cada tecla redesenha lista, conversa e
// painel. A fase 0 mediu 1 long task de até 136 ms por 20 teclas, com a pior
// interação em 272 ms numa das rodadas.
//
// Aqui o texto NÃO SOBE. Ele nasce e morre neste componente; o pai só recebe o
// evento "enviar". Digitar não pode custar nada ao resto da tela — medido
// depois: zero long task.
// ---------------------------------------------------------------------------

export type Resposta = { id: number; atalho: string; texto: string; carteira: string | null };

export function Compositor({
  podeEnviar,
  janelaAberta,
  enviando,
  aoEnviar,
  aoTemplate,
}: {
  podeEnviar: boolean;
  janelaAberta: boolean;
  enviando: boolean;
  aoEnviar: (texto: string) => void;
  aoTemplate: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [respostas, setRespostas] = useState<Resposta[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [marcado, setMarcado] = useState(0);
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

  // as respostas rápidas são buscadas UMA vez, na primeira vez que a pessoa
  // digita "/" — quem nunca usa o recurso não paga por ele
  const carregarRespostas = useCallback(() => {
    if (respostas) return;
    fetch("/api/chat/respostas")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => setRespostas(j.respostas ?? []))
      .catch(() => setRespostas([]));
  }, [respostas]);

  const filtro = menu ? texto.slice(1).toLowerCase() : "";
  const sugestoes = (respostas ?? []).filter(
    (r) => !filtro || r.atalho.toLowerCase().includes(filtro) || r.texto.toLowerCase().includes(filtro),
  );

  useEffect(() => setMarcado(0), [filtro, menu]);

  function mudou(v: string) {
    setTexto(v);
    const abriu = v.startsWith("/");
    if (abriu && !menu) carregarRespostas();
    setMenu(abriu);
  }

  function colar(r: Resposta) {
    setTexto(r.texto);
    setMenu(false);
    campo.current?.focus();
  }

  function enviar() {
    const t = texto.trim();
    if (!t || !podeEnviar || enviando) return;
    aoEnviar(t);
    // a caixa esvazia NA HORA: quem manda já está pensando na próxima frase, e
    // esperar o servidor para limpar faria a mensagem parecer não enviada
    setTexto("");
    setMenu(false);
  }

  function tecla(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menu && sugestoes.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMarcado((m) => (m + 1) % sugestoes.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMarcado((m) => (m - 1 + sugestoes.length) % sugestoes.length); return; }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); colar(sugestoes[marcado]); return; }
      if (e.key === "Escape") { setMenu(false); return; }
    }
    // Enter envia, Shift+Enter quebra linha — o que todo mundo já espera de um
    // chat. No celular o Enter do teclado virtual quebra linha, e quem manda é
    // o botão: `isComposing` evita cortar a palavra de quem usa teclado com
    // composição (acentos em alguns teclados Android).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar();
    }
  }

  return (
    <div className="relative shrink-0 border-t border-v2-linha bg-v2-superficie px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {/* ---- respostas rápidas ------------------------------------------- */}
      {menu && (
        <div className="absolute inset-x-3 bottom-[calc(100%-4px)] z-10 max-h-64 overflow-y-auto rounded-xl bg-v2-superficie p-1 shadow-e3 ring-1 ring-v2-linha">
          {respostas === null ? (
            <p className="px-3 py-2 text-[13px] text-v2-tinta-fraca">carregando…</p>
          ) : sugestoes.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-v2-tinta-fraca">
              Nenhuma resposta rápida com esse atalho.
            </p>
          ) : (
            sugestoes.map((r, i) => (
              <button
                key={r.id}
                data-ripple
                onMouseEnter={() => setMarcado(i)}
                onClick={() => colar(r)}
                className={[
                  "block w-full rounded-lg px-3 py-2 text-left",
                  i === marcado ? "bg-v2-azul-claro" : "hover:bg-v2-superficie-2",
                ].join(" ")}
              >
                <span className="text-[13px] font-semibold text-v2-azul">/{r.atalho}</span>
                <span className="ml-2 text-[10px] uppercase tracking-wide text-v2-tinta-fraca">
                  {r.carteira ? "pessoal" : "da casa"}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-v2-tinta-fraca">{r.texto}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* ---- a janela fechada troca a caixa pelo caminho que funciona ----- */}
      {!janelaAberta ? (
        <div className="flex items-center gap-3 rounded-2xl bg-v2-laranja-claro px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[12.5px] leading-4 text-v2-laranja">
            Passaram-se mais de 24h desde a última mensagem dela. Só um template reabre a conversa.
          </p>
          <button
            data-ripple
            onClick={aoTemplate}
            className="shrink-0 rounded-full bg-v2-laranja px-3 py-1.5 text-[13px] font-semibold text-white"
          >
            Template
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2 rounded-2xl border border-v2-linha-forte bg-v2-superficie px-2 py-1.5 focus-within:border-v2-azul">
          <button
            data-ripple
            onClick={aoTemplate}
            title="Enviar um template"
            className="grid size-10 shrink-0 place-items-center rounded-full text-v2-tinta-fraca hover:bg-v2-superficie-2"
            aria-label="Template"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16v11H8l-4 4V5Z" />
            </svg>
          </button>

          <textarea
            ref={campo}
            rows={1}
            value={texto}
            onChange={(e) => mudou(e.target.value)}
            onKeyDown={tecla}
            disabled={!podeEnviar}
            // ⚠️ nada de placeholder comprido: o `scrollHeight` de um textarea
            // VAZIO conta a altura do placeholder, e um texto de duas linhas faz
            // a caixa nunca voltar ao tamanho de uma linha (§51).
            placeholder="Mensagem"
            title="Enter envia · Shift+Enter quebra linha · / abre as respostas rápidas"
            className="max-h-[120px] min-h-[36px] flex-1 resize-none bg-transparent py-1.5 leading-5 outline-none placeholder:text-v2-tinta-fraca disabled:opacity-60"
          />

          <button
            data-ripple
            onClick={enviar}
            disabled={!podeEnviar || !texto.trim() || enviando}
            title="Enviar"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-v2-azul text-white transition-colors disabled:bg-v2-linha-forte disabled:text-white/70"
            aria-label="Enviar"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12 20 4l-7 16-2.5-6.5L4 12Z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
