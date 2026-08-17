"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LigacaoRtc, explicarErroMicrofone } from "../../lib/webrtcLigacao";

// ---------------------------------------------------------------------------
// LIGAÇÃO NO CHAT — estado, sinalização e telas.
//
// Mora fora de page.tsx de propósito: a tela do chat já passa de 1.500 linhas e
// é mexida por mais de uma frente ao mesmo tempo. Aqui a ligação fica inteira
// num arquivo só, e o chat encosta nela por três pontos (o hook, a barra e o
// marco na thread).
//
// ESCOPO: só o piloto. A voz corre pela WhatsApp Business Calling API, no
// navegador, e por isso existe apenas onde a conversa já está na Cloud API — hoje
// a linha piloto. Em conversa do RD o botão nem aparece (decisão do usuário em
// 17/08/2026: nada de ligação por RD ou amarrada a ele).
// ---------------------------------------------------------------------------

const M = {
  wine: "#621244", roxo: "#7b2d8b", roxoSoft: "#f1e6f4", azul: "#1a5fa8",
  laranja: "#dd4222", verde: "#1a6b3c", verdeSoft: "#eaf5ee",
  bg: "#f5edf4", surface: "#ffffff", border: "#e0cfdb",
  ink: "#241327", muted: "#9a8098", gray: "#6f5c6d",
};

export type Ligacao = {
  id: number; canal: "whatsapp"; direcao: "saida" | "entrada";
  status: string; call_id: string | null; carteira: string | null; por: string | null;
  telefone?: string | null;
  iniciada_em: string; atendida_em: string | null; encerrada_em: string | null;
  duracao_seg: number | null; motivo: string | null; observacao: string | null;
  cliente_id?: string;
};

const VIVOS = ["discando", "tocando", "em_curso"];
export const ligacaoViva = (l: Ligacao | null | undefined) => !!l && VIVOS.includes(l.status);

// Desfecho da ligação — a nossa tabulação por voz. Espelha os motivos de
// encerramento da conversa (§18 item 4) porque a pergunta é a mesma: no que deu?
export const DESFECHOS: { v: string; rotulo: string }[] = [
  { v: "venda_realizada", rotulo: "✅ Venda realizada" },
  { v: "follow_up", rotulo: "🕗 Follow-up agendado" },
  { v: "sem_interesse", rotulo: "🚫 Sem interesse" },
  { v: "nao_atendeu", rotulo: "📵 Não atendeu" },
  { v: "caixa_postal", rotulo: "📼 Caixa postal" },
  { v: "outro", rotulo: "• Outro" },
];

const duracaoBR = (seg: number | null | undefined) => {
  if (seg == null) return null;
  const m = Math.floor(seg / 60), s = seg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};
const horaBR = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);

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
export type Chamada = Ligacao & { cliente_id: string; cliente_nome?: string };

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
      catch (e: any) { soltarRtc(); setErro(explicarErroMicrofone(e)); return; }

      const resp = await fetch("/api/chat/ligacao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, sdp }),
      });
      const j = await resp.json().catch(() => null);
      if (!resp.ok) {
        soltarRtc();
        setErro(j?.error ?? `erro ${resp.status}`);
        return;
      }
      setChamada({ ...j.ligacao, cliente_id: clienteId, cliente_nome: nome });
      aoMudarRef.current();
    } finally { setOcupado(false); }
  }, [ocupado, chamada, soltarRtc]);

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
      catch (e: any) { soltarRtc(); setErro(explicarErroMicrofone(e)); return; }

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
    chamada, recebida, desfechoDe, estadoRtc, mudo, ocupado, erro,
    ligar, atender, recusar, desligar, salvarDesfecho, alternarMudo,
    limparErro: () => setErro(null),
  };
}

