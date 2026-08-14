"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// CHAT — ambiente de conversa estilo RD Conversas, layout inspirado no WhatsApp
// Web, identidade visual Murano (skill murano-brand). Paleta desta tela:
//   púrpura #7b2d8b  -> botões e ações (preferência sobre o laranja)
//   vinho   #621244  -> títulos, nomes, acentos de marca
//   azul    #1a5fa8  -> ticks de "lida" e links (pitada de azul do dev)
//   laranja #dd4222  -> COM MODERAÇÃO: só avisos (fora da janela) e falha
// ---------------------------------------------------------------------------
const M = {
  dark: "#1c0e1b",
  wine: "#621244",
  roxo: "#7b2d8b",
  roxoSoft: "#f1e6f4",
  azul: "#1a5fa8",
  laranja: "#dd4222",
  blush: "#e4d4d3",
  bg: "#f5edf4",
  bgThread: "#efe3ec",
  surface: "#ffffff",
  border: "#e0cfdb",
  ink: "#241327",
  muted: "#9a8098",
  gray: "#6f5c6d",
  bolhaFora: "#ecdcf0",   // mensagem enviada (operator) — púrpura bem claro
  bolhaDentro: "#ffffff", // mensagem recebida (customer)
};

type Conversa = {
  cliente_id: string; cliente: string; vendedor: string | null; etapa: string | null;
  telefone: string | null; ultima_atividade: string | null;
  ultima_mensagem: string | null; ultima_enviada_por: string | null;
  nao_lida?: boolean; status?: string | null; motivo?: string | null;
};

// motivos de encerramento = a nossa tabulação (CLAUDE.md §6 e §18)
const MOTIVOS: { v: string; rotulo: string }[] = [
  { v: "venda_realizada", rotulo: "✅ Venda realizada" },
  { v: "tentativa_contato", rotulo: "📞 Tentativa de contato" },
  { v: "follow_up", rotulo: "🕗 Follow-up agendado" },
  { v: "sem_interesse", rotulo: "🚫 Sem interesse" },
  { v: "outro", rotulo: "• Outro" },
];
type Msg = {
  id: string; conteudo: string; enviada_por: string; tipo: string | null; status: string | null; criada_em: string;
  midia_tipo?: string | null; midia_mime?: string | null; midia_nome?: string | null; midia_path?: string | null;
};
// painel do contato: dados do WinThor ao lado da conversa (o RD não tem isso)
type Contato = {
  compras: { codcli: number | null; cidade: string | null; compras: number | null; ultima_compra: string | null;
             dias_sem_comprar: number | null; total_liquido: number | null; rca_oficial: string | null } | null;
  ciclo: { pct_ciclo: number | null; ciclo_medio: number | null; dias_ausente: number | null;
           tipo_oportunidade: string | null; acao_recomendada: string | null; tendencia: string | null } | null;
  funil: { etapa: string | null; venda_valor: number | null; venda_data: string | null; sem_cadastro: boolean | null } | null;
  ultimas_notas: { data_fat: string; valor: number; num_nota: string | number | null; filial: string | null }[];
};

const moedaBR = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dataBR = (d: string | null | undefined) =>
  d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—";

const cap = (s: any) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");
const horaBR = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
const diaBR = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const rotuloTempo = (iso: string | null) => {
  if (!iso) return "";
  const hoje = diaBR(new Date().toISOString());
  const d = diaBR(iso);
  return d === hoje ? horaBR(iso) : d.split("-").reverse().slice(0, 2).join("/");
};

