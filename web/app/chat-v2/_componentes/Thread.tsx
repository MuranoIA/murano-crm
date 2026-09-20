"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { JanelaVirtual } from "../../../lib/virtualizacao";
import { Bolha } from "./Bolha";
import type { Mensagem } from "./tipos";
import { chaveDoDia, diaDaMensagem } from "./formato";

type Item = { tipo: "dia"; chave: string; rotulo: string } | { tipo: "msg"; chave: string; m: Mensagem; primeira: boolean; ultima: boolean };

// A conversa. Separador de dia, agrupamento por autor e rolagem que respeita
// onde a pessoa está: quem subiu para reler um preço não é arrancado de lá
// quando chega mensagem nova (a mesma regra da §65.3 do CLAUDE.md).
export function Thread({
  mensagens,
  temMais,
  carregandoAntigas,
  aoCarregarAntigas,
  aoReenviar,
}: {
  mensagens: Mensagem[];
  temMais: boolean;
  carregandoAntigas: boolean;
  aoCarregarAntigas: () => void;
  aoReenviar?: (m: Mensagem) => void;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const ultimaChave = mensagens.length ? mensagens[mensagens.length - 1].id : "";
  const alturaAntes = useRef(0);
  const primeiraChave = mensagens.length ? mensagens[0].id : "";
  const primeiraAnterior = useRef(primeiraChave);

  const itens = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let diaAtual = "";
    for (let i = 0; i < mensagens.length; i++) {
      const m = mensagens[i];
      const d = chaveDoDia(m.criada_em);
      if (d !== diaAtual) {
        diaAtual = d;
        out.push({ tipo: "dia", chave: `dia-${d}`, rotulo: diaDaMensagem(m.criada_em) });
      }
      const ant = mensagens[i - 1];
      const prox = mensagens[i + 1];
      const mesmoAutor = (a?: Mensagem, b?: Mensagem) =>
        !!a && !!b && (a.enviada_por === "customer") === (b.enviada_por === "customer") && chaveDoDia(a.criada_em) === chaveDoDia(b.criada_em);
      out.push({
        tipo: "msg",
        chave: m.id,
        m,
        primeira: !mesmoAutor(ant, m) || d !== chaveDoDia(ant?.criada_em ?? m.criada_em),
        ultima: !mesmoAutor(m, prox),
      });
    }
    return out;
  }, [mensagens]);

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
            ) : (
              <Bolha m={i.m} primeiraDoGrupo={i.primeira} ultimaDoGrupo={i.ultima} aoReenviar={aoReenviar} />
            )
          }
        />
      )}
      </div>
    </div>
  );
}