// ---------------------------------------------------------------------------
// Botão 📞 do cabeçalho
//
// `naCloud` é o que restringe a ligação ao piloto: em conversa que ainda corre
// pelo RD o botão simplesmente NÃO EXISTE. Botão desabilitado com explicação
// seria pior — convida a clicar e ensina que o sistema não funciona. Quem manda
// de verdade é o servidor, que barra a chamada de qualquer jeito.
// ---------------------------------------------------------------------------
export function BotaoLigar({ onLigar, ocupado, emChamada, temTelefone, naCloud }: {
  onLigar: () => void;
  ocupado: boolean; emChamada: boolean; temTelefone: boolean; naCloud: boolean;
}) {
  if (!temTelefone || !naCloud) return null;

  const travado = ocupado || emChamada;
  return (
    <button onClick={onLigar} disabled={travado}
      title={emChamada ? "já há uma ligação em andamento" : "Ligar para o cliente pelo WhatsApp"}
      style={{ fontSize: 11.5, fontWeight: 700, color: M.verde, background: M.verdeSoft,
        border: "1px solid #bfe0cb", borderRadius: 999, padding: "5px 11px",
        cursor: travado ? "default" : "pointer", opacity: travado ? 0.55 : 1,
        fontFamily: "inherit", whiteSpace: "nowrap" }}>
      {ocupado ? "…" : "📞 Ligar"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Barra da chamada em curso — fixa no rodapé, some ao desligar
// ---------------------------------------------------------------------------
export function BarraChamada({ c, estadoRtc, mudo, onMudo, onDesligar }: {
  c: Chamada; estadoRtc: string; mudo: boolean;
  onMudo: () => void; onDesligar: () => void;
}) {
  const [seg, setSeg] = useState(0);
  useEffect(() => {
    const calc = () => setSeg(c.atendida_em
      ? Math.max(0, Math.round((Date.now() - new Date(c.atendida_em).getTime()) / 1000)) : 0);
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [c.atendida_em]);

  const rotulo = c.status === "discando" ? "Chamando…"
    : c.status === "tocando" ? "Tocando no aparelho do cliente…"
    : estadoRtc === "conectado" ? "Em conversa"
    : estadoRtc === "caiu" ? "Conexão instável…"
    : "Conectando o áudio…";

  return (
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60,
      background: M.wine, color: "#fff", padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      boxShadow: "0 -4px 16px rgba(28,14,27,0.28)" }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
        background: estadoRtc === "conectado" ? "#5cd68a" : "#ffce4f" }} />
      <span style={{ fontSize: 13, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {c.cliente_nome ?? "Cliente"}
      </span>
      <span style={{ fontSize: 11.5, opacity: 0.82 }}>{rotulo}</span>
      {c.atendida_em && (
        <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", opacity: 0.95 }}>
          {duracaoBR(seg)}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <button onClick={onMudo} title={mudo ? "Reativar o microfone" : "Desativar o microfone"}
          style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: mudo ? M.laranja : "rgba(255,255,255,0.16)",
            border: "1px solid rgba(255,255,255,0.3)", borderRadius: 999, padding: "5px 13px", cursor: "pointer", fontFamily: "inherit" }}>
        {mudo ? "🔇 Mudo" : "🎤 Microfone"}
      </button>
      <button onClick={onDesligar}
        style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: M.laranja, border: "none",
          borderRadius: 999, padding: "7px 17px", cursor: "pointer", fontFamily: "inherit" }}>
        📵 Desligar
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chamada recebida — o cliente está ligando
// ---------------------------------------------------------------------------
export function ChamadaRecebida({ c, ocupado, onAtender, onRecusar }: {
  c: Chamada; ocupado: boolean; onAtender: () => void; onRecusar: () => void;
}) {
  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 70, width: 300,
      background: M.surface, border: `2px solid ${M.verde}`, borderRadius: 14,
      boxShadow: "0 12px 34px rgba(28,14,27,0.26)", padding: 15 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", color: M.verde, marginBottom: 5 }}>
        📞 Chamada recebida
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: M.wine, lineHeight: 1.3, marginBottom: 2 }}>
        {c.cliente_nome ?? c.telefone ?? "Cliente"}
      </div>
      <div style={{ fontSize: 11, color: M.gray, marginBottom: 12 }}>
        está ligando pelo WhatsApp
        {!c.carteira && <b style={{ color: M.laranja }}> · sem dono, na fila</b>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onAtender} disabled={ocupado}
          style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#fff", background: M.verde, border: "none",
            borderRadius: 999, padding: "9px 0", cursor: ocupado ? "default" : "pointer", opacity: ocupado ? 0.6 : 1, fontFamily: "inherit" }}>
          {ocupado ? "…" : "Atender"}
        </button>
        <button onClick={onRecusar} disabled={ocupado}
          style={{ flex: 1, fontSize: 13, fontWeight: 700, color: M.laranja, background: "#fdeae3",
            border: "1px solid #f0c4b0", borderRadius: 999, padding: "9px 0", cursor: "pointer", fontFamily: "inherit" }}>
          Recusar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "No que deu?" — aparece assim que a chamada termina
