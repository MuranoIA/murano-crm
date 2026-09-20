"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { JanelaVirtual } from "../../../lib/virtualizacao";
import { ItemConversa } from "./ItemConversa";
import { Filtros, quantosRecortes, type Recortes } from "./Filtros";
import { FILAS, type Conversa, type Fila } from "./tipos";

// A coluna da esquerda: busca, recortes e a lista.
//
// Duas decisões que vêm da fase 0 e do laudo de UX:
//  · os CONTADORES ficam sempre visíveis, em chips. No chat antigo o número de
//    não lidas só existe depois de abrir um dropdown (achado 1) — é a primeira
//    pergunta do dia, paga dezenas de vezes por dia, por sete pessoas;
//  · a lista é VIRTUALIZADA. Uma aba aberta chegou a acumular 43.788 nós de DOM
//    e travar o notebook da equipe (nota do lib/virtualizacao.tsx).

export function ListaConversas({
  conversas,
  selecionada,
  fila,
  busca,
  carregando,
  completa,
  contagens,
  aoAbrir,
  aoTrocarFila,
  aoBuscar,
  aoChegarNoFim,
  presentes,
  recortes,
  aoMudarRecortes,
  filtrosAbertos,
  aoAbrirFiltros,
  consultores,
  linhas,
  contaPorConsultor,
  contaPorLinha,
  contaPorEtapa,
}: {
  conversas: Conversa[];
  selecionada: string | null;
  fila: Fila;
  busca: string;
  carregando: boolean;
  completa: boolean;
  /** null = ainda não chegou do servidor. Chip sem número, nunca zero. */
  contagens: Record<Fila, number | null>;
  aoAbrir: (id: string) => void;
  aoTrocarFila: (f: Fila) => void;
  aoBuscar: (t: string) => void;
  aoChegarNoFim: () => void;
  /** cliente_id -> rótulos de OUTRAS pessoas com a conversa aberta agora */
  presentes: Record<string, string[]>;
  recortes: Recortes;
  aoMudarRecortes: (r: Recortes) => void;
  filtrosAbertos: boolean;
  aoAbrirFiltros: () => void;
  consultores: { endereco: string; nome: string; cor: string | null }[];
  linhas: { id: string; rotulo: string; numero: string | null }[];
  contaPorConsultor: Map<string, number>;
  contaPorLinha: Map<string, number>;
  contaPorEtapa: Map<string, number>;
}) {
  const raiz = useRef<HTMLDivElement>(null);

  // ---- busca NO CONTEÚDO das mensagens ------------------------------------
  // A busca por nome e telefone é local e instantânea (a lista já está aqui).
  // Esta é outra pergunta — "onde foi que eu falei sobre isso?" — e vai ao
  // servidor, que usa trigrama (§18/0081). Mínimo de 3 letras porque abaixo
  // disso o índice não é usado; debounce de 400 ms para não disparar por tecla.
  const [achados, setAchados] = useState<{ conversas: any[]; truncado: boolean } | null>(null);
  const [procurando, setProcurando] = useState(false);

  useEffect(() => {
    const t = busca.trim();
    if (t.length < 3) {
      setAchados(null);
      return;
    }
    let vivo = true;
    const atraso = setTimeout(() => {
      setProcurando(true);
      fetch(`/api/chat/buscar?q=${encodeURIComponent(t)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j) => vivo && setAchados({ conversas: j.conversas ?? [], truncado: !!j.truncado }))
        .catch(() => vivo && setAchados(null))
        .finally(() => vivo && setProcurando(false));
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(atraso);
    };
  }, [busca]);

  // rolou até perto do fim da primeira página: é hora de buscar o resto
  const aoRolar = () => {
    const el = raiz.current;
    if (!el || completa || carregando) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) aoChegarNoFim();
  };

  const chave = useMemo(() => (c: Conversa) => c.cliente_id, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-v2-superficie">
      {/* ---- cabeçalho: busca + recortes ---------------------------------- */}
      <div className="shrink-0 border-b border-v2-linha px-3 pb-2 pt-3">
        <label className="relative block">
          <span className="sr-only">Buscar conversa</span>
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-v2-tinta-fraca"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input
            value={busca}
            onChange={(e) => aoBuscar(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="h-11 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie pl-10 pr-3 text-[15px] placeholder:text-v2-tinta-fraca focus:border-v2-azul focus:outline-none"
            style={{ transition: "border-color 120ms var(--ease-padrao)" }}
          />
        </label>

        {/* chips: rolam até a borda no celular; no desktop quebram em duas
            linhas em vez de esconder "Fila" e "Resolvidas" atrás da borda —
            contador escondido é o achado 1 do laudo, e seria ele de novo */}
        <div className="-mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3 pb-1 md:flex-wrap md:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILAS.map((f) => {
            const ativo = fila === f.id;
            const n = contagens[f.id];
            return (
              <button
                key={f.id}
                data-ripple
                onClick={() => aoTrocarFila(f.id)}
                aria-pressed={ativo}
                className={[
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors duration-150",
                  ativo
                    ? "bg-v2-azul text-white"
                    : "text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie-2",
                ].join(" ")}
              >
                {f.curto}
                {n != null && n > 0 && (
                  <span
                    className={[
                      "min-w-4 rounded-full px-1 text-[11px] tabular-nums",
                      ativo ? "bg-white/20" : "bg-v2-superficie-2 text-v2-tinta-fraca",
                    ].join(" ")}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}

          {/* Os RECORTES ficam atrás de um botão, e os chips de fila não: a
              fila é a primeira pergunta do dia (achado 1 do laudo de UX) e o
              recorte é ocasional. Esconder o recorte não esconde contador
              nenhum — ele nasce sem filtro. */}
          <button
            data-ripple
            onClick={aoAbrirFiltros}
            aria-pressed={filtrosAbertos}
            aria-expanded={filtrosAbertos}
            title="Filtrar por consultor, número ou coluna do board"
            className={[
              "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors duration-150",
              filtrosAbertos || quantosRecortes(recortes) > 0
                ? "bg-v2-azul text-white"
                : "text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie-2",
            ].join(" ")}
          >
            <svg viewBox="0 0 24 24" className="size-[15px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Filtros
            {quantosRecortes(recortes) > 0 && (
              <span className="min-w-4 rounded-full bg-white/20 px-1 text-[11px] tabular-nums">
                {quantosRecortes(recortes)}
              </span>
            )}
          </button>
        </div>
      </div>

      <Filtros
        aberto={filtrosAbertos}
        recortes={recortes}
        aoMudar={aoMudarRecortes}
        consultores={consultores}
        linhas={linhas}
        contaPorConsultor={contaPorConsultor}
        contaPorLinha={contaPorLinha}
        contaPorEtapa={contaPorEtapa}
        carregando={!completa}
      />

      {/* ---- a lista ------------------------------------------------------ */}
      <div ref={raiz} onScroll={aoRolar} className="rolagem min-h-0 flex-1 overflow-y-auto">
        {conversas.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-v2-tinta-fraca">
            {carregando
              ? "Carregando o resto das conversas…"
              : busca
                ? "Nenhuma conversa com esse nome ou telefone."
                : "Nenhuma conversa neste recorte."}
          </p>
        ) : (
          <JanelaVirtual
            itens={conversas}
            chave={chave}
            raizRef={raiz}
            alturaEstimada={72}
            ativo={conversas.length > 40}
            renderItem={(c) => (
              <ItemConversa
                c={c}
                selecionada={c.cliente_id === selecionada}
                aoAbrir={aoAbrir}
                presentes={presentes[c.cliente_id]}
              />
            )}
          />
        )}

        {/* ---- o que a busca achou DENTRO das mensagens ------------------ */}
        {busca.trim().length >= 3 && (
          <div className="border-t border-v2-linha bg-v2-superficie-2">
            <p className="flex items-center gap-2 px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">
              nas mensagens
              {procurando && <span className="font-normal normal-case">procurando…</span>}
              {achados?.truncado && (
                <span className="font-normal normal-case text-v2-laranja">muitos resultados — refine a busca</span>
              )}
            </p>
            {achados && achados.conversas.length === 0 && !procurando && (
              <p className="px-3 pb-3 text-[13px] text-v2-tinta-fraca">Nada encontrado no conteúdo das conversas.</p>
            )}
            {(achados?.conversas ?? []).map((c: any) => (
              <button
                key={`busca-${c.cliente_id}`}
                data-ripple
                onClick={() => aoAbrir(c.cliente_id)}
                className="block w-full px-3 py-2 text-left hover:bg-v2-superficie"
              >
                <span className="block truncate text-[13.5px] font-medium">{c.cliente}</span>
                <span className="mt-0.5 block truncate text-[12.5px] text-v2-tinta-fraca">
                  {c.trecho ?? c.ultima_mensagem}
                </span>
              </button>
            ))}
          </div>
        )}

        {carregando && conversas.length > 0 && (
          <p className="px-4 py-3 text-center text-[12px] text-v2-tinta-fraca">
            carregando o resto da lista…
          </p>
        )}
      </div>
    </div>
  );
}
