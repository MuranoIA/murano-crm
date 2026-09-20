"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { JanelaVirtual } from "../../../lib/virtualizacao";
import { Bolha } from "./Bolha";
import type { Mensagem } from "./tipos";
import { chaveDoDia, diaDaMensagem, hora } from "./formato";

export type Nota = { id: number; cliente_id: string; autor: string; texto: string; criada_em: string };
export type Transferencia = {
  id: number;
  de_carteira: string | null;
  para_carteira: string | null;
  por: string | null;
  observacao: string | null;
  criada_em: string;
};

type Item =
  | { tipo: "dia"; chave: string; rotulo: string }
  | { tipo: "msg"; chave: string; m: Mensagem; primeira: boolean; ultima: boolean }
  | { tipo: "nota"; chave: string; n: Nota }
  | { tipo: "transf"; chave: string; t: Transferencia };

// A conversa. Separador de dia, agrupamento por autor e rolagem que respeita
// onde a pessoa está: quem subiu para reler um preço não é arrancado de lá
// quando chega mensagem nova (a mesma regra da §65.3 do CLAUDE.md).
//
// Notas internas e transferências entram INTERCALADAS pela data, no ponto da
// conversa em que aconteceram — é o que faz a thread contar a história inteira
// em vez de só o que trafegou no WhatsApp.
export function Thread({
  mensagens,
  notas,
  transferencias,
  citadas,
  temMais,
  carregandoAntigas,
  aoCarregarAntigas,
  aoReenviar,
  aoEncaminhar,
  aoApagarNota,
}: {
  mensagens: Mensagem[];
  notas: Nota[];
  transferencias: Transferencia[];
  citadas: Record<string, { conteudo: string | null; enviada_por: string | null }>;
  temMais: boolean;
  carregandoAntigas: boolean;
  aoCarregarAntigas: () => void;
  aoReenviar?: (m: Mensagem) => void;
  aoEncaminhar?: (m: Mensagem) => void;
  aoApagarNota?: (n: Nota) => void;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const ultimaChave = mensagens.length ? mensagens[mensagens.length - 1].id : "";
  const alturaAntes = useRef(0);
  const primeiraChave = mensagens.length ? mensagens[0].id : "";
  const primeiraAnterior = useRef(primeiraChave);

  const itens = useMemo<Item[]>(() => {
    // tudo junto, ordenado por data: mensagens, notas e transferências
    const cru: { em: string; faz: (i: number) => Item }[] = [];
    for (let i = 0; i < mensagens.length; i++) {
      const m = mensagens[i];
      const ant = mensagens[i - 1];
      const prox = mensagens[i + 1];
      const mesmoAutor = (a?: Mensagem, b?: Mensagem) =>
        !!a && !!b &&
        (a.enviada_por === "customer") === (b.enviada_por === "customer") &&
        chaveDoDia(a.criada_em) === chaveDoDia(b.criada_em);
      cru.push({
        em: m.criada_em,
        faz: () => ({
          tipo: "msg",
          chave: m.id,
          m,
          primeira: !mesmoAutor(ant, m),
          ultima: !mesmoAutor(m, prox),
        }),
      });
    }
    for (const n of notas) cru.push({ em: n.criada_em, faz: () => ({ tipo: "nota", chave: `nota-${n.id}`, n }) });
    for (const t of transferencias)
      cru.push({ em: t.criada_em, faz: () => ({ tipo: "transf", chave: `tr-${t.id}`, t }) });

    cru.sort((a, b) => (a.em < b.em ? -1 : a.em > b.em ? 1 : 0));

    const out: Item[] = [];
    let diaAtual = "";
    for (let i = 0; i < cru.length; i++) {
      const d = chaveDoDia(cru[i].em);
      if (d !== diaAtual) {
        diaAtual = d;
        out.push({ tipo: "dia", chave: `dia-${d}`, rotulo: diaDaMensagem(cru[i].em) });
      }
      out.push(cru[i].faz(i));
    }
    return out;
  }, [mensagens, notas, transferencias]);

  // ⚠️ ROLAR UMA VEZ PARA O FIM NÃO BASTA — a primeira foto do v2 mostrou a
  // conversa abrindo com as últimas bolhas cortadas embaixo, e um punhado de
  // `setTimeout` não resolveu. O conteúdo CRESCE depois do primeiro render, em
  // dois tempos: a virtualização mede a altura real de cada item, e as imagens
  // terminam de carregar (essa pode levar segundos).
  //
  // Então quem decide não é o relógio, é o tamanho: um ResizeObserver no
  // conteúdo cola no fim toda vez que ele cresce — enquanto a pessoa estiver no
  // fim. Se ela subiu para reler um preço, `colado` vira falso e ela fica onde
  // está (§65.3).
  const conteudo = useRef<HTMLDivElement>(null);
  const colado = useRef(true);

  useEffect(() => {
    const el = raiz.current;
    const alvo = conteudo.current;
    if (!el || !alvo) return;

    const fim = () => {
      el.scrollTop = el.scrollHeight;
    };
    const aoRolar = () => {
      colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    };

    fim();
    el.addEventListener("scroll", aoRolar, { passive: true });
    const obs = new ResizeObserver(() => {
      if (colado.current) fim();
    });
    obs.observe(alvo);
    return () => {
      el.removeEventListener("scroll", aoRolar);
      obs.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mensagem nova: o ResizeObserver já cola, mas o `scrollTop` precisa de um
  // empurrão quando a altura não muda (mensagem que cabe no espaço em branco)
  useEffect(() => {
    const el = raiz.current;
    if (el && colado.current) el.scrollTop = el.scrollHeight;
  }, [ultimaChave]);

  // carregou mensagens antigas: mantém a leitura no mesmo ponto, somando o que
  // cresceu acima. Sem isto, a pessoa é jogada para o topo do passado.
  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el) return;
    if (primeiraAnterior.current !== primeiraChave && alturaAntes.current) {
      el.scrollTop += el.scrollHeight - alturaAntes.current;
    }
    primeiraAnterior.current = primeiraChave;
    alturaAntes.current = el.scrollHeight;
  }, [primeiraChave]);

  const chave = useMemo(() => (i: Item) => i.chave, []);

  return (
    <div ref={raiz} className="rolagem min-h-0 flex-1 overflow-y-auto py-2">
      <div ref={conteudo}>
        {temMais && (
          <div className="flex justify-center py-2">
            <button
              data-ripple
              disabled={carregandoAntigas}
              onClick={() => {
                alturaAntes.current = raiz.current?.scrollHeight ?? 0;
                aoCarregarAntigas();
              }}
              className="rounded-full bg-v2-superficie px-4 py-1.5 text-[13px] text-v2-azul shadow-e1 disabled:opacity-60"
            >
              {carregandoAntigas ? "carregando…" : "Carregar mensagens anteriores"}
            </button>
          </div>
        )}

        {itens.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-v2-tinta-fraca">Sem mensagens nesta conversa.</p>
        ) : (
          <JanelaVirtual
            itens={itens}
            chave={chave}
            raizRef={raiz}
            alturaEstimada={64}
            ativo={itens.length > 80}
            renderItem={(i) =>
              i.tipo === "dia" ? (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-v2-superficie px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-v2-tinta-fraca shadow-e1">
                    {i.rotulo}
                  </span>
                </div>
              ) : i.tipo === "nota" ? (
                // papel amarelo: a nota é da equipe, e precisa ser impossível
                // confundir com o que a cliente leu
                <div className="my-1.5 flex justify-center px-3">
                  <div className="w-full max-w-[min(80%,620px)] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 shadow-e1">
                    <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-700">
                      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 4h14v11l-5 5H5V4Z" />
                      </svg>
                      nota interna · {i.n.autor}
                      <span className="ml-auto font-normal normal-case tabular-nums text-amber-600">{hora(i.n.criada_em)}</span>
                      {aoApagarNota && (
                        <button
                          onClick={() => aoApagarNota(i.n)}
                          title="Apagar nota"
                          className="rounded p-0.5 text-amber-600 hover:bg-amber-100"
                        >
                          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="m6 6 12 12M18 6 6 18" />
                          </svg>
                        </button>
                      )}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-5 text-amber-950">{i.n.texto}</p>
                  </div>
                </div>
              ) : i.tipo === "transf" ? (
                <div className="my-2 flex justify-center px-3">
                  <span className="rounded-full bg-v2-vinho-claro px-3 py-1 text-[11.5px] text-v2-vinho-texto">
                    ↪ {i.t.de_carteira ?? "fila"} → {i.t.para_carteira ?? "fila"}
                    {i.t.observacao ? ` · ${i.t.observacao}` : ""}
                    <span className="ml-2 tabular-nums opacity-70">{hora(i.t.criada_em)}</span>
                  </span>
                </div>
              ) : (
                <Bolha
                  m={i.m}
                  primeiraDoGrupo={i.primeira}
                  ultimaDoGrupo={i.ultima}
                  citada={i.m.resposta_a ? citadas[i.m.resposta_a] : undefined}
                  aoReenviar={aoReenviar}
                  aoEncaminhar={aoEncaminhar}
                />
              )
            }
          />
        )}
      </div>
    </div>
  );
}
