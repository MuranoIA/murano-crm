"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// O PACOTE DE FIGURINHAS (0144, pedido do dono em 28/09/2026)
//
// Receber figurinha já funcionava; faltava mandar. Aqui é a gaveta ao lado do
// emoji: a grade do que está salvo, um clique manda, e dá para acrescentar um
// `.webp` novo.
//
// ⚠️ Carrega SÓ na primeira vez que alguém abre a gaveta — a mesma régua das
// respostas rápidas. Quem nunca usa figurinha não paga por uma consulta, nem
// por baixar as imagens, em toda abertura do chat.
//
// ⚠️ Por que só `.webp`: para a Meta, figurinha é outro tipo de mensagem, e o
// formato dela é WebP (100 KB parada, 500 KB animada). Um PNG "vira figurinha"
// só depois de convertido — e converter animação no navegador não é um botão,
// é uma frente. Enquanto isso, o caminho honesto é dizer o formato: as
// figurinhas que CHEGAM já vêm em WebP e podem ser salvas com um clique, que é
// de onde o pacote nasce na prática.
// ---------------------------------------------------------------------------

export type Figurinha = { id: number; nome: string | null; da_casa: boolean; minha: boolean; url: string | null };

export function GavetaFigurinhas({
  aberta,
  aoFechar,
  aoEnviar,
  aoErro,
}: {
  aberta: boolean;
  aoFechar: () => void;
  aoEnviar: (f: Figurinha) => void;
  aoErro: (msg: string) => void;
}) {
  const [lista, setLista] = useState<Figurinha[] | null>(null);
  const [subindo, setSubindo] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberta || lista !== null) return;
    fetch("/api/chat/figurinhas")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => setLista(j.figurinhas ?? []))
      .catch(() => setLista([]));
  }, [aberta, lista]);

  if (!aberta) return null;

  function acrescentar(f: File) {
    setSubindo(true);
    const corpo = new FormData();
    corpo.set("arquivo", f);
    fetch("/api/chat/figurinhas", { method: "POST", body: corpo })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
        return j;
      })
      .then((j) => setLista((l) => [j.figurinha, ...(l ?? [])]))
      .catch((e) => aoErro(String(e?.message ?? e)))
      .finally(() => setSubindo(false));
  }

  function remover(f: Figurinha) {
    setLista((l) => (l ?? []).filter((x) => x.id !== f.id));
    fetch(`/api/chat/figurinhas?id=${f.id}`, { method: "DELETE" }).catch(() => {});
  }

  return (
    <>
      <div onClick={aoFechar} className="fixed inset-0 z-10" aria-hidden />
      <div className="absolute bottom-[calc(100%-4px)] left-3 z-20 w-[290px] rounded-xl bg-v2-superficie p-2 shadow-e3 ring-1 ring-v2-linha">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">figurinhas</span>
          <button
            data-ripple
            onClick={() => arquivo.current?.click()}
            disabled={subindo}
            title="Acrescentar um .webp ao pacote"
            className="rounded-md px-2 py-0.5 text-[12px] font-medium text-v2-azul hover:bg-v2-azul-claro disabled:opacity-60"
          >
            {subindo ? "subindo…" : "+ acrescentar"}
          </button>
          <input
            ref={arquivo}
            type="file"
            accept="image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) acrescentar(f);
            }}
          />
        </div>

        {lista === null ? (
          <p className="px-1 py-6 text-center text-[13px] text-v2-tinta-fraca">carregando…</p>
        ) : lista.length === 0 ? (
          <p className="px-2 py-5 text-center text-[12.5px] leading-4 text-v2-tinta-fraca">
            Nenhuma figurinha ainda. Quando a cliente mandar uma, use o{" "}
            <b className="text-v2-tinta">salvar figurinha</b> na bolha — ou acrescente um .webp aqui.
          </p>
        ) : (
          <div className="grid max-h-[260px] grid-cols-4 gap-1 overflow-y-auto">
            {lista.map((f) => (
              <span key={f.id} className="group relative">
                <button
                  data-ripple
                  onClick={() => { aoEnviar(f); aoFechar(); }}
                  title={f.nome ? `Enviar ${f.nome}` : "Enviar figurinha"}
                  className="grid aspect-square w-full place-items-center rounded-lg p-1 hover:bg-v2-superficie-2"
                >
                  {f.url ? (
                    <img src={f.url} alt={f.nome ?? "figurinha"} loading="lazy" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-v2-tinta-fraca">sem arquivo</span>
                  )}
                </button>
                {/* tirar do pacote: só quem a pôs lá (ou admin/home, decidido no
                    servidor). Aparece no hover para não virar um X em cada
                    quadrinho de uma grade que é para ser lida de relance. */}
                <button
                  onClick={() => remover(f)}
                  title="Tirar do pacote"
                  aria-label="Tirar do pacote"
                  className="absolute -right-0.5 -top-0.5 hidden size-5 place-items-center rounded-full bg-v2-superficie text-v2-tinta-fraca shadow-e1 ring-1 ring-v2-linha hover:text-v2-erro group-hover:grid"
                >
                  <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
