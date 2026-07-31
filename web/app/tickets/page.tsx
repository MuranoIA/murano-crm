"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type DragEvent } from "react";
import Link from "next/link";

// Tickets = "cards" no estilo caixa de e-mail, IGUAL para todos (vendedor/home/admin).
// 3 ações: Criar card (modal), Recebidos e Enviados — estas abrem um KANBAN de 3 colunas
// (Em aberto / Em andamento / Resolvidos). Em "Recebidos" o DESTINATÁRIO arrasta os cards
// entre as colunas (muda o status, com horários). Em "Enviados" o remetente só visualiza a
// posição (reflete o que o destinatário fez). Status + devolutiva permanecem.
// Paleta do CRM: navy / púrpura(wine) / azul / cinzas / branco.

const NAVY = "#111d33", WINE = "#57163f", CYAN = "#0e6aa8", GRAY = "#5a6472", GRAYL = "#7d8695";
const BORDER = "#cdd6e2", BG = "#eef0f4", SURF = "#ffffff", PANEL = "#f3f5f9", COL = "#dfe4ec";

type Ticket = {
  id: string; titulo: string; texto: string;
  autor_email: string | null; autor_nome: string;
  destinatario_email: string | null; destinatario_nome: string | null;
  status: "aberto" | "andamento" | "resolvido"; devolutiva: string | null; responsavel_nome: string | null;
  criado_em: string; andamento_em: string | null; resolvido_em: string | null;
};
type Usuario = { email: string; nome: string; papel: string | null };

const COLS = [
  { status: "aberto" as const, label: "Em aberto", cor: "#475569" },
  { status: "andamento" as const, label: "Em andamento", cor: "#155e9c" },
  { status: "resolvido" as const, label: "Resolvidos", cor: WINE },
];
const CORDE = (s: string) => (COLS.find((c) => c.status === s) ?? COLS[0]).cor;
const LABEL = (s: string) => (COLS.find((c) => c.status === s) ?? COLS[0]).label;

