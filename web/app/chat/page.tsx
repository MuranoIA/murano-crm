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
};
type Msg = { id: string; conteudo: string; enviada_por: string; tipo: string | null; status: string | null; criada_em: string };

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

  function abrir(c: Conversa) {
    setSel(c); setMsgs(null); setAviso(null);
    carregarThread(c);
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
          ? "Fora da janela de 24h do WhatsApp — envie um TEMPLATE pelo board para reabrir a conversa."
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
    if (!busca.trim()) return true;
    const b = busca.toLowerCase();
    return (c.cliente ?? "").toLowerCase().includes(b) || String(c.telefone ?? "").includes(b.replace(/\D/g, "") || " ");
  });

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
            <div style={{ padding: 10, borderBottom: `1px solid ${M.border}` }}>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="🔍  Buscar conversa…"
                style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", fontSize: 13, fontFamily: "inherit", color: M.ink, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 10, outline: "none" }}
              />
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
                        <b style={{ fontSize: 13.5, color: M.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{c.cliente}</b>
                        <span style={{ fontSize: 10.5, color: doCliente ? M.laranja : M.muted, fontWeight: doCliente ? 800 : 400, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{rotuloTempo(c.ultima_atividade)}</span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: 12, color: M.gray, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                          {c.ultima_enviada_por === "operator" ? "Você: " : ""}{c.ultima_mensagem ?? "…"}
                        </span>
                        {c.vendedor && sessao.carteira == null && (
                          <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", color: M.roxo, background: M.roxoSoft, borderRadius: 999, padding: "1px 7px", flexShrink: 0 }}>{cap(c.vendedor)}</span>
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
                    </span>
                  </span>
                  {sel.telefone && (
                    <a href={`https://wa.me/${String(sel.telefone).replace(/\D/g, "").length <= 11 ? "55" : ""}${String(sel.telefone).replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" title="Abrir no WhatsApp" style={{ fontSize: 12, fontWeight: 700, color: M.azul, textDecoration: "none", whiteSpace: "nowrap" }}>
                      WhatsApp ↗
                    </a>
                  )}
                </div>

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
                              <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.conteudo}</div>
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
                <div style={{ display: "flex", gap: 8, padding: "10px 14px", background: M.surface, borderTop: `1px solid ${M.border}` }}>
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
                    style={{ alignSelf: "flex-end", width: 44, height: 42, borderRadius: 12, border: "none", background: texto.trim() ? M.roxo : M.roxoSoft, color: texto.trim() ? "#fff" : M.muted, fontSize: 17, cursor: texto.trim() ? "pointer" : "default", fontFamily: "inherit", transition: "background .15s" }}
                  >
                    {enviando ? "…" : "➤"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
