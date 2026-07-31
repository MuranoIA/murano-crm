"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";

// Tela de Tickets (chamados internos). 3 categorias em cards; cada uma permite abrir um
// ticket (card com título + texto). O autor e a data/hora ficam registrados. Admin vê
// todos, muda status (aberto/andamento/resolvido, com horários) e escreve a devolutiva.

const WINE = "#621244", ORANGE = "#dd4222", INK = "#241327", GRAY = "#6b5b69";
const BORDER = "#e7dbe5", BG = "#f5edf4", SURF = "#ffffff", MUTED = "#9a8098";

type Ticket = {
  id: string; categoria: string; titulo: string; texto: string;
  autor_nome: string; autor_email: string | null; status: "aberto" | "andamento" | "resolvido";
  responsavel_nome: string | null; devolutiva: string | null;
  criado_em: string; andamento_em: string | null; resolvido_em: string | null;
};

const CATS = [
  { key: "bugs", nome: "Correção de Bugs", emoji: "🐞", desc: "Reportar erros e problemas no sistema.", cor: "#c0392b" },
  { key: "feature", nome: "Novas Features", emoji: "✨", desc: "Solicitar novas funcionalidades.", cor: "#7b2d8b" },
  { key: "supervisor", nome: "Feedback ao Supervisor", emoji: "💬", desc: "Registrar feedbacks ao supervisor.", cor: "#185fa5" },
];
const ST: Record<string, { label: string; cor: string; bg: string }> = {
  aberto: { label: "Aberto", cor: "#a3401d", bg: "#faece7" },
  andamento: { label: "Em andamento", cor: "#0c447c", bg: "#e6f1fb" },
  resolvido: { label: "Resolvido", cor: "#27500a", bg: "#eaf3de" },
};

