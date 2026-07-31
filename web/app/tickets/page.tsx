"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";

// Tickets = "cards" no estilo de uma caixa de e-mail, IGUAL para todos (vendedor/home/admin).
// 3 ações: Criar card (modal com destinatário + título + texto), Recebidos e Enviados.
// Cada card tem status (aberto/andamento/resolvido, com horários) e devolutiva — quem RECEBE
// gerencia. Paleta do CRM: navy / púrpura(wine) / azul / cinzas / branco.

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

const ST: Record<string, { label: string; cor: string }> = {
  aberto: { label: "Aberto", cor: "#475569" },
  andamento: { label: "Em andamento", cor: "#155e9c" },
  resolvido: { label: "Resolvido", cor: WINE },
};

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
    if (!r.ok) { alert("Erro: " + (j?.error ?? r.status)); return false; }
    carregar(); return true;
  }

  const recebidos = useMemo(() => tickets.filter((t) => t.destinatario_email === meEmail), [tickets, meEmail]);
  const enviados = useMemo(() => tickets.filter((t) => t.autor_email === meEmail), [tickets, meEmail]);
  const abertosReceb = recebidos.filter((t) => t.status !== "resolvido").length;

  const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, color: NAVY, border: `1px solid ${BORDER}`, borderRadius: 8, outline: "none", background: PANEL, fontFamily: "inherit" };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: NAVY, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: SURF, borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, zIndex: 10 }}>
        <Link href="/" style={{ color: GRAY, textDecoration: "none", fontSize: 13, fontWeight: 700 }}>← Voltar ao CRM</Link>
        <div style={{ fontSize: 18, fontWeight: 800, color: WINE }}>🎫 Tickets</div>
        {view !== "home" && <button onClick={() => setView("home")} style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 700, color: GRAY, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}>← Início</button>}
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "20px 16px 60px" }}>
        {erro && <div style={{ background: "#fbe9e9", border: "1px solid #e2a4a4", color: "#8a1f1f", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 16, fontWeight: 600 }}>{erro}</div>}

        {view === "home" && (
          <>
            <p style={{ color: GRAY, fontSize: 13.5, margin: "0 0 18px", fontWeight: 500 }}>Envie e receba cards como numa caixa de e-mail. Escolha o destinatário, acompanhe o status e responda com a devolutiva.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
              <HomeCard emoji="✉️" titulo="Criar card" desc="Enviar um novo card" cor={WINE} onClick={abrirCriar} />
              <HomeCard emoji="📥" titulo="Recebidos" desc="Cards enviados a você" cor={CYAN} badge={abertosReceb ? `${abertosReceb} em aberto` : (recebidos.length ? `${recebidos.length}` : "")} onClick={() => setView("recebidos")} />
              <HomeCard emoji="📤" titulo="Enviados" desc="Cards que você enviou" cor="#475569" badge={enviados.length ? `${enviados.length}` : ""} onClick={() => setView("enviados")} />
            </div>
          </>
        )}

        {(view === "recebidos" || view === "enviados") && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 14px" }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: NAVY }}>{view === "recebidos" ? "📥 Recebidos" : "📤 Enviados"}</div>
              {view === "enviados" && <button onClick={abrirCriar} style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: "#fff", background: WINE, border: `1px solid ${WINE}`, borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>✉️ Criar card</button>}
            </div>
            <div style={{ background: COL, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 14, minHeight: 120 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {loading ? (
                  <div style={{ fontSize: 13, color: GRAYL, fontWeight: 500, padding: "6px 2px" }}>Carregando…</div>
                ) : (view === "recebidos" ? recebidos : enviados).length === 0 ? (
                  <div style={{ fontSize: 13, color: GRAYL, fontWeight: 500, padding: "6px 2px" }}>{view === "recebidos" ? "Nenhum card recebido." : "Você ainda não enviou cards."}</div>
                ) : (view === "recebidos" ? recebidos : enviados).map((t) => (
                  <CardTicket key={t.id} t={t} recebido={view === "recebidos"} onUpdate={atualizar} inputStyle={inputStyle} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

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

function CardTicket({ t, recebido, onUpdate, inputStyle }: { t: Ticket; recebido: boolean; onUpdate: (id: string, patch: any) => Promise<boolean>; inputStyle: CSSProperties }) {
  const st = ST[t.status] ?? ST.aberto;
  const [dev, setDev] = useState(t.devolutiva ?? "");
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState(false);
  useEffect(() => { setDev(t.devolutiva ?? ""); }, [t.devolutiva]);
  async function salvar(patch: any) { setSalvando(true); try { await onUpdate(t.id, patch); } finally { setSalvando(false); } }

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderLeft: `4px solid ${st.cor}`, borderRadius: 12, padding: 13, background: SURF, boxShadow: "0 2px 8px rgba(17,29,51,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: st.cor, borderRadius: 100, padding: "3px 11px", letterSpacing: ".02em" }}>{st.label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: GRAY }}>{recebido ? `De: ${t.autor_nome}` : `Para: ${t.destinatario_nome ?? "—"}`}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: GRAYL, fontWeight: 600 }}>{dt(t.criado_em)}</span>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: NAVY }}>{t.titulo}</div>
      {t.texto && <div style={{ fontSize: 13, color: "#2b3547", marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{t.texto}</div>}

      {t.devolutiva && (
        <div style={{ marginTop: 10, background: "#e8f1fb", border: "1px solid #9fc4e8", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#0c447c", marginBottom: 2 }}>Devolutiva{t.responsavel_nome ? ` · ${t.responsavel_nome}` : ""}</div>
          <div style={{ fontSize: 13, color: NAVY, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{t.devolutiva}</div>
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "2px 14px", fontSize: 11, color: GRAY, fontWeight: 600 }}>
        <span>Abertura: {dt(t.criado_em)}</span>
        {t.andamento_em && <span>Andamento: {dt(t.andamento_em)}</span>}
        {t.resolvido_em && <span>Resolução: {dt(t.resolvido_em)}</span>}
      </div>

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${BORDER}`, fontSize: 12, color: GRAY, fontWeight: 600 }}>
        Assinatura: <b style={{ color: NAVY }}>{t.autor_nome}</b>
      </div>

      {recebido && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
          {!editando ? (
            <button onClick={() => setEditando(true)} style={{ fontSize: 12, fontWeight: 800, color: WINE, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>✎ Responder / gerenciar</button>
          ) : (
            <div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {(["aberto", "andamento", "resolvido"] as const).map((s) => (
                  <button key={s} onClick={() => salvar({ status: s })} disabled={salvando} style={{ fontSize: 11.5, fontWeight: 800, padding: "5px 11px", borderRadius: 100, cursor: "pointer", color: t.status === s ? "#fff" : ST[s].cor, background: t.status === s ? ST[s].cor : SURF, border: `1.5px solid ${ST[s].cor}` }}>{ST[s].label}</button>
                ))}
              </div>
              <label style={{ fontSize: 11, fontWeight: 800, color: NAVY }}>Devolutiva (resposta / solução)</label>
              <textarea value={dev} onChange={(e) => setDev(e.target.value)} maxLength={5000} rows={3} placeholder="Escreva a resposta ao card" style={{ ...inputStyle, marginTop: 3, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => setEditando(false)} disabled={salvando} style={{ marginLeft: "auto", padding: "7px 12px", fontSize: 12.5, fontWeight: 700, color: GRAY, background: SURF, border: `1px solid ${BORDER}`, borderRadius: 8, cursor: "pointer" }}>Fechar</button>
                <button onClick={() => salvar({ devolutiva: dev })} disabled={salvando} style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 800, color: "#fff", background: WINE, border: `1px solid ${WINE}`, borderRadius: 8, cursor: salvando ? "wait" : "pointer" }}>{salvando ? "Salvando…" : "Salvar devolutiva"}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
