"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LigacaoRtc } from "./webrtcLigacao";
import { explicarErroMicrofone } from "./microfone";

// ---------------------------------------------------------------------------
// LIGACAO NO CHAT -- estado e sinalizacao, sem nenhuma tela.
//
// Estava em `app/chat/ligacao.tsx`, junto com os componentes que a desenham.
// Saiu de la pela regra da frente chat-v2 (spec 0): o chat novo nao importa
// nada de `app/chat/`, e o que estiver preso la se move para `lib/` -- foi o
// caminho de `useVirtualizacao` (`lib/virtualizacao.tsx`). Copiar seria pior:
// duas versoes da maquina de estados de uma chamada divergiriam, e a
// divergencia apareceria como "a campainha tocou num chat e nao no outro".
//
// Aqui nao ha JSX nem cor. As duas telas desenham do seu jeito; a regua de
// quando tocar, o que e uma chamada viva e o que fazer quando ela morre e uma
// so.
//
// ESCOPO: a voz corre pela WhatsApp Business Calling API, no navegador. O
// servidor so faz a sinalizacao (22.2) -- o SDP da outra ponta nao volta na
// resposta HTTP, chega pelo webhook e e anunciado pelo Realtime.
// ---------------------------------------------------------------------------


// O que uma ligação É (tipos, desfechos, formatação) mora em `ligacaoDados`,
// sem React e sem WebRTC — ver o cabeçalho de lá. Reexportado aqui para que
// quem já conduz a chamada não precise importar de dois lugares.
export {
  VIVOS, ligacaoViva, DESFECHOS, duracaoBR, horaBR,
} from "./ligacaoDados";
export type { Ligacao, Chamada } from "./ligacaoDados";

import { VIVOS, type Chamada, type Ligacao } from "./ligacaoDados";

// ---------------------------------------------------------------------------
// Campainha. WebAudio em vez de <audio src>: não exige arquivo no bundle e não
// depende de rede — a campainha tem que tocar mesmo com a conexão ruim que
// costuma ser a causa de a chamada existir.
// ---------------------------------------------------------------------------
function usarCampainha() {
  const ref = useRef<{ ctx: AudioContext; timer: any } | null>(null);

  const parar = useCallback(() => {
    if (!ref.current) return;
    clearInterval(ref.current.timer);
    try { ref.current.ctx.close(); } catch { /* já fechado */ }
    ref.current = null;
  }, []);

  const tocar = useCallback(() => {
    if (ref.current) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const bipe = () => {
        for (const [quando, hz] of [[0, 480], [0.42, 620]] as const) {
          const osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = hz;
          g.gain.setValueAtTime(0.0001, ctx.currentTime + quando);
          g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + quando + 0.04);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + quando + 0.34);
          osc.connect(g).connect(ctx.destination);
          osc.start(ctx.currentTime + quando);
          osc.stop(ctx.currentTime + quando + 0.36);
        }
      };
      bipe();
      ref.current = { ctx, timer: setInterval(bipe, 2400) };
    } catch { /* sem áudio o aviso visual continua de pé */ }
  }, []);

  useEffect(() => parar, [parar]);
  // `tocar` e `parar` são estáveis; devolvê-los soltos (em vez de um objeto novo
  // a cada render) é o que permite usá-los como dependência de efeito sem
  // recriar timers a cada render.
  return { tocar, parar };
}

// ---------------------------------------------------------------------------
// O hook
// ---------------------------------------------------------------------------

