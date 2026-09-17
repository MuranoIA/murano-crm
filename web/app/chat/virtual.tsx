"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// -----------------------------------------------------------------------------
// Virtualização de lista — desenha só o que cabe na tela (+ uma margem), não
// todo o array. Medido em produção (17/09/2026): uma aba do chat aberta havia
// acumulado 43.788 nós de DOM, e o notebook padrão da equipe (2 núcleos, 8GB)
// travou por completo por causa disso — Runtime.evaluate não respondia nem a
// `1` por 45s. Este arquivo é a peça reaproveitável para as duas telas que
// mais pesam: a lista de conversas e a thread de mensagens.
//
// Por que ALTURA MEDIDA e não altura fixa: as linhas da lista hoje usam
// `minHeight` (nome comprido/selo extra empurram para duas linhas) e as
// bolhas da thread variam muito mais (mídia, citação, texto longo). Forçar
// altura fixa quebraria conteúdo real. Cada item é medido de verdade na
// primeira vez que é desenhado (e de novo se o tamanho mudar — ex.: uma
// imagem que termina de carregar), e o que ainda não foi medido usa a altura
// estimada só para calcular a posição de rolagem — nunca aparece na tela.
// -----------------------------------------------------------------------------

export type AlcanceVirtual = { inicio: number; fim: number };

interface OpcoesVirtual<T> {
  itens: T[];
  chave: (item: T, indice: number) => string;
  /** ref do CONTAINER que rola (`overflowY: auto`) — não do item. */
  raizRef: React.RefObject<HTMLElement>;
  /** chute inicial de altura em px, só para o que ainda não foi medido. */
  alturaEstimada: number;
  /** quanto renderizar além do que está visível, em px (evita "piscar" ao rolar rápido). */
  overscanPx?: number;
  /**
   * chaves que precisam estar no DOM MESMO fora da janela visível — ex.: a
   * mensagem-alvo de um "ir até aqui" (citação, busca), que usa
   * `document.querySelector('[data-msg=...]')` e só acha o que está montado.
   */
  forcarChaves?: Set<string>;
  /**
   * desliga a virtualização (renderiza tudo). Serve para listas pequenas —
   * abaixo de um teto não vale o custo de medir — e como saída de emergência.
   */
  ativo?: boolean;
}

function buscarIndice(offsets: Float64Array, alvo: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (offsets[meio] < alvo) lo = meio + 1;
    else hi = meio;
  }
  return Math.max(0, lo - 1);
}

