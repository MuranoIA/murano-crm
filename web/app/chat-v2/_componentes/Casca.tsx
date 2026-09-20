"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListaConversas } from "./ListaConversas";
import { Conversa as TelaConversa } from "./Conversa";
import { PainelContato } from "./PainelContato";
import { Ripple } from "./Ripple";
import type { Conversa, Fila, Lista, Mensagem, Thread } from "./tipos";

// ---------------------------------------------------------------------------
// A casca: três regiões, uma escolha de fila, uma conversa aberta.
//
// LAYOUT É CSS, NÃO JAVASCRIPT. O chat antigo decide com `window.innerWidth`,
// e por isso a lupa do board (um iframe de 500 px) e o celular acabam no mesmo
// ramo por acidente. Aqui as três regiões são `flex` com pontos de corte do
// Tailwind: dentro do iframe do hub ou da lupa, a media query responde à
// largura DAQUELE quadro, e o layout se adapta sozinho.
//
// O único uso de estado para layout é "tem conversa aberta?" — que é estado de
// navegação, não de tamanho de tela.
// ---------------------------------------------------------------------------

export function Casca({ inicial, threadInicial }: { inicial: Lista; threadInicial: Thread | null }) {
  const [lista, setLista] = useState<Conversa[]>(inicial.conversas);
  const [completa, setCompleta] = useState(!inicial.tem_mais);
  const [carregandoLista, setCarregandoLista] = useState(false);

  const [fila, setFila] = useState<Fila>("todas");
  const [busca, setBusca] = useState("");

  const [aberta, setAberta] = useState<string | null>(threadInicial?.cliente_id ?? null);
  const [mensagens, setMensagens] = useState<Mensagem[]>(threadInicial?.mensagens ?? []);
  const [temMais, setTemMais] = useState(!!threadInicial?.tem_mais);
  const [carregandoThread, setCarregandoThread] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [painelAberto, setPainelAberto] = useState(false);

  // qual conversa está na tela AGORA, lido no momento em que a resposta chega.
  // É a guarda da §70: sem ela, a thread da cliente A aparece dentro da B.
  const abertaRef = useRef<string | null>(aberta);
  useEffect(() => {
    abertaRef.current = aberta;
  }, [aberta]);

  // ---- o resto da lista, SÓ QUANDO PRECISA -------------------------------
  //
  // A primeira página (60 conversas) já veio no HTML, e os contadores dos chips
  // vieram calculados no servidor sobre a lista inteira — então a tela abre
  // completa sem baixar tudo.
  //
  // ⚠️ A primeira versão puxava a lista inteira em segundo plano, sempre: a
  // pintura melhorou (7,4 s → 1 s) mas a sessão continuava custando 2,7 MB,
  // medidos. As 4 mil conversas só são necessárias para buscar, filtrar por
  // outro recorte ou rolar até o fim — e é nesses três momentos que elas vêm.
  const [precisaCompleta, setPrecisaCompleta] = useState(false);
  const [contagensServidor, setContagensServidor] = useState<Record<string, number> | null>(null);

  // os contadores dos chips: pedidos DEPOIS da pintura, porque contar varre as
  // ~4 mil conversas. Enquanto não chegam, o chip aparece sem número — nunca
  // com zero, que seria mentira.
  useEffect(() => {
    let vivo = true;
    fetch("/api/chat-v2/contagens")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => vivo && setContagensServidor(j))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (completa || !precisaCompleta) return;
    let vivo = true;
    setCarregandoLista(true);
    fetch("/api/chat-v2/lista")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`lista: ${r.status}`))))
      .then((j: Lista) => {
        if (!vivo) return;
        setLista(j.conversas);
        setCompleta(true);
      })
      .catch(() => {
        /* fica com a primeira página: degradar é melhor que tela vazia */
      })
      .finally(() => vivo && setCarregandoLista(false));
    return () => {
      vivo = false;
    };
  }, [completa, precisaCompleta]);

  // ---- abrir uma conversa -------------------------------------------------
  const abrir = useCallback((id: string) => {
    setAberta(id);
    abertaRef.current = id; // antes do render: a guarda precisa valer já
    setMensagens([]);
    setTemMais(false);
    setCarregandoThread(true);
    // a conversa aberta mora na URL: o voltar do navegador funciona, o F5
    // mantém a tela, e o link do board continua valendo (§64.4)
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("cliente", id);
      window.history.replaceState(null, "", u);
    } catch {}

    fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`thread: ${r.status}`))))
      .then((j) => {
        if (abertaRef.current !== id) return; // trocou de conversa no meio
        setMensagens(j.mensagens ?? []);
        setTemMais(!!j.tem_mais);
      })
      .catch(() => abertaRef.current === id && setMensagens([]))
      .finally(() => abertaRef.current === id && setCarregandoThread(false));
  }, []);

  const fechar = useCallback(() => {
    setAberta(null);
    abertaRef.current = null;
    setMensagens([]);
    setPainelAberto(false);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("cliente");
      window.history.replaceState(null, "", u);
    } catch {}
  }, []);

  const carregarAntigas = useCallback(() => {
    const id = abertaRef.current;
    if (!id || !mensagens.length) return;
    setCarregandoAntigas(true);
    const cursor = mensagens[0].criada_em;
    fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(id)}&antes=${encodeURIComponent(cursor)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`antes: ${r.status}`))))
      .then((j) => {
        if (abertaRef.current !== id) return;
        setMensagens((atual) => [...(j.mensagens ?? []), ...atual]);
        setTemMais(!!j.tem_mais);
      })
      .catch(() => {})
      .finally(() => abertaRef.current === id && setCarregandoAntigas(false));
  }, [mensagens]);

  // ---- recortes e contadores ---------------------------------------------
  // Com a lista inteira em mãos, conta daqui (é de graça e fica exato mesmo
  // depois de a tela mexer em alguma conversa). Sem ela, valem os números que o
  // servidor calculou sobre tudo — nunca os da primeira página, que diriam
  // "3 não lidas" quando há 17.
  const contagens = useMemo<Record<Fila, number | null>>(() => {
    if (!completa) {
      const s = contagensServidor;
      return {
        todas: s ? s.todas : null,
        nao_lidas: s ? s.nao_lidas : null,
        favoritas: s ? s.favoritas : null,
        fila: s ? s.fila : null,
        resolvidas: s ? s.resolvidas : null,
      };
    }
    return {
      todas: lista.filter((c) => !c.na_fila && c.status !== "resolvida").length,
      nao_lidas: lista.filter((c) => c.nao_lida && !c.na_fila && c.status !== "resolvida").length,
      favoritas: lista.filter((c) => c.favorita).length,
      fila: lista.filter((c) => c.na_fila).length,
      resolvidas: lista.filter((c) => c.status === "resolvida").length,
    };
  }, [lista, completa, contagensServidor]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const so = t.replace(/\D/g, "");
    return lista.filter((c) => {
      const passaFila =
        fila === "todas"
          ? !c.na_fila && c.status !== "resolvida"
          : fila === "nao_lidas"
            ? c.nao_lida && !c.na_fila && c.status !== "resolvida"
            : fila === "favoritas"
              ? c.favorita
              : fila === "fila"
                ? c.na_fila
                : c.status === "resolvida";
      if (!passaFila) return false;
      if (!t) return true;
      const nome = String(c.cliente ?? "").toLowerCase();
      const tel = String(c.telefone ?? "").replace(/\D/g, "");
      return nome.includes(t) || (so.length >= 3 && tel.includes(so));
    });
  }, [lista, fila, busca]);

  const conversaAberta = useMemo(() => lista.find((c) => c.cliente_id === aberta) ?? null, [lista, aberta]);

  return (
    <div className="v2 flex h-dvh min-h-0 flex-col overflow-hidden">
      <Ripple />

      {/* ---- app bar ------------------------------------------------------ */}
      <header className="flex shrink-0 items-center gap-3 bg-v2-vinho px-3 text-white shadow-e2 pt-[env(safe-area-inset-top)]">
        <div className="flex h-12 items-center gap-3">
          <a
            href="/"
            data-ripple
            className="grid size-9 place-items-center rounded-full text-white/90 hover:bg-white/10"
            aria-label="Voltar ao board"
            title="Board"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="m14 6-6 6 6 6" />
            </svg>
          </a>
          <span className="text-[15px] font-semibold tracking-tight">Chat</span>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            v2 · fase 1
          </span>
        </div>
        <span className="ml-auto truncate text-[12px] text-white/80">
          {inicial.minha_carteira ? `carteira ${inicial.minha_carteira}` : inicial.meu_usuario}
        </span>
      </header>

      {/* ---- as três regiões ---------------------------------------------- */}
      <div className="flex min-h-0 flex-1">
        <div
          className={[
            "min-h-0 w-full shrink-0 border-r border-v2-linha md:w-[320px] lg:w-[344px]",
            aberta ? "hidden md:block" : "block",
          ].join(" ")}
        >
          <ListaConversas
            conversas={visiveis}
            selecionada={aberta}
            fila={fila}
            busca={busca}
            carregando={carregandoLista}
            completa={completa}
            contagens={contagens}
            aoAbrir={abrir}
            // os três gestos que exigem a lista inteira. Fora deles, a sessão
            // custa a primeira página e mais nada.
            aoTrocarFila={(f) => {
              setFila(f);
              if (f !== "todas") setPrecisaCompleta(true);
            }}
            aoBuscar={(t) => {
              setBusca(t);
              if (t.trim().length >= 2) setPrecisaCompleta(true);
            }}
            aoChegarNoFim={() => setPrecisaCompleta(true)}
          />
        </div>

        <div className={["min-h-0 min-w-0 flex-1", aberta ? "block" : "hidden md:block"].join(" ")}>
          <TelaConversa
            conversa={conversaAberta}
            mensagens={mensagens}
            temMais={temMais}
            carregando={carregandoThread}
            carregandoAntigas={carregandoAntigas}
            aoCarregarAntigas={carregarAntigas}
            aoVoltar={fechar}
            aoAbrirContato={() => setPainelAberto((v) => !v)}
            painelAberto={painelAberto}
          />
        </div>

        {/* desktop largo: o ERP é COLUNA, ao lado da conversa */}
        {conversaAberta && painelAberto && (
          <div className="hidden min-h-0 w-[330px] shrink-0 xl:block">
            <PainelContato conversa={conversaAberta} aoFechar={() => setPainelAberto(false)} />
          </div>
        )}
      </div>

      {/* celular e telas médias: o mesmo painel sobe de baixo. No chat antigo
          ele simplesmente não existe abaixo de 768 px — e é o diferencial
          contra o RD (achado 3 do laudo de UX). */}
      {conversaAberta && painelAberto && (
        <div className="fixed inset-0 z-20 flex flex-col justify-end bg-black/30 xl:hidden" onClick={() => setPainelAberto(false)}>
          <div
            className="entrar max-h-[82%] overflow-hidden rounded-t-3xl bg-v2-superficie shadow-e3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-v2-linha-forte" />
            </div>
            <div className="h-[72vh]">
              <PainelContato conversa={conversaAberta} aoFechar={() => setPainelAberto(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