export function useLigacao(opts: {
  sessao: { role: string; carteira: string | null } | null;
  aoMudar: () => void;   // recarrega thread/lista quando uma ligação muda de estado
}) {
  const { sessao, aoMudar } = opts;
  const [chamada, setChamada] = useState<Chamada | null>(null);      // a que estou nesta aba
  const [recebida, setRecebida] = useState<Chamada | null>(null);    // tocando, ainda não atendida
  // encerrada, aguardando o vendedor dizer no que deu
  const [desfechoDe, setDesfechoDe] = useState<Chamada | null>(null);
  const [estadoRtc, setEstadoRtc] = useState<string>("novo");
  const [mudo, setMudo] = useState(false);
  const [ocupado, setOcupado] = useState(false);                     // discando/atendendo
  const [erro, setErro] = useState<string | null>(null);
  // conversa cujo cliente ainda nao autorizou ligacao: vira o botao "pedir"
  const [pedirPara, setPedirPara] = useState<{ id: string; nome: string } | null>(null);
  const rtc = useRef<LigacaoRtc | null>(null);
  // desestruturado, e não `const campainha = usarCampainha()`: o objeto seria
  // novo a cada render e, como ele entra nas dependências do efeito de varredura,
  // o intervalo seria destruído e recriado a cada render — uma tempestade de
  // requisições em vez de um tique a cada 4s.
  const { tocar: tocarCampainha, parar: pararCampainha } = usarCampainha();
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;
  // espelhos do estado para os callbacks lerem o valor de AGORA sem virar
  // dependência — o `reagir` não pode se reinscrever no canal a cada render
  const chamadaRef = useRef<Chamada | null>(null); chamadaRef.current = chamada;
  const recebidaRef = useRef<Chamada | null>(null); recebidaRef.current = recebida;
  const pedirParaRef = useRef<{ id: string; nome: string } | null>(null); pedirParaRef.current = pedirPara;

  const soltarRtc = useCallback(() => {
    try { rtc.current?.encerrar(); } catch { /* já encerrado */ }
    rtc.current = null;
    setEstadoRtc("novo");
    setMudo(false);
  }, []);

  // ---- estado de uma chamada, pelo call_id (o broadcast só manda isso) ------
  const buscarEstado = useCallback(async (callId: string): Promise<Chamada | null> => {
    const r = await fetch(`/api/chat/ligacao/acao?call_id=${encodeURIComponent(callId)}`, { cache: "no-store" });
    if (!r.ok) return null;   // 403 = não é minha; 404 = ainda não gravada
    const j = await r.json();
    return { ...j.ligacao, cliente_id: j.cliente.id, cliente_nome: j.cliente.nome };
  }, []);

  // ---- aplica o SDP que veio da outra ponta (o webhook gravou) --------------
  const aplicarSdp = useCallback(async (l: Chamada) => {
    const sdp = (l as any).sdp_remoto as string | null;
    const tipo = (l as any).sdp_tipo as "offer" | "answer" | null;
    if (!sdp || tipo !== "answer" || !rtc.current) return;
    try { await rtc.current.aplicarRemoto(sdp, "answer"); }
    catch (e: any) { setErro(`Falha ao conectar o áudio: ${e?.message ?? e}`); }
  }, []);

  // ---- reagir a uma novidade de chamada ------------------------------------
  const reagir = useCallback(async (callId: string) => {
    const l = await buscarEstado(callId);
    if (!l) return;

    // é a chamada que ESTA aba está conduzindo?
    if (chamadaRef.current?.call_id === callId) {
      if (VIVOS.includes(l.status)) {
        setChamada(l);
        if (l.status === "em_curso") await aplicarSdp(l);
      } else {
        // acabou do outro lado — o caso mais comum, porque quem desliga primeiro
        // costuma ser a cliente. Pergunta o desfecho igual a quando somos nós a
        // desligar; sem isto, a ligação mais comum ficaria sem registro nenhum.
        soltarRtc();
        setChamada(null);
        setDesfechoDe(l);
        aoMudarRef.current();
      }
      return;
    }
    // chamada RECEBIDA tocando: campainha
    if (l.direcao === "entrada" && l.status === "tocando") {
      setRecebida(l);
      tocarCampainha();
      return;
    }
    // a que estava tocando morreu (cliente desistiu, ou outra pessoa atendeu)
    if (recebidaRef.current?.call_id === callId && !VIVOS.includes(l.status)) {
      setRecebida(null);
      pararCampainha();
      aoMudarRef.current();
    }
  }, [buscarEstado, aplicarSdp, soltarRtc, tocarCampainha, pararCampainha]);

  const reagirRef = useRef(reagir); reagirRef.current = reagir;

  // ---- Realtime: a campainha (canal `ligacao`, migration 0087) -------------
  useEffect(() => {
    if (!sessao) return;
    let canal: any = null;
    let cancelado = false;
    (async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) return;
      try {
        const { createBrowserClient } = await import("@supabase/ssr");
        if (cancelado) return;
        canal = createBrowserClient(url, anon)
          .channel("ligacao")
          .on("broadcast", { event: "sinal" }, (msg: any) => {
            const p = msg?.payload?.payload ?? msg?.payload ?? {};
            if (p.call_id) reagirRef.current(String(p.call_id));
          })
          .subscribe();
      } catch { /* sem Realtime o poll abaixo cobre — mais lento, mas cobre */ }
    })();
    return () => { cancelado = true; try { canal?.unsubscribe(); } catch {} };
  }, [sessao]);

  // ---- rede de proteção: varre chamadas vivas ------------------------------
  // O Realtime pode cair, e chamada perdida é pior que board desatualizado: o
  // telefone da cliente toca e ninguém vê. 4s enquanto há chamada viva, 20s em
  // repouso — é uma consulta ao Supabase, não à API da Meta (§15 não se aplica).
  const emChamada = !!chamada || !!recebida;
  useEffect(() => {
    if (!sessao) return;
    let parado = false;
    const varrer = async () => {
      try {
        const r = await fetch("/api/chat/ligacao?ativas=1", { cache: "no-store" });
        if (!r.ok) return;
        const ativas: Ligacao[] = (await r.json())?.ativas ?? [];
        if (parado) return;

        const minha = chamadaRef.current;
        if (minha) {
          const ainda = ativas.find((a) => a.call_id === minha.call_id || a.id === minha.id);
          if (!ainda) {
            // `reagir` cuida do encerramento por inteiro (solta o RTC e pede o
            // desfecho). Delegar evita duas versões da mesma regra — o caminho
            // do Realtime e o da varredura têm de terminar igual.
            if (minha.call_id) await reagirRef.current(minha.call_id);
            else { soltarRtc(); setChamada(null); setDesfechoDe(minha); aoMudarRef.current(); }
          }
        }
        const tocando = ativas.find((a) => a.direcao === "entrada" && a.status === "tocando"
          && a.call_id && a.call_id !== minha?.call_id);
        if (tocando?.call_id && recebidaRef.current?.call_id !== tocando.call_id) {
          reagirRef.current(tocando.call_id);
        } else if (!tocando && recebidaRef.current) {
          setRecebida(null); pararCampainha();
        }
      } catch { /* rede: tenta de novo no próximo tique */ }
    };
    varrer();
    // rápido enquanto há chamada na tela, lento em repouso
    const t = setInterval(varrer, emChamada ? 4000 : 20_000);
    return () => { parado = true; clearInterval(t); };
  }, [sessao, emChamada, soltarRtc, pararCampainha]);

  // ---- AÇÕES ---------------------------------------------------------------

  /** Origina a ligação pela Calling API. Só vale em conversa do piloto. */
  const ligar = useCallback(async (clienteId: string, nome: string) => {
    if (ocupado || chamada) return;
    setErro(null);
    setOcupado(true);
    try {
      if (!LigacaoRtc.suportado()) {
        setErro("Este navegador não permite chamada de voz. Use o Chrome ou o Edge, num endereço https.");
        return;
      }
      const r = new LigacaoRtc(setEstadoRtc);
      rtc.current = r;
      let sdp = "";
      // o microfone é pedido aqui dentro; recusa vira recado em português
      try { sdp = await r.oferta(); }
      catch (e: any) { soltarRtc(); setErro(await explicarErroMicrofone(e)); return; }

      const resp = await fetch("/api/chat/ligacao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, sdp }),
      });
      const j = await resp.json().catch(() => null);
      if (!resp.ok) {
        soltarRtc();
        setErro(j?.error ?? `erro ${resp.status}`);
        // sem autorização: o erro vira uma AÇÃO em vez de um beco sem saída.
        // Guarda de qual cliente é, porque o vendedor pode trocar de conversa
        // antes de clicar — pedir autorização para o contato errado seria pior
        // que não pedir, e a cota é de 1 por dia.
        setPedirPara(j?.semPermissao && j?.permissao?.pode_pedir ? { id: clienteId, nome } : null);
        return;
      }
      setChamada({ ...j.ligacao, cliente_id: clienteId, cliente_nome: nome });
      aoMudarRef.current();
    } finally { setOcupado(false); }
  }, [ocupado, chamada, soltarRtc]);

  /**
   * Envia o cartão de autorização. Caminho que a própria API indica quando não
   * há permissão — e o único, já que ligar para a nossa linha, na prática, não
   * concedeu (verificado em 17/08: três chamadas recebidas e atendidas, e a
   * permissão seguiu `no_permission`).
   */
  const pedirPermissao = useCallback(async () => {
    const alvo = pedirParaRef.current;
    if (!alvo || ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/chat/ligacao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: alvo.id, acao: "pedir_permissao" }),
      });
      const j = await r.json().catch(() => null);
      setPedirPara(null);
      setErro(r.ok
        ? `Pedido enviado para ${alvo.nome}. Assim que ele autorizar, é só ligar.`
        : (j?.error ?? `erro ${r.status}`));
      aoMudarRef.current();   // o cartão enviado aparece na thread
    } finally { setOcupado(false); }
  }, [ocupado]);

  /** Atende a chamada que está tocando. */
  const atender = useCallback(async () => {
    const l = recebidaRef.current;
    if (!l?.call_id || ocupado) return;
    setErro(null);
    setOcupado(true);
    pararCampainha();
    try {
      const oferta = (l as any).sdp_remoto as string | null;
      if (!oferta) { setErro("A chamada chegou sem os dados de áudio. Peça para ligar de novo."); return; }
      if (!LigacaoRtc.suportado()) { setErro("Este navegador não permite atender por aqui."); return; }

      const r = new LigacaoRtc(setEstadoRtc);
      rtc.current = r;
      let resposta = "";
      try { resposta = await r.resposta(oferta); }
      catch (e: any) { soltarRtc(); setErro(await explicarErroMicrofone(e)); return; }

      const resp = await fetch("/api/chat/ligacao/acao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "atender", call_id: l.call_id, sdp: resposta }),
      });
      const j = await resp.json().catch(() => null);
      if (!resp.ok) { soltarRtc(); setErro(j?.error ?? `erro ${resp.status}`); return; }

      setRecebida(null);
      setChamada({ ...j.ligacao, cliente_id: l.cliente_id, cliente_nome: l.cliente_nome });
      aoMudarRef.current();
    } finally { setOcupado(false); }
  }, [ocupado, pararCampainha, soltarRtc]);

  const recusar = useCallback(async () => {
    const l = recebidaRef.current;
    if (!l?.call_id) return;
    pararCampainha();
    setRecebida(null);
    await fetch("/api/chat/ligacao/acao", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "recusar", call_id: l.call_id }),
    }).catch(() => null);
    aoMudarRef.current();
  }, [pararCampainha]);

  /**
   * Desliga: manda `terminate` para a Meta e fecha o registro. Se a Meta recusar
   * (a chamada já caiu do outro lado), a rota fecha o registro assim mesmo — senão
   * a barra de chamada nunca sairia da tela.
   */
  const desligar = useCallback(async () => {
    const l = chamadaRef.current;
    if (!l) return;
    soltarRtc();
    const encerrada = l.call_id
      ? await fetch("/api/chat/ligacao/acao", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao: "desligar", call_id: l.call_id }),
        }).then((r) => r.json()).catch(() => null)
      : await fetch("/api/chat/ligacao", {   // ainda sem call_id: a Meta não respondeu
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: l.id }),
        }).then((r) => r.json()).catch(() => null);
    // some da barra, mas continua na tela como "no que deu?" — é o dado que
    // transforma a ligação em informação (ver DESFECHOS)
    setChamada(null);
    setDesfechoDe(encerrada?.ligacao ? { ...encerrada.ligacao, cliente_id: l.cliente_id, cliente_nome: l.cliente_nome } : l);
    aoMudarRef.current();
  }, [soltarRtc]);

  const salvarDesfecho = useCallback(async (motivo: string | null, observacao: string) => {
    const l = desfechoDe;
    setDesfechoDe(null);
    if (!l || (!motivo && !observacao.trim())) return;
    await fetch("/api/chat/ligacao", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: l.id, motivo, observacao }),
    }).catch(() => null);
    aoMudarRef.current();
  }, [desfechoDe]);

  const alternarMudo = useCallback(() => {
    if (!rtc.current) return;
    const novo = !mudo;
    rtc.current.mudo(novo);
    setMudo(novo);
  }, [mudo]);

  // a aba não pode ser fechada com o microfone aberto
  useEffect(() => () => { try { rtc.current?.encerrar(); } catch {} }, []);

  return {
    chamada, recebida, desfechoDe, estadoRtc, mudo, ocupado, erro, pedirPara,
    ligar, atender, recusar, desligar, salvarDesfecho, alternarMudo, pedirPermissao,
    limparErro: () => { setErro(null); setPedirPara(null); },
  };
}