// ---------------------------------------------------------------------------
// Mídia na bolha. O arquivo mora em bucket privado; /api/chat/midia devolve uma
// URL assinada por redirect, então <img>/<audio>/<video> apontam direto pra rota.
// Se `midia_path` está vazio, a mensagem chegou mas o download falhou — mostra
// aviso em vez de um player quebrado.
// ---------------------------------------------------------------------------
function Midia({ m }: { m: Msg }) {
  if (!m.midia_tipo) return null;
  const src = `/api/chat/midia?id=${encodeURIComponent(m.id)}`;
  const caixa = { borderRadius: 9, marginBottom: 4, display: "block" } as const;

  if (!m.midia_path) {
    return (
      <div style={{ fontSize: 11.5, color: M.laranja, background: "#fdeae3", border: "1px solid #f0c4b0", borderRadius: 8, padding: "5px 9px", marginBottom: 4 }}>
        ⚠️ {rotuloMidia(m.midia_tipo)} não pôde ser baixada
      </div>
    );
  }
  if (m.midia_tipo === "image" || m.midia_tipo === "sticker") {
    const max = m.midia_tipo === "sticker" ? 140 : 260;
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
        <img src={src} alt={m.conteudo || "imagem"} style={{ ...caixa, maxWidth: max, maxHeight: 300, objectFit: "cover", cursor: "zoom-in" }} />
      </a>
    );
  }
  if (m.midia_tipo === "audio") {
    return <audio controls preload="none" src={src} style={{ ...caixa, width: 240, height: 38 }} />;
  }
  if (m.midia_tipo === "video") {
    return <video controls preload="metadata" src={src} style={{ ...caixa, maxWidth: 260, maxHeight: 300 }} />;
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer"
       style={{ ...caixa, display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "rgba(123,45,139,.07)", border: `1px solid ${M.border}`, textDecoration: "none", color: M.ink, maxWidth: 250 }}>
      <span style={{ fontSize: 18 }}>📎</span>
      <span style={{ minWidth: 0 }}>
        <b style={{ display: "block", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {m.midia_nome || "documento"}
        </b>
        <span style={{ fontSize: 10.5, color: M.azul, fontWeight: 700 }}>abrir ↗</span>
      </span>
    </a>
  );
}
const rotuloMidia = (t: string) =>
  ({ image: "Imagem", audio: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha" }[t] ?? "Mídia");

// ---------------------------------------------------------------------------
// Painel do contato — dados do ERP (WinThor) ao lado da conversa. É o que o RD
// Conversas nunca teve: o vendedor decide o que responder olhando o histórico de
// compra, sem trocar de tela.
// ---------------------------------------------------------------------------
function PainelContato({ c }: { c: Contato | null }) {
  if (!c) return <div style={{ padding: 14, fontSize: 12, color: M.muted }}>Carregando dados do cliente…</div>;
  const { compras, ciclo, funil, ultimas_notas } = c;

  if (!compras && !funil?.venda_valor && !ultimas_notas.length) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: M.muted, lineHeight: 1.5 }}>
        Sem cadastro no WinThor — contato ainda não vinculado a um cliente do ERP.
      </div>
    );
  }

  const Bloco = ({ titulo, children }: { titulo: string; children: any }) => (
    <div style={{ padding: "11px 14px", borderBottom: `1px solid ${M.border}` }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: M.muted, marginBottom: 6 }}>{titulo}</div>
      {children}
    </div>
  );
  const Linha = ({ r, v, forte }: { r: string; v: any; forte?: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "2px 0" }}>
      <span style={{ color: M.gray }}>{r}</span>
      <b style={{ color: forte ? M.wine : M.ink, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{v}</b>
    </div>
  );

  // barra do ciclo: quanto do intervalo médio de recompra já passou
  const pct = ciclo?.pct_ciclo == null ? null : Math.max(0, Math.min(140, Number(ciclo.pct_ciclo)));
  const corCiclo = pct == null ? M.muted : pct >= 100 ? M.laranja : pct >= 75 ? "#b8860b" : "#1a6b3c";

  return (
    <div style={{ fontSize: 12.5 }}>
      {compras && (
        <Bloco titulo="Cliente no WinThor">
          <Linha r="Código" v={compras.codcli ?? "—"} />
          {compras.cidade && <Linha r="Cidade" v={compras.cidade} />}
          {compras.rca_oficial && <Linha r="RCA oficial" v={compras.rca_oficial} />}
        </Bloco>
      )}

      {compras && (
        <Bloco titulo="Histórico de compra">
          <Linha r="Compras" v={compras.compras ?? 0} />
          <Linha r="Total líquido" v={moedaBR(compras.total_liquido)} forte />
          <Linha r="Última compra" v={dataBR(compras.ultima_compra)} />
          <Linha r="Sem comprar há" v={compras.dias_sem_comprar != null ? `${compras.dias_sem_comprar} dias` : "—"} />
        </Bloco>
      )}

      {ciclo && (ciclo.ciclo_medio != null || ciclo.acao_recomendada) && (
        <Bloco titulo="Ciclo de recompra">
          {ciclo.ciclo_medio != null && <Linha r="Ciclo médio" v={`${Math.round(Number(ciclo.ciclo_medio))} dias`} />}
          {pct != null && (
            <>
              <div style={{ height: 6, borderRadius: 6, background: "#e6d8e4", overflow: "hidden", margin: "6px 0 4px" }}>
                <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: corCiclo }} />
              </div>
              <div style={{ fontSize: 11, color: corCiclo, fontWeight: 700 }}>
                {pct >= 100 ? "Passou do ciclo — hora de reativar" : `${Math.round(pct)}% do ciclo percorrido`}
              </div>
            </>
          )}
          {ciclo.acao_recomendada && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: M.ink, background: M.roxoSoft, borderRadius: 8, padding: "6px 9px", lineHeight: 1.4 }}>
              💡 {ciclo.acao_recomendada}
            </div>
          )}
        </Bloco>
      )}

      {funil && (
        <Bloco titulo="No funil">
          <Linha r="Etapa" v={cap(String(funil.etapa ?? "—").replace(/_/g, " "))} />
          {funil.venda_valor != null && <Linha r="Faturado no mês" v={moedaBR(funil.venda_valor)} forte />}
        </Bloco>
      )}

      {!!ultimas_notas.length && (
        <Bloco titulo="Últimas notas">
          {ultimas_notas.map((n, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: M.gray }}>{dataBR(n.data_fat)}</span>
              <b>{moedaBR(n.valor)}</b>
            </div>
          ))}
        </Bloco>
      )}
    </div>
  );
}