function dt(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Belem", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [view, setView] = useState<"home" | "recebidos" | "enviados">("home");
  const [modal, setModal] = useState(false);
  const [dest, setDest] = useState("");
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);

  const carregar = useCallback(() => {
    fetch("/api/tickets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => { setTickets(j.tickets || []); setMeEmail(j.meEmail || null); setErro(""); })
      .catch(() => setErro("Não foi possível carregar os cards."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  function abrirCriar() {
    setDest(""); setTitulo(""); setTexto(""); setModal(true);
    if (!usuarios.length) {
      fetch("/api/tickets/usuarios", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { usuarios: [] })).then((j) => setUsuarios(j.usuarios || [])).catch(() => {});
    }
  }
  async function enviar() {
    if (!dest) { alert("Escolha o destinatário."); return; }
    if (titulo.trim().length < 3) { alert("Dê um título ao card (mín. 3 letras)."); return; }
    setEnviando(true);
    try {
      const r = await fetch("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinatario_email: dest, titulo, texto }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert("Erro ao enviar: " + (j?.error ?? r.status)); return; }
      setModal(false); carregar(); setView("enviados");
    } catch (e: any) { alert("Falha: " + (e?.message ?? e)); }
    finally { setEnviando(false); }
  }
  async function atualizar(id: string, patch: any) {
    const r = await fetch(`/api/tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert("Erro: " + (j?.error ?? r.status)); carregar(); return false; }
    carregar(); return true;
  }
  function moverPara(t: Ticket, status: "aberto" | "andamento" | "resolvido") {
    if (t.status === status) return;
    setTickets((prev) => prev.map((x) => (x.id === t.id ? { ...x, status } : x))); // otimista
    atualizar(t.id, { status });
  }

  const recebidos = useMemo(() => tickets.filter((t) => t.destinatario_email === meEmail), [tickets, meEmail]);
  const enviados = useMemo(() => tickets.filter((t) => t.autor_email === meEmail), [tickets, meEmail]);
  const abertosReceb = recebidos.filter((t) => t.status !== "resolvido").length;

  const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, color: NAVY, border: `1px solid ${BORDER}`, borderRadius: 8, outline: "none", background: PANEL, fontFamily: "inherit" };

  const lista = view === "recebidos" ? recebidos : enviados;
  const editavel = view === "recebidos"; // só o destinatário arrasta/gerencia
  const tDet = tickets.find((t) => t.id === detalheId) || null;

  function onDrop(e: DragEvent, status: "aberto" | "andamento" | "resolvido") {
    e.preventDefault(); setDragCol(null); setDragId(null);
    const id = e.dataTransfer.getData("text/plain");
    const t = tickets.find((x) => x.id === id);
    if (t && t.destinatario_email === meEmail) moverPara(t, status);
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, color: NAVY, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: SURF, borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, zIndex: 10 }}>
        <Link href="/" style={{ color: GRAY, textDecoration: "none", fontSize: 13, fontWeight: 700 }}>← Voltar ao CRM</Link>
        <div style={{ fontSize: 18, fontWeight: 800, color: WINE }}>🎫 Tickets</div>
        {view !== "home" && <button onClick={() => setView("home")} style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 700, color: GRAY, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}>← Início</button>}
      </div>

      <div style={{ maxWidth: view === "home" ? 1000 : 1180, margin: "0 auto", padding: "20px 16px 60px" }}>
        {erro && <div style={{ background: "#fbe9e9", border: "1px solid #e2a4a4", color: "#8a1f1f", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 16, fontWeight: 600 }}>{erro}</div>}

        {view === "home" && (
          <>
            <p style={{ color: GRAY, fontSize: 13.5, margin: "0 0 18px", fontWeight: 500 }}>Envie e receba cards como numa caixa de e-mail. Nos Recebidos, arraste os cards entre as colunas para mudar o status — o remetente vê o andamento em Enviados.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              <HomeCard emoji="✉️" titulo="Criar card" desc="Enviar um novo card" cor={WINE} onClick={abrirCriar} />
              <HomeCard emoji="📥" titulo="Recebidos" desc="Cards enviados a você · arraste p/ mudar status" cor={CYAN} badge={abertosReceb ? `${abertosReceb} em aberto` : (recebidos.length ? `${recebidos.length}` : "")} onClick={() => setView("recebidos")} />
              <HomeCard emoji="📤" titulo="Enviados" desc="Cards que você enviou · acompanhe o andamento" cor="#475569" badge={enviados.length ? `${enviados.length}` : ""} onClick={() => setView("enviados")} />
            </div>
          </>
        )}

        {(view === "recebidos" || view === "enviados") && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 6px" }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: NAVY }}>{view === "recebidos" ? "📥 Recebidos" : "📤 Enviados"}</div>
              <button onClick={abrirCriar} style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: "#fff", background: WINE, border: `1px solid ${WINE}`, borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>✉️ Criar card</button>
            </div>
            <p style={{ fontSize: 12, color: GRAYL, fontWeight: 600, margin: "0 0 14px" }}>{editavel ? "Arraste um card para outra coluna para mudar o status." : "Somente leitura — a posição reflete o status definido pelo destinatário."}</p>

            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, alignItems: "flex-start" }}>
              {COLS.map((c) => {
                const items = lista.filter((t) => t.status === c.status);
                const alvo = dragCol === c.status;
                return (
                  <div key={c.status}
                    onDragOver={editavel ? (e) => { e.preventDefault(); if (dragCol !== c.status) setDragCol(c.status); } : undefined}
                    onDragLeave={editavel ? () => setDragCol((v) => (v === c.status ? null : v)) : undefined}
                    onDrop={editavel ? (e) => onDrop(e, c.status) : undefined}
                    style={{ flex: "1 1 0", minWidth: 260, background: alvo ? "#d3dbe8" : COL, border: `1px solid ${alvo ? c.cor : BORDER}`, borderRadius: 12, overflow: "hidden", transition: "background .12s" }}>
                    <div style={{ padding: "10px 13px", background: c.cor, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800 }}>{c.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 800, background: "rgba(255,255,255,.22)", borderRadius: 100, padding: "1px 9px" }}>{items.length}</span>
                    </div>
                    <div style={{ padding: 10, minHeight: 140, display: "flex", flexDirection: "column", gap: 10 }}>
                      {loading ? (
                        <div style={{ fontSize: 12.5, color: GRAYL, fontWeight: 500 }}>Carregando…</div>
                      ) : items.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: GRAYL, fontWeight: 500, padding: "6px 2px" }}>—</div>
                      ) : items.map((t) => (
                        <div key={t.id}
                          draggable={editavel}
                          onDragStart={editavel ? (e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; setDragId(t.id); } : undefined}
                          onDragEnd={() => { setDragId(null); setDragCol(null); }}
                          onClick={() => setDetalheId(t.id)}
                          style={{ background: SURF, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${c.cor}`, borderRadius: 10, padding: "10px 11px", cursor: editavel ? "grab" : "pointer", boxShadow: "0 2px 8px rgba(17,29,51,.06)", opacity: dragId === t.id ? 0.5 : 1 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 800, color: NAVY, lineHeight: 1.25 }}>{t.titulo}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, fontSize: 11, color: GRAY, fontWeight: 600 }}>
                            <span>{view === "recebidos" ? `De: ${t.autor_nome}` : `Para: ${t.destinatario_nome ?? "—"}`}</span>
                            <span style={{ marginLeft: "auto", color: GRAYL }}>{dt(t.criado_em)}</span>
                          </div>
                          {t.devolutiva && <div style={{ marginTop: 6, fontSize: 10.5, fontWeight: 800, color: "#0c447c", background: "#e8f1fb", border: "1px solid #cfe1f5", borderRadius: 100, padding: "1px 8px", display: "inline-block" }}>✓ com devolutiva</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {tDet && <DetalheModal t={tDet} recebido={tDet.destinatario_email === meEmail} onClose={() => setDetalheId(null)} onUpdate={atualizar} inputStyle={inputStyle} />}

      {modal && (
        <div onClick={() => !enviando && setModal(false)} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(17,29,51,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: "100%", background: SURF, borderRadius: 14, padding: 22, boxShadow: "0 24px 70px rgba(17,29,51,.4)" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: WINE, marginBottom: 14 }}>✉️ Criar card</div>
            <label style={{ fontSize: 11.5, fontWeight: 800, color: NAVY }}>Destinatário</label>
            <select value={dest} onChange={(e) => setDest(e.target.value)} style={{ ...inputStyle, marginTop: 4, marginBottom: 10, appearance: "auto" }}>
              <option value="">Escolha para quem enviar…</option>
              {usuarios.map((u) => <option key={u.email} value={u.email}>{u.nome}{u.papel ? ` (${u.papel})` : ""} — {u.email}</option>)}
            </select>
            <label style={{ fontSize: 11.5, fontWeight: 800, color: NAVY }}>Título</label>
            <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={160} placeholder="Assunto do card" style={{ ...inputStyle, marginTop: 4, marginBottom: 10, fontWeight: 700 }} />
            <label style={{ fontSize: 11.5, fontWeight: 800, color: NAVY }}>Texto</label>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={5000} rows={5} placeholder="Escreva a mensagem" style={{ ...inputStyle, marginTop: 4, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setModal(false)} disabled={enviando} style={{ marginLeft: "auto", padding: "8px 16px", fontSize: 13, fontWeight: 700, color: GRAY, background: SURF, border: `1px solid ${BORDER}`, borderRadius: 8, cursor: "pointer" }}>Cancelar</button>
              <button onClick={enviar} disabled={enviando} style={{ padding: "8px 18px", fontSize: 13, fontWeight: 800, color: "#fff", background: WINE, border: `1px solid ${WINE}`, borderRadius: 8, cursor: enviando ? "wait" : "pointer" }}>{enviando ? "Enviando…" : "Enviar card"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HomeCard({ emoji, titulo, desc, cor, badge, onClick }: { emoji: string; titulo: string; desc: string; cor: string; badge?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ textAlign: "left", background: SURF, border: `1px solid ${BORDER}`, borderTop: `4px solid ${cor}`, borderRadius: 14, padding: "18px 16px", cursor: "pointer", boxShadow: "0 6px 20px rgba(17,29,51,.10)", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 28, lineHeight: 1 }}>{emoji}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: NAVY, marginTop: 6 }}>{titulo}</div>
      <div style={{ fontSize: 12.5, color: GRAY, fontWeight: 500 }}>{desc}</div>
      {badge ? <div style={{ marginTop: 6, alignSelf: "flex-start", fontSize: 11, fontWeight: 800, color: "#fff", background: cor, borderRadius: 100, padding: "2px 10px" }}>{badge}</div> : null}
    </button>
  );
}

function DetalheModal({ t, recebido, onClose, onUpdate, inputStyle }: { t: Ticket; recebido: boolean; onClose: () => void; onUpdate: (id: string, patch: any) => Promise<boolean>; inputStyle: CSSProperties }) {
  const [dev, setDev] = useState(t.devolutiva ?? "");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setDev(t.devolutiva ?? ""); }, [t.id, t.devolutiva]);
  async function salvar(patch: any) { setSalvando(true); try { await onUpdate(t.id, patch); } finally { setSalvando(false); } }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 310, background: "rgba(17,29,51,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", background: SURF, borderRadius: 14, padding: 20, boxShadow: "0 24px 70px rgba(17,29,51,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: CORDE(t.status), borderRadius: 100, padding: "3px 11px" }}>{LABEL(t.status)}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: GRAY }}>{recebido ? `De: ${t.autor_nome}` : `Para: ${t.destinatario_nome ?? "—"}`}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", fontSize: 18, lineHeight: 1, color: GRAY, background: "transparent", border: "none", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: NAVY }}>{t.titulo}</div>
        {t.texto && <div style={{ fontSize: 13.5, color: "#2b3547", marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{t.texto}</div>}

        {t.devolutiva && (
          <div style={{ marginTop: 12, background: "#e8f1fb", border: "1px solid #9fc4e8", borderRadius: 8, padding: "9px 11px" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#0c447c", marginBottom: 2 }}>Devolutiva{t.responsavel_nome ? ` · ${t.responsavel_nome}` : ""}</div>
            <div style={{ fontSize: 13, color: NAVY, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{t.devolutiva}</div>
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "2px 14px", fontSize: 11, color: GRAY, fontWeight: 600 }}>
          <span>Abertura: {dt(t.criado_em)}</span>
          {t.andamento_em && <span>Andamento: {dt(t.andamento_em)}</span>}
          {t.resolvido_em && <span>Resolução: {dt(t.resolvido_em)}</span>}
        </div>
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${BORDER}`, fontSize: 12, color: GRAY, fontWeight: 600 }}>Assinatura: <b style={{ color: NAVY }}>{t.autor_nome}</b></div>

        {recebido && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: NAVY, marginBottom: 6 }}>Status</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {COLS.map((c) => (
                <button key={c.status} onClick={() => salvar({ status: c.status })} disabled={salvando} style={{ fontSize: 12, fontWeight: 800, padding: "6px 12px", borderRadius: 100, cursor: "pointer", color: t.status === c.status ? "#fff" : c.cor, background: t.status === c.status ? c.cor : SURF, border: `1.5px solid ${c.cor}` }}>{c.label}</button>
              ))}
            </div>
            <label style={{ fontSize: 11.5, fontWeight: 800, color: NAVY }}>Devolutiva (resposta / solução)</label>
            <textarea value={dev} onChange={(e) => setDev(e.target.value)} maxLength={5000} rows={4} placeholder="Escreva a resposta ao card" style={{ ...inputStyle, marginTop: 4, resize: "vertical" }} />
            <div style={{ display: "flex", marginTop: 10 }}>
              <button onClick={() => salvar({ devolutiva: dev })} disabled={salvando} style={{ marginLeft: "auto", padding: "8px 16px", fontSize: 13, fontWeight: 800, color: "#fff", background: WINE, border: `1px solid ${WINE}`, borderRadius: 8, cursor: salvando ? "wait" : "pointer" }}>{salvando ? "Salvando…" : "Salvar devolutiva"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