export function useVirtualizacao<T>(opts: OpcoesVirtual<T>) {
  const { itens, chave, raizRef, alturaEstimada, overscanPx = 600, forcarChaves, ativo = true } = opts;

  const alturasRef = useRef<Map<string, number>>(new Map());
  const observadoresRef = useRef<Map<string, ResizeObserver>>(new Map());
  const refCacheRef = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());
  const [versaoAlturas, setVersaoAlturas] = useState(0);
  const [alcance, setAlcance] = useState<AlcanceVirtual>({ inicio: 0, fim: Math.min(itens.length, 40) });

  const chaves = useMemo(() => itens.map((it, i) => chave(it, i)), [itens, chave]);

  // Ao trocar de lista (ex.: abrir outra conversa), o que sobrou de outra
  // thread não pode contaminar a medida desta — chaves são só o id, e dois
  // clientes diferentes não repetem id de mensagem, mas a limpeza evita o
  // mapa crescer para sempre numa sessão que fica aberta o dia inteiro.
  useEffect(() => {
    const vivos = new Set(chaves);
    for (const k of Array.from(alturasRef.current.keys())) {
      if (!vivos.has(k)) alturasRef.current.delete(k);
    }
  }, [chaves]);

  const offsets = useMemo(() => {
    const arr = new Float64Array(chaves.length + 1);
    for (let i = 0; i < chaves.length; i++) {
      const h = alturasRef.current.get(chaves[i]) ?? alturaEstimada;
      arr[i + 1] = arr[i] + h;
    }
    return arr;
    // versaoAlturas força recalcular quando uma medida real muda — o mapa é
    // ref e não dispara re-render sozinho.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaves, alturaEstimada, versaoAlturas]);

  const total = offsets.length ? offsets[offsets.length - 1] : 0;

  const recalcular = useCallback(() => {
    if (!ativo) return;
    const raiz = raizRef.current;
    if (!raiz) return;
    const topo = Math.max(0, raiz.scrollTop - overscanPx);
    const base = raiz.scrollTop + raiz.clientHeight + overscanPx;
    const ini = buscarIndice(offsets, topo);
    const fim = Math.min(itens.length, buscarIndice(offsets, base) + 1);
    setAlcance((atual) => (atual.inicio === ini && atual.fim === fim ? atual : { inicio: ini, fim }));
  }, [offsets, itens.length, overscanPx, raizRef, ativo]);

  useEffect(() => {
    recalcular();
  }, [recalcular]);

  useEffect(() => {
    const raiz = raizRef.current;
    if (!raiz || !ativo) return;
    let pendente = false;
    const aoMudar = () => {
      if (pendente) return;
      pendente = true;
      requestAnimationFrame(() => {
        pendente = false;
        recalcular();
      });
    };
    raiz.addEventListener("scroll", aoMudar, { passive: true });
    // o próprio container pode mudar de altura (ex.: o compositor cresce e
    // encolhe a área da thread) — sem isto a janela ficaria com o cálculo
    // velho até a próxima rolagem.
    const ro = new ResizeObserver(aoMudar);
    ro.observe(raiz);
    return () => {
      raiz.removeEventListener("scroll", aoMudar);
      ro.disconnect();
    };
  }, [raizRef, recalcular, ativo]);

  // O alcance calculado pela rolagem some com quem está fora da tela; as
  // chaves forçadas (citação, "ir até aqui") entram por fora dele.
  const alcanceEfetivo = useMemo(() => {
    if (!forcarChaves || !forcarChaves.size) return alcance;
    let ini = alcance.inicio;
    let fim = alcance.fim;
    for (let i = 0; i < chaves.length; i++) {
      if (forcarChaves.has(chaves[i])) {
        if (i < ini) ini = i;
        if (i + 1 > fim) fim = i + 1;
      }
    }
    return ini === alcance.inicio && fim === alcance.fim ? alcance : { inicio: ini, fim };
  }, [alcance, forcarChaves, chaves]);

  const medirElemento = useCallback((k: string, el: HTMLElement) => {
    const h = el.getBoundingClientRect().height;
    const atual = alturasRef.current.get(k);
    // margem de 1px: layout sub-pixel do navegador muda o valor por nada,
    // e sem a margem isso reentraria em loop de medir->renderizar->medir.
    if (h > 0 && (atual === undefined || Math.abs(atual - h) > 1)) {
      alturasRef.current.set(k, h);
      setVersaoAlturas((v) => v + 1);
    }
  }, []);

  // Uma função ESTÁVEL por chave: se `medir(k)` devolvesse uma closure nova
  // a cada render, o React desmontaria e remontaria o ResizeObserver de toda
  // linha visível a cada render — exatamente o desperdício de CPU que esta
  // peça existe para evitar.
  const medir = useCallback(
    (k: string) => {
      const cache = refCacheRef.current;
      let fn = cache.get(k);
      if (!fn) {
        fn = (el: HTMLElement | null) => {
          const observadores = observadoresRef.current;
          const existente = observadores.get(k);
          if (!el) {
            existente?.disconnect();
            observadores.delete(k);
            cache.delete(k);
            return;
          }
          medirElemento(k, el);
          if (!existente) {
            const ro = new ResizeObserver(() => medirElemento(k, el));
            ro.observe(el);
            observadores.set(k, ro);
          }
        };
        cache.set(k, fn);
      }
      return fn;
    },
    [medirElemento],
  );

  return {
    alcance: ativo ? alcanceEfetivo : { inicio: 0, fim: itens.length },
    paddingTopo: ativo ? offsets[alcanceEfetivo.inicio] ?? 0 : 0,
    paddingBase: ativo ? Math.max(0, total - (offsets[alcanceEfetivo.fim] ?? total)) : 0,
    medir,
    total,
  };
}

/**
 * Wrapper pronto para o caso simples: uma lista plana, um item = uma linha
 * (a lista de conversas usa isto direto). A thread tem estrutura própria
 * (dia + item) e usa `useVirtualizacao` direto — ver nota de integração.
 */
export function JanelaVirtual<T>({
  itens,
  chave,
  raizRef,
  alturaEstimada,
  overscanPx,
  ativo,
  renderItem,
}: OpcoesVirtual<T> & { renderItem: (item: T, indice: number) => React.ReactNode }) {
  const virt = useVirtualizacao({ itens, chave, raizRef, alturaEstimada, overscanPx, ativo });
  return (
    <>
      {virt.paddingTopo > 0 && <div style={{ height: virt.paddingTopo, flexShrink: 0 }} aria-hidden />}
      {itens.slice(virt.alcance.inicio, virt.alcance.fim).map((item, i) => {
        const indice = virt.alcance.inicio + i;
        const k = chave(item, indice);
        return (
          <div key={k} ref={virt.medir(k)}>
            {renderItem(item, indice)}
          </div>
        );
      })}
      {virt.paddingBase > 0 && <div style={{ height: virt.paddingBase, flexShrink: 0 }} aria-hidden />}
    </>
  );
}