// ticks estilo WhatsApp: wait ✓ · success ✓✓ · read/checked ✓✓ azul · failed !
function Ticks({ status }: { status: string | null }) {
  if (status === "failed") return <span style={{ color: M.laranja, fontWeight: 800 }}>!</span>;
  const lida = status === "read" || status === "checked";
  const duplo = lida || status === "success";
  return (
    <span style={{ color: lida ? M.azul : M.muted, letterSpacing: -2, fontWeight: 700 }}>
      {duplo ? "✓✓" : "✓"}
    </span>
  );
}

export default function Chat() {
  const [sessao, setSessao] = useState<{ role: string; carteira: string | null } | null | undefined>(undefined);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Conversa | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [filtro, setFiltro] = useState<"pendentes" | "todas" | "resolvidas">("todas");
  const [resolvendo, setResolvendo] = useState(false);      // painel de motivo aberto
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [contato, setContato] = useState<Contato | null>(null);
  const [linha, setLinha] = useState<{ id: string | null; rotulo: string; canal: string } | null>(null);
  const [painelAberto, setPainelAberto] = useState(true);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<Conversa | null>(null);
  selRef.current = sel;
  // guarda de in-flight: nunca empilha recargas (mesmo padrão do board)
  const carregandoLista = useRef(false);

  useEffect(() => {
    const mq = () => setIsMobile(window.innerWidth < 768);
    mq(); window.addEventListener("resize", mq);
    return () => window.removeEventListener("resize", mq);
  }, []);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSessao(j?.role ? { role: j.role, carteira: j.carteira ?? null } : null))
      .catch(() => setSessao(null));
  }, []);

  const carregarLista = useCallback(async () => {
    if (carregandoLista.current) return;
    carregandoLista.current = true;
    try {
      const r = await fetch("/api/chat", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (r.ok) { setConversas(j?.conversas ?? []); setErro(null); }
      else if (r.status === 401) setSessao(null);
      else setErro(j?.error ?? `erro ${r.status}`);
    } finally { carregandoLista.current = false; }
  }, []);

  const carregarThread = useCallback(async (c: Conversa, scroll = true) => {
    const r = await fetch(`/api/chat/thread?cliente_id=${encodeURIComponent(c.cliente_id)}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok) { setErro(j?.error ?? `erro ${r.status}`); return; }
    setMsgs(j?.mensagens ?? []);
    setLinha(j?.linha ?? null);
    if (scroll) setTimeout(() => fimRef.current?.scrollIntoView({ behavior: "auto" }), 30);
  }, []);

  // carga inicial + poll lento (rede de proteção) + Realtime (mesmo canal do board)
  useEffect(() => {
    if (!sessao) return;
    carregarLista();
    const lento = setInterval(() => {
      carregarLista();
      if (selRef.current) carregarThread(selRef.current, false);
    }, 60_000);

    let canal: any = null;
    let cancelado = false;
    (async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) return;
      try {
        const { createBrowserClient } = await import("@supabase/ssr");
        if (cancelado) return;
        const supa = createBrowserClient(url, anon);
        canal = supa
          .channel("board")
          .on("broadcast", { event: "mudou" }, (msg: any) => {
            const cart = msg?.payload?.carteira ?? msg?.payload?.payload?.carteira ?? null;
            if (cart && sessao.carteira && cart !== sessao.carteira) return;
            carregarLista();
            if (selRef.current) carregarThread(selRef.current, false);
          })
          .subscribe();
      } catch { /* sem realtime: o poll de 60s cobre */ }
    })();

    return () => { cancelado = true; clearInterval(lento); try { canal?.unsubscribe(); } catch {} };
  }, [sessao, carregarLista, carregarThread]);

  // aviso no título da aba: "(3) Chat" — o vendedor percebe sem estar na tela
  const naoLidas = conversas.filter((c) => c.nao_lida).length;
  useEffect(() => {
    document.title = naoLidas ? `(${naoLidas}) Chat — Murano` : "Chat — Murano";
  }, [naoLidas]);

  // som + notificação do sistema quando CHEGA mensagem nova (não no primeiro
  // carregamento, senão apitaria ao abrir a tela com conversas pendentes).
  const naoLidasAnterior = useRef<number | null>(null);
  useEffect(() => {
    const antes = naoLidasAnterior.current;
    naoLidasAnterior.current = naoLidas;
    if (antes === null || naoLidas <= antes) return;
    // bipe curto via WebAudio: não depende de arquivo de áudio hospedado
    try {
      const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator(), ganho = ctx.createGain();
        osc.connect(ganho); ganho.connect(ctx.destination);
        osc.frequency.value = 880; osc.type = "sine";
        ganho.gain.setValueAtTime(0.0001, ctx.currentTime);
        ganho.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
        ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
        osc.start(); osc.stop(ctx.currentTime + 0.36);
        setTimeout(() => ctx.close().catch(() => {}), 600);
      }
    } catch { /* navegador sem WebAudio ou sem gesto do usuário ainda: silencioso */ }
    // notificação do sistema só se o usuário já autorizou e a aba não está à frente
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        new Notification("Nova mensagem no Chat", {
          body: `${naoLidas} conversa${naoLidas > 1 ? "s" : ""} aguardando resposta`,
          tag: "chat-murano",
        });
      }
    } catch { /* idem */ }
  }, [naoLidas]);

  // pede permissão de notificação uma única vez, no primeiro clique do usuário
  // (navegador exige gesto; pedir na carga da página costuma ser negado)
  useEffect(() => {
    const pedir = () => {
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
      } catch {}
      window.removeEventListener("click", pedir);
    };
    window.addEventListener("click", pedir);
    return () => window.removeEventListener("click", pedir);
  }, []);

  function abrir(c: Conversa) {
    setSel(c); setMsgs(null); setAviso(null); setResolvendo(false); setContato(null);
    carregarThread(c);
    // painel do contato (WinThor) — falha aqui não atrapalha a conversa
    fetch(`/api/chat/contato?cliente_id=${encodeURIComponent(c.cliente_id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setContato(j ?? null))
      .catch(() => setContato(null));
    // marca como lida (otimista na lista; o servidor guarda a marca por usuário)
    if (c.nao_lida) {
      setConversas((cs) => cs.map((x) => (x.cliente_id === c.cliente_id ? { ...x, nao_lida: false } : x)));
    }
    fetch("/api/chat/lida", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cliente_id: c.cliente_id }),
    }).catch(() => { /* silencioso: a marca é conveniência, não bloqueia o uso */ });
  }

  // resolver / reabrir a conversa (o substituto do "fechar atendimento" do RD)
  async function mudarStatus(status: "aberta" | "resolvida", motivo?: string) {
    if (!sel) return;
    const antes = sel.status ?? "aberta";
    setSel({ ...sel, status, motivo: motivo ?? null });
    setConversas((cs) => cs.map((x) => (x.cliente_id === sel.cliente_id ? { ...x, status, motivo: motivo ?? null } : x)));
    setResolvendo(false);
    try {
      const r = await fetch("/api/chat/status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, status, motivo }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `erro ${r.status}`);
    } catch (e: any) {
      setSel((s) => (s ? { ...s, status: antes } : s));   // desfaz o otimismo
      setAviso(`Não consegui mudar o status: ${e?.message ?? e}`);
    }
  }

  // envio de arquivo (foto, áudio, documento) pelo canal WhatsApp direto
  async function enviarArquivo(file: File) {
    if (!sel || enviandoArquivo) return;
    setEnviandoArquivo(true); setAviso(null);
    try {
      const fd = new FormData();
      fd.set("cliente_id", sel.cliente_id);
      fd.set("arquivo", file);
      if (texto.trim()) fd.set("legenda", texto.trim());
      const r = await fetch("/api/chat/enviar-midia", { method: "POST", body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setAviso(j?.foraDaJanela
          ? "Fora da janela de 24h — envie um TEMPLATE para reabrir a conversa."
          : (j?.error ?? `erro ${r.status}`));
      } else {
        setTexto("");
        carregarThread(sel, true);
        carregarLista();
      }
    } catch (e: any) {
      setAviso(`Falha ao enviar arquivo: ${e?.message ?? e}`);
    } finally {
      setEnviandoArquivo(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  // template de recontato — reabre conversa fora da janela sem sair do chat
  async function enviarTemplate() {
    if (!sel || enviando) return;
    setEnviando(true); setAviso(null);
    try {
      const r = await fetch("/api/send-template", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) setAviso(j?.error ?? `erro ${r.status}`);
      else { carregarThread(sel, true); carregarLista(); }
    } finally { setEnviando(false); }
  }

  async function enviar() {
    const t = texto.trim();
    if (!t || !sel || enviando) return;
    setEnviando(true); setAviso(null);
    // otimista: aparece na hora com tick de espera; o refresh confirma
    const otimista: Msg = { id: `tmp:${Date.now()}`, conteudo: t, enviada_por: "operator", tipo: "mensagem", status: "wait", criada_em: new Date().toISOString() };
    setMsgs((m) => [...(m ?? []), otimista]);
    setTexto("");
    setTimeout(() => fimRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
    try {
      const r = await fetch("/api/send-message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: sel.cliente_id, texto: t }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setMsgs((m) => (m ?? []).filter((x) => x.id !== otimista.id));
        setAviso(j?.foraDaJanela
          ? "Fora da janela de 24h do WhatsApp — use o botão TEMPLATE aqui do lado para reabrir a conversa."
          : (j?.error ?? `erro ${r.status}`));
        setTexto(t); // devolve o texto pro campo
      } else {
        carregarThread(sel, false);
        carregarLista();
      }
    } finally { setEnviando(false); }
  }

  if (sessao === undefined) return <div style={{ padding: 40, color: M.gray, fontSize: 14, background: M.bg, minHeight: "100vh" }}>Verificando sessão…</div>;
  if (sessao === null) {
    return (
      <div style={{ minHeight: "100vh", background: M.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: M.ink }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Chat</div>
        <div style={{ color: M.gray, fontSize: 14 }}>Sessão expirada — entre pelo funil e volte.</div>
        <Link href="/" style={{ color: M.azul, fontSize: 14, textDecoration: "none" }}>← ir para o login</Link>
      </div>
    );
  }

  const filtradas = conversas.filter((c) => {
    const st = c.status ?? "aberta";
    if (filtro === "pendentes" && !(st === "aberta" && c.nao_lida)) return false;
    if (filtro === "resolvidas" && st !== "resolvida") return false;
    if (filtro === "todas" && st === "resolvida") return false; // resolvida sai da fila
    if (!busca.trim()) return true;
    const b = busca.toLowerCase();
    return (c.cliente ?? "").toLowerCase().includes(b) || String(c.telefone ?? "").includes(b.replace(/\D/g, "") || " ");
  });
  const contaResolvidas = conversas.filter((c) => (c.status ?? "aberta") === "resolvida").length;

  const mostraLista = !isMobile || !sel;
  const mostraThread = !isMobile || !!sel;

  // agrupa mensagens por dia pro separador de data
  const grupos: { dia: string; itens: Msg[] }[] = [];
  for (const m of msgs ?? []) {
    const d = diaBR(m.criada_em);
    const g = grupos[grupos.length - 1];
    if (g && g.dia === d) g.itens.push(m);
    else grupos.push({ dia: d, itens: [m] });
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: M.bg, color: M.ink, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${M.laranja}, ${M.wine}, ${M.roxo})` }} />
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 18px", background: M.surface, borderBottom: `1px solid ${M.border}` }}>
        <Link href="/" style={{ color: M.gray, textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>← CRM</Link>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3, color: M.wine }}>💬 Chat</div>
        <div style={{ fontSize: 11.5, color: M.muted }}>mensagens em tempo real — envio livre dentro da janela de 24h</div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* ---- sidebar: lista de conversas ---- */}
        {mostraLista && (
          <div style={{ width: isMobile ? "100%" : 340, flexShrink: 0, display: "flex", flexDirection: "column", background: M.surface, borderRight: `1px solid ${M.border}` }}>
            <div style={{ padding: 10, borderBottom: `1px solid ${M.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="🔍  Buscar conversa…"
                style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", fontSize: 13, fontFamily: "inherit", color: M.ink, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 10, outline: "none" }}
              />
              {/* fila: pendentes = cliente falou e ninguém leu ainda */}
              <div style={{ display: "flex", gap: 6 }}>
                {([
                  { k: "pendentes" as const, r: "Pendentes", n: naoLidas },
                  { k: "todas" as const, r: "Abertas", n: conversas.length - contaResolvidas },
                  { k: "resolvidas" as const, r: "Resolvidas", n: contaResolvidas },
                ]).map((t) => {
                  const on = filtro === t.k;
                  return (
                    <button key={t.k} onClick={() => setFiltro(t.k)}
                      style={{ flex: 1, padding: "5px 6px", fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                        color: on ? "#fff" : M.gray, background: on ? M.roxo : M.bg,
                        border: `1px solid ${on ? M.roxo : M.border}`, borderRadius: 8 }}>
                      {t.r}{t.n > 0 ? ` ${t.n}` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {erro && <div style={{ padding: 14, fontSize: 12.5, color: M.laranja }}>{erro}</div>}
              {!erro && !conversas.length && <div style={{ padding: 14, fontSize: 12.5, color: M.muted }}>Carregando conversas…</div>}
              {filtradas.map((c) => {
                const ativa = sel?.cliente_id === c.cliente_id;
                const doCliente = c.ultima_enviada_por === "customer";
                return (
                  <button
                    key={c.cliente_id}
                    onClick={() => abrir(c)}
                    style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", padding: "10px 12px", background: ativa ? M.roxoSoft : "transparent", border: "none", borderBottom: `1px solid ${M.bg}`, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 38, background: ativa ? M.roxo : M.wine, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800 }}>
                      {(c.cliente ?? "?").trim().charAt(0).toUpperCase()}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <b style={{ fontSize: 13.5, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, fontWeight: c.nao_lida ? 900 : 700 }}>{c.cliente}</b>
                        {(c.status ?? "aberta") === "resolvida" && (
                          <span title="conversa resolvida" style={{ fontSize: 10, color: "#1a6b3c", flexShrink: 0 }}>✓</span>
                        )}
                        <span style={{ fontSize: 10.5, color: c.nao_lida ? M.roxo : M.muted, fontWeight: c.nao_lida ? 800 : 400, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{rotuloTempo(c.ultima_atividade)}</span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 12, color: M.gray, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                          {c.ultima_enviada_por === "operator" ? "Você: " : ""}{c.ultima_mensagem ?? "…"}
                        </span>
                        {c.vendedor && sessao.carteira == null && (
                          <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", color: M.roxo, background: M.roxoSoft, borderRadius: 999, padding: "1px 7px", flexShrink: 0 }}>{cap(c.vendedor)}</span>
                        )}
                        {c.nao_lida && (
                          <span title="não lida" style={{ width: 9, height: 9, borderRadius: 9, background: M.roxo, flexShrink: 0 }} />
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
              {busca && !filtradas.length && <div style={{ padding: 14, fontSize: 12.5, color: M.muted }}>Nada encontrado para “{busca}”.</div>}
            </div>
          </div>
        )}

        {/* ---- thread ---- */}
        {mostraThread && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: M.bgThread }}>
            {!sel && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: M.muted }}>
                <div style={{ fontSize: 44 }}>💬</div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: M.gray }}>Selecione uma conversa ao lado</div>
                <div style={{ fontSize: 12 }}>mensagens dentro da janela de 24h são enviadas na hora</div>
              </div>
            )}
            {sel && (
              <>
                {/* cabeçalho da conversa */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: M.surface, borderBottom: `1px solid ${M.border}` }}>
                  {isMobile && (
                    <button onClick={() => { setSel(null); setMsgs(null); }} style={{ background: "transparent", border: "none", fontSize: 16, color: M.gray, cursor: "pointer", padding: "0 4px", fontFamily: "inherit" }}>←</button>
                  )}
                  <span style={{ width: 34, height: 34, borderRadius: 34, background: M.wine, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
                    {(sel.cliente ?? "?").trim().charAt(0).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: "block", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.cliente}</b>
                    <span style={{ fontSize: 11, color: M.muted, fontVariantNumeric: "tabular-nums" }}>
                      {sel.telefone ?? "sem telefone"}{sel.vendedor ? ` · carteira ${cap(sel.vendedor)}` : ""}
                      {/* por qual NÚMERO esta conversa corre — com mais de uma linha
                          ativa, é o que evita responder pela linha errada (a janela
                          de 24h é por par número+cliente) */}
                      {linha && (
                        <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.3,
                          color: linha.canal === "rd" ? M.gray : M.roxo,
                          background: linha.canal === "rd" ? "#eee8ed" : M.roxoSoft,
                          borderRadius: 999, padding: "1px 7px" }}>
                          {linha.rotulo}
                        </span>
                      )}
                    </span>
                  </span>
                  {!isMobile && (
                    <button onClick={() => setPainelAberto((v) => !v)} title={painelAberto ? "Ocultar dados do cliente" : "Mostrar dados do cliente"}
                      style={{ fontSize: 11.5, fontWeight: 700, color: painelAberto ? "#fff" : M.wine, background: painelAberto ? M.wine : M.bg, border: `1px solid ${painelAberto ? M.wine : M.border}`, borderRadius: 999, padding: "5px 11px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      📊 Cliente
                    </button>
                  )}
                  {(sel.status ?? "aberta") === "resolvida" ? (
                    <button onClick={() => mudarStatus("aberta")} title="Voltar para a fila"
                      style={{ fontSize: 11.5, fontWeight: 700, color: "#1a6b3c", background: "#eaf5ee", border: "1px solid #bfe0cb", borderRadius: 999, padding: "5px 11px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      ✓ Resolvida — reabrir
                    </button>
                  ) : (
                    <button onClick={() => setResolvendo((v) => !v)} title="Encerrar atendimento com um motivo"
                      style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: M.roxo, border: "none", borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                      Resolver
                    </button>
                  )}
                  {sel.telefone && (
                    <a href={`https://wa.me/${String(sel.telefone).replace(/\D/g, "").length <= 11 ? "55" : ""}${String(sel.telefone).replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" title="Abrir no WhatsApp" style={{ fontSize: 12, fontWeight: 700, color: M.azul, textDecoration: "none", whiteSpace: "nowrap" }}>
                      WhatsApp ↗
                    </a>
                  )}
                </div>

                {/* escolha do motivo — é a nossa tabulação, no fluxo natural do encerramento */}
                {resolvendo && (
                  <div style={{ padding: "10px 14px", background: M.roxoSoft, borderBottom: `1px solid ${M.border}` }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: M.wine, marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Por que está encerrando?
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {MOTIVOS.map((mo) => (
                        <button key={mo.v} onClick={() => mudarStatus("resolvida", mo.v)}
                          style={{ fontSize: 12, fontWeight: 600, color: M.ink, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>
                          {mo.rotulo}
                        </button>
                      ))}
                      <button onClick={() => setResolvendo(false)}
                        style={{ fontSize: 12, color: M.gray, background: "transparent", border: "none", padding: "6px 8px", cursor: "pointer", fontFamily: "inherit" }}>
                        cancelar
                      </button>
                    </div>
                  </div>
                )}

                {/* mensagens */}
                <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {msgs === null && <div style={{ color: M.muted, fontSize: 12.5, textAlign: "center", padding: 20 }}>Carregando mensagens…</div>}
                  {msgs?.length === 0 && <div style={{ color: M.muted, fontSize: 12.5, textAlign: "center", padding: 20 }}>Sem mensagens ainda.</div>}
                  {grupos.map((g) => (
                    <div key={g.dia} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ alignSelf: "center", fontSize: 10.5, fontWeight: 700, color: M.gray, background: M.surface, border: `1px solid ${M.border}`, borderRadius: 999, padding: "3px 12px", margin: "8px 0 4px" }}>
                        {g.dia.split("-").reverse().join("/")}
                      </div>
                      {g.itens.map((m) => {
                        const fora = m.enviada_por !== "customer"; // operator/bot = lado direito
                        return (
                          <div key={m.id} style={{ display: "flex", justifyContent: fora ? "flex-end" : "flex-start" }}>
                            <div style={{ maxWidth: "72%", background: fora ? M.bolhaFora : M.bolhaDentro, border: `1px solid ${fora ? "#dcc8e2" : M.border}`, borderRadius: fora ? "12px 12px 3px 12px" : "12px 12px 12px 3px", padding: "7px 11px", boxShadow: "0 1px 1px rgba(28,14,27,0.06)" }}>
                              {m.tipo === "template" && (
                                <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: M.roxo, marginBottom: 3 }}>template</div>
                              )}
                              <Midia m={m} />
                              {/* com mídia, o texto só aparece se for legenda de verdade (não o rótulo) */}
                              {(!m.midia_tipo || (m.conteudo && !/^(📷|🎬|🎤|📎|🙂)/.test(m.conteudo))) && (
                                <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.conteudo}</div>
                              )}
                              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 5, marginTop: 3, fontSize: 10, color: M.muted, fontVariantNumeric: "tabular-nums" }}>
                                {horaBR(m.criada_em)}
                                {fora && <Ticks status={m.status} />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  <div ref={fimRef} />
                </div>

                {/* aviso (janela 24h / erro de envio) — o ÚNICO uso forte do laranja */}
                {aviso && (
                  <div style={{ margin: "0 14px", padding: "8px 12px", fontSize: 12.5, color: "#8a2f12", background: "#fdeae3", border: `1px solid #f0c4b0`, borderLeft: `3px solid ${M.laranja}`, borderRadius: "0 8px 8px 0" }}>
                    ⚠️ {aviso}
                  </div>
                )}

                {/* caixa de envio */}
                <div style={{ display: "flex", gap: 8, padding: "10px 14px", background: M.surface, borderTop: `1px solid ${M.border}`, alignItems: "flex-end" }}>
                  {/* anexo: foto, áudio, documento — o texto digitado vira legenda */}
                  <input
                    ref={arquivoRef}
                    type="file"
                    accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx"
                    style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarArquivo(f); }}
                  />
                  <button
                    onClick={() => arquivoRef.current?.click()}
                    disabled={enviandoArquivo}
                    title="Anexar foto, áudio ou documento"
                    style={{ width: 42, height: 42, borderRadius: 12, border: `1px solid ${M.border}`, background: M.bg, color: M.gray, fontSize: 17, cursor: enviandoArquivo ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    {enviandoArquivo ? "…" : "📎"}
                  </button>
                  <button
                    onClick={enviarTemplate}
                    disabled={enviando}
                    title="Enviar template de recontato (reabre conversa fora da janela de 24h)"
                    style={{ height: 42, padding: "0 12px", borderRadius: 12, border: `1px solid ${M.border}`, background: M.bg, color: M.wine, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    TEMPLATE
                  </button>
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                    placeholder="Escreva uma mensagem… (Enter envia, Shift+Enter quebra linha)"
                    rows={1}
                    style={{ flex: 1, resize: "none", padding: "10px 13px", fontSize: 13.5, fontFamily: "inherit", color: M.ink, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 12, outline: "none", lineHeight: 1.4, maxHeight: 110 }}
                  />
                  <button
                    onClick={enviar}
                    disabled={enviando || !texto.trim()}
                    title="Enviar (Enter)"
                    style={{ width: 44, height: 42, borderRadius: 12, border: "none", background: texto.trim() ? M.roxo : M.roxoSoft, color: texto.trim() ? "#fff" : M.muted, fontSize: 17, cursor: texto.trim() ? "pointer" : "default", fontFamily: "inherit", transition: "background .15s", flexShrink: 0 }}
                  >
                    {enviando ? "…" : "➤"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ---- painel do contato (desktop): o ERP ao lado da conversa ---- */}
        {mostraThread && sel && painelAberto && !isMobile && (
          <div style={{ width: 268, flexShrink: 0, overflowY: "auto", background: M.surface, borderLeft: `1px solid ${M.border}` }}>
            <div style={{ padding: "10px 14px", borderBottom: `1px solid ${M.border}`, background: M.roxoSoft }}>
              <b style={{ fontSize: 12.5, color: M.wine }}>Dados do cliente</b>
              <div style={{ fontSize: 10.5, color: M.gray, marginTop: 1 }}>direto do WinThor</div>
            </div>
            <PainelContato c={contato} />
          </div>
        )}
      </div>
    </div>
  );
}