// ---------------------------------------------------------------------------
export function DesfechoLigacao({ c, onSalvar }: {
  c: Chamada; onSalvar: (motivo: string | null, observacao: string) => void;
}) {
  const [obs, setObs] = useState("");
  const [motivo, setMotivo] = useState<string | null>(null);

  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 65, width: 316,
      background: M.surface, border: `1px solid ${M.border}`, borderRadius: 13,
      boxShadow: "0 10px 30px rgba(28,14,27,0.2)", padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: M.wine, marginBottom: 3 }}>
        Ligação encerrada
      </div>
      <div style={{ fontSize: 11.5, color: M.gray, marginBottom: 9, lineHeight: 1.4 }}>
        {c.cliente_nome ?? "Cliente"}
        {c.duracao_seg != null && <> · falou {duracaoBR(c.duracao_seg)}</>} — no que deu?
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
        {DESFECHOS.map((d) => (
          <button key={d.v} onClick={() => setMotivo(motivo === d.v ? null : d.v)}
            style={{ fontSize: 11.5, fontWeight: 600, color: motivo === d.v ? "#fff" : M.ink,
              background: motivo === d.v ? M.roxo : M.surface,
              border: `1px solid ${motivo === d.v ? M.roxo : M.border}`,
              borderRadius: 999, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit" }}>
            {d.rotulo}
          </button>
        ))}
      </div>
      <input value={obs} onChange={(e) => setObs(e.target.value)}
        placeholder="Observação (opcional) — fica na conversa"
        style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12, fontFamily: "inherit",
          color: M.ink, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 8, outline: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <button onClick={() => onSalvar(motivo, obs)}
          style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: M.roxo, border: "none",
            borderRadius: 999, padding: "7px 16px", cursor: "pointer", fontFamily: "inherit" }}>
          Salvar
        </button>
        <button onClick={() => onSalvar(null, "")}
          style={{ fontSize: 12, color: M.gray, background: "transparent", border: "none", padding: "6px 4px", cursor: "pointer", fontFamily: "inherit" }}>
          agora não
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marco na thread — a ligação no ponto em que aconteceu, como a transferência
// ---------------------------------------------------------------------------
export function MarcoLigacao({ l }: { l: Ligacao }) {
  const entrada = l.direcao === "entrada";
  const ok = l.status === "concluida";
  const perdida = ["nao_atendida", "recusada", "falhou", "cancelada"].includes(l.status);
  const viva = VIVOS.includes(l.status);

  const cor = viva ? M.verde : perdida ? M.laranja : M.gray;
  const fundo = viva ? M.verdeSoft : perdida ? "#fdeae3" : M.surface;
  const borda = viva ? "#bfe0cb" : perdida ? "#f0c4b0" : M.border;

  const titulo = viva
    ? (entrada ? "Chamada recebida — em andamento" : "Ligação em andamento")
    : entrada
      ? (ok ? "Chamada recebida" : l.status === "recusada" ? "Chamada recusada" : "Chamada perdida")
      : (ok ? "Ligação feita" : l.status === "nao_atendida" ? "Não atendeu" : l.status === "falhou" ? "Ligação falhou" : "Ligação cancelada");

  const desfecho = DESFECHOS.find((d) => d.v === l.motivo)?.rotulo;

  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "6px 0" }}>
      <div style={{ maxWidth: "80%", textAlign: "center", fontSize: 11, color: cor, background: fundo,
        border: `1px solid ${borda}`, borderRadius: 999, padding: "4px 15px", lineHeight: 1.5 }}>
        {entrada ? "📲" : "📞"} <b>{titulo}</b>
        {l.duracao_seg != null && <span style={{ opacity: 0.8 }}> · {duracaoBR(l.duracao_seg)}</span>}
        <span style={{ opacity: 0.7 }}> · {horaBR(l.iniciada_em)}</span>
        {desfecho && <div style={{ fontWeight: 700, marginTop: 1 }}>{desfecho}</div>}
        {l.observacao && <div style={{ fontStyle: "italic", opacity: 0.85, marginTop: 1 }}>“{l.observacao}”</div>}
      </div>
    </div>
  );
}