function dt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Belem", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<string | null>(null); // categoria com form aberto
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    fetch("/api/tickets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => { setTickets(j.tickets || []); setAdmin(!!j.admin); setErro(""); })
      .catch(() => setErro("Não foi possível carregar os tickets."))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function criar(cat: string) {
    if (titulo.trim().length < 3) { alert("Dê um título ao ticket (mín. 3 letras)."); return; }
    setSalvando(true);
    try {
      const r = await fetch("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoria: cat, titulo, texto }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert("Erro ao abrir ticket: " + (j?.error ?? r.status)); return; }
      setTitulo(""); setTexto(""); setAberto(null); carregar();
    } catch (e: any) { alert("Falha: " + (e?.message ?? e)); }
    finally { setSalvando(false); }
  }

  async function atualizar(id: string, patch: any) {
    const r = await fetch(`/api/tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert("Erro: " + (j?.error ?? r.status)); return false; }
    carregar();
    return true;
  }

  const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: 14, color: INK, border: `1px solid ${BORDER}`, borderRadius: 8, outline: "none", background: SURF, fontFamily: "inherit" };

  return (
    <div style={{ minHeight: "100vh", background: BG, color: INK, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: SURF, borderBottom: `1px solid ${BORDER}`, position: "sticky", top: 0, zIndex: 10 }}>
        <Link href="/" style={{ color: GRAY, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Voltar ao CRM</Link>
        <div style={{ fontSize: 18, fontWeight: 800, color: WINE }}>🎫 Tickets</div>
        {admin && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: ORANGE, border: `1px solid ${ORANGE}`, borderRadius: 100, padding: "2px 10px" }}>ADMIN · vê todos</span>}
      </div>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "18px 16px 60px" }}>
        <p style={{ color: GRAY, fontSize: 13.5, margin: "0 0 18px" }}>
          Abra um chamado numa das áreas abaixo. {admin ? "Como admin, você vê todos os tickets e pode responder (devolutiva), definir responsável e mudar o status." : "Você acompanha aqui os tickets que abrir, com o status e a devolutiva."}
        </p>
        {erro && <div style={{ background: "#faece7", border: "1px solid #f0997b", color: "#a3401d", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 16 }}>{erro}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
          {CATS.map((cat) => {
            const doCat = tickets.filter((t) => t.categoria === cat.key);
            const formAberto = aberto === cat.key;
            return (
              <section key={cat.key} style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 4px 18px rgba(36,19,39,.05)" }}>
                <div style={{ padding: "14px 16px", borderBottom: `1px solid ${BORDER}`, borderTop: `3px solid ${cat.cor}` }}>
                  <div style={{ fontSize: 15.5, fontWeight: 800, color: INK }}>{cat.emoji} {cat.nome}</div>
                  <div style={{ fontSize: 12.5, color: GRAY, marginTop: 2 }}>{cat.desc}</div>
                </div>

                <div style={{ padding: 14 }}>
                  {!formAberto ? (
                    <button onClick={() => { setAberto(cat.key); setTitulo(""); setTexto(""); }} style={{ width: "100%", padding: "10px 12px", fontSize: 13.5, fontWeight: 700, color: WINE, background: "#faf4f8", border: `1px dashed ${cat.cor}`, borderRadius: 10, cursor: "pointer" }}>
                      ＋ Criar ticket
                    </button>
                  ) : (
                    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 12, background: "#fbf7fa" }}>
                      <label style={{ fontSize: 11.5, fontWeight: 700, color: GRAY }}>Título</label>
                      <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={160} placeholder="Resuma o chamado" style={{ ...inputStyle, marginTop: 4, marginBottom: 8, fontWeight: 700 }} />
                      <label style={{ fontSize: 11.5, fontWeight: 700, color: GRAY }}>Descrição</label>
                      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={5000} rows={4} placeholder="Detalhe o que precisa" style={{ ...inputStyle, marginTop: 4, resize: "vertical" }} />
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={() => setAberto(null)} disabled={salvando} style={{ marginLeft: "auto", padding: "8px 14px", fontSize: 13, fontWeight: 600, color: GRAY, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, cursor: "pointer" }}>Cancelar</button>
                        <button onClick={() => criar(cat.key)} disabled={salvando} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "#fff", background: WINE, border: `1px solid ${WINE}`, borderRadius: 8, cursor: salvando ? "wait" : "pointer" }}>{salvando ? "Abrindo…" : "Abrir ticket"}</button>
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                    {loading ? (
                      <div style={{ fontSize: 13, color: MUTED, padding: "8px 0" }}>Carregando…</div>
                    ) : doCat.length === 0 ? (
                      <div style={{ fontSize: 13, color: MUTED, padding: "8px 0" }}>Nenhum ticket ainda.</div>
                    ) : doCat.map((t) => <TicketCard key={t.id} t={t} admin={admin} onUpdate={atualizar} inputStyle={inputStyle} />)}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TicketCard({ t, admin, onUpdate, inputStyle }: { t: Ticket; admin: boolean; onUpdate: (id: string, patch: any) => Promise<boolean>; inputStyle: CSSProperties }) {
  const st = ST[t.status] ?? ST.aberto;
  const [dev, setDev] = useState(t.devolutiva ?? "");
  const [resp, setResp] = useState(t.responsavel_nome ?? "");
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState(false);

  useEffect(() => { setDev(t.devolutiva ?? ""); setResp(t.responsavel_nome ?? ""); }, [t.devolutiva, t.responsavel_nome]);

  async function salvar(patch: any) { setSalvando(true); try { await onUpdate(t.id, patch); } finally { setSalvando(false); } }

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: 13, background: SURF }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: st.cor, background: st.bg, border: `1px solid ${st.cor}33`, borderRadius: 100, padding: "2px 10px" }}>{st.label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>{dt(t.criado_em)}</span>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>{t.titulo}</div>
      {t.texto && <div style={{ fontSize: 13, color: "#4a3a48", marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{t.texto}</div>}

      {t.devolutiva && (
        <div style={{ marginTop: 10, background: "#eaf3de", border: "1px solid #97c459", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#27500a", marginBottom: 2 }}>Devolutiva{t.responsavel_nome ? ` · ${t.responsavel_nome}` : ""}</div>
          <div style={{ fontSize: 13, color: "#173404", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{t.devolutiva}</div>
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "2px 14px", fontSize: 11, color: MUTED }}>
        <span>Abertura: {dt(t.criado_em)}</span>
        {t.andamento_em && <span>Andamento: {dt(t.andamento_em)}</span>}
        {t.resolvido_em && <span>Resolução: {dt(t.resolvido_em)}</span>}
        {t.responsavel_nome && <span>Responsável: {t.responsavel_nome}</span>}
      </div>

      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${BORDER}`, fontSize: 12, color: GRAY }}>
        Assinatura: <b style={{ color: INK }}>{t.autor_nome}</b>
      </div>

      {admin && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
          {!editando ? (
            <button onClick={() => setEditando(true)} style={{ fontSize: 12, fontWeight: 700, color: WINE, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>✎ Responder / gerenciar</button>
          ) : (
            <div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {(["aberto", "andamento", "resolvido"] as const).map((s) => (
                  <button key={s} onClick={() => salvar({ status: s })} disabled={salvando} style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 10px", borderRadius: 100, cursor: "pointer", color: t.status === s ? "#fff" : ST[s].cor, background: t.status === s ? ST[s].cor : ST[s].bg, border: `1px solid ${ST[s].cor}55` }}>{ST[s].label}</button>
                ))}
              </div>
              <label style={{ fontSize: 11, fontWeight: 700, color: GRAY }}>Responsável</label>
              <input value={resp} onChange={(e) => setResp(e.target.value)} maxLength={120} placeholder="Quem vai resolver" style={{ ...inputStyle, marginTop: 3, marginBottom: 8 }} />
              <label style={{ fontSize: 11, fontWeight: 700, color: GRAY }}>Devolutiva (resposta / solução)</label>
              <textarea value={dev} onChange={(e) => setDev(e.target.value)} maxLength={5000} rows={3} placeholder="Escreva a resposta ao ticket" style={{ ...inputStyle, marginTop: 3, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => setEditando(false)} disabled={salvando} style={{ marginLeft: "auto", padding: "7px 12px", fontSize: 12.5, fontWeight: 600, color: GRAY, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 8, cursor: "pointer" }}>Fechar</button>
                <button onClick={() => salvar({ devolutiva: dev, responsavel_nome: resp })} disabled={salvando} style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 700, color: "#fff", background: WINE, border: `1px solid ${WINE}`, borderRadius: 8, cursor: salvando ? "wait" : "pointer" }}>{salvando ? "Salvando…" : "Salvar devolutiva"}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
