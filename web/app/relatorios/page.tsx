"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const WINE = "#57163f", CYAN = "#0ea3dc", INK = "#142138", GRAY = "#7d8695", BORDER = "#e6e0e6", SURF = "#ffffff", BG = "#efe9ed";

const PERIODOS = [
  { k: "hoje", label: "Hoje" },
  { k: "ontem", label: "Ontem" },
  { k: "semana", label: "7 dias" },
  { k: "quinzena", label: "15 dias" },
  { k: "mes", label: "Mês" },
  { k: "todos", label: "Todos" },
];

const moeda = (n: number) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brData = (d: any) => {
  if (!d) return "—";
  const s = String(d).slice(0, 10); const [y, m, dd] = s.split("-");
  return y && m && dd ? `${dd}/${m}/${y}` : s;
};
const telBR = (t: any) => {
  const d = String(t ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(t ?? "—");
};
const cap = (s: any) => { const v = String(s ?? ""); return v ? v.charAt(0).toUpperCase() + v.slice(1) : "—"; };
const num = (n: any) => (n == null ? "—" : Number(n).toLocaleString("pt-BR"));

type Col = { k: string; h: string; kind?: "text" | "tel" | "money" | "date" | "num" | "cap"; align?: "left" | "right"; adminOnly?: boolean };
type Resumo = { k: string; label: string; kind?: "int" | "money" | "raw"; cor?: string };
type Rel = { id: string; nome: string; desc: string; endpoint: string; baixaNome: string; vazio: string; temPeriodo?: boolean; cols: Col[]; resumo: Resumo[] };

// Catálogo de relatórios (extensível — novos relatórios entram aqui).
const RELATORIOS: Rel[] = [
  {
    id: "vendas-periodo",
    nome: "Clientes que compraram",
    desc: "Todos os clientes com pelo menos uma compra no período selecionado.",
    endpoint: "vendas-periodo",
    baixaNome: "clientes",
    vazio: "Nenhum cliente comprou nesse período.",
    cols: [
      { k: "cliente", h: "Cliente" },
      { k: "telefone", h: "Telefone", kind: "tel" },
      { k: "vendedor_slug", h: "Vendedor", kind: "cap", adminOnly: true },
      { k: "pedidos", h: "Pedidos", kind: "num", align: "right" },
      { k: "total", h: "Total", kind: "money", align: "right" },
      { k: "ultima_compra", h: "Última compra", kind: "date", align: "right" },
    ],
    resumo: [
      { k: "clientes", label: "Clientes", kind: "int", cor: WINE },
      { k: "totalGeral", label: "Total no período", kind: "money", cor: "#15803d" },
      { k: "periodoLabel", label: "Período", kind: "raw" },
    ],
  },
  {
    id: "sem-comprar",
    nome: "Clientes sem comprar",
    desc: "Clientes da carteira SEM nenhuma compra no período — ordenados do mais tempo parado.",
    endpoint: "sem-comprar",
    baixaNome: "clientes_sem_comprar",
    vazio: "Todos os clientes da carteira compraram nesse período.",
    cols: [
      { k: "cliente", h: "Cliente" },
      { k: "telefone", h: "Telefone", kind: "tel" },
      { k: "local", h: "Cidade/UF" },
      { k: "vendedor_slug", h: "Vendedor", kind: "cap", adminOnly: true },
      { k: "ultima_compra", h: "Última compra", kind: "date", align: "right" },
      { k: "dias_sem_comprar", h: "Dias s/ comprar", kind: "num", align: "right" },
    ],
    resumo: [
      { k: "clientes", label: "Sem compra", kind: "int", cor: WINE },
      { k: "periodoLabel", label: "Período", kind: "raw" },
    ],
  },
  {
    id: "mosqueiro",
    nome: "Clientes de Mosqueiro",
    desc: "Clientes de Mosqueiro (cidade, bairro ou endereço) na carteira, com última compra e tempo sem comprar.",
    endpoint: "mosqueiro",
    baixaNome: "clientes_mosqueiro",
    vazio: "Nenhum cliente de Mosqueiro na carteira.",
    temPeriodo: false,
    cols: [
      { k: "cliente", h: "Cliente" },
      { k: "telefone", h: "Telefone", kind: "tel" },
      { k: "bairro", h: "Bairro" },
      { k: "cidade", h: "Cidade" },
      { k: "vendedor_slug", h: "Vendedor", kind: "cap", adminOnly: true },
      { k: "ultima_compra", h: "Última compra", kind: "date", align: "right" },
      { k: "dias_sem_comprar", h: "Dias s/ comprar", kind: "num", align: "right" },
    ],
    resumo: [
      { k: "clientes", label: "Clientes em Mosqueiro", kind: "int", cor: WINE },
      { k: "periodoLabel", label: "Filtro", kind: "raw" },
    ],
  },
  {
    id: "santa-barbara",
    nome: "Clientes de Santa Bárbara",
    desc: "Clientes de Santa Bárbara (município) na carteira, com última compra e tempo sem comprar.",
    endpoint: "santa-barbara",
    baixaNome: "clientes_santa_barbara",
    vazio: "Nenhum cliente de Santa Bárbara na carteira.",
    temPeriodo: false,
    cols: [
      { k: "cliente", h: "Cliente" },
      { k: "telefone", h: "Telefone", kind: "tel" },
      { k: "bairro", h: "Bairro" },
      { k: "cidade", h: "Cidade" },
      { k: "vendedor_slug", h: "Vendedor", kind: "cap", adminOnly: true },
      { k: "ultima_compra", h: "Última compra", kind: "date", align: "right" },
      { k: "dias_sem_comprar", h: "Dias s/ comprar", kind: "num", align: "right" },
    ],
    resumo: [
      { k: "clientes", label: "Clientes em Santa Bárbara", kind: "int", cor: WINE },
      { k: "periodoLabel", label: "Filtro", kind: "raw" },
    ],
  },
];

const fmtCel = (c: Col, v: any) => {
  switch (c.kind) {
    case "tel": return telBR(v);
    case "money": return moeda(v);
    case "date": return brData(v);
    case "num": return num(v);
    case "cap": return cap(v);
    default: return v ?? "—";
  }
};

export default function Relatorios() {
  const [sessao, setSessao] = useState<{ role?: string; carteira?: string | null } | null>(null);
  const [sessaoLoaded, setSessaoLoaded] = useState(false);
  const [sel, setSel] = useState("vendas-periodo");
  const [periodo, setPeriodo] = useState("mes");
  const [dados, setDados] = useState<any | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSessao(j))
      .catch(() => setSessao(null))
      .finally(() => setSessaoLoaded(true));
  }, []);

  const veTudo = sessao?.role === "admin" || sessao?.role === "home";
  const rel = RELATORIOS.find((r) => r.id === sel)!;

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const qs = rel.temPeriodo === false ? "" : `?periodo=${periodo}`;
      const r = await fetch(`/api/relatorios/${rel.endpoint}${qs}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j?.error ?? `HTTP ${r.status}`); setDados(null); }
      else setDados(j);
    } catch (e: any) { setErro(e?.message ?? String(e)); setDados(null); }
    finally { setCarregando(false); }
  }, [periodo, rel.endpoint]);

  // carrega ao entrar (após saber a sessão), ao trocar o período OU ao trocar de relatório
  useEffect(() => { if (sessaoLoaded && sessao?.role) carregar(); }, [sessaoLoaded, sessao?.role, carregar]);

  async function baixar() {
    setBaixando(true);
    try {
      const qs = rel.temPeriodo === false ? "?format=xlsx" : `?periodo=${periodo}&format=xlsx`;
      const r = await fetch(`/api/relatorios/${rel.endpoint}${qs}`);
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert("Falha ao gerar Excel: " + (j?.error ?? `HTTP ${r.status}`)); return; }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const sufPeriodo = rel.temPeriodo === false ? "" : `${periodo}_`;
      a.download = `${rel.baixaNome}_${sufPeriodo}${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e: any) { alert("Erro: " + (e?.message ?? e)); }
    finally { setBaixando(false); }
  }

  const resumoVal = (rz: Resumo) => {
    const v = dados?.[rz.k];
    if (rz.kind === "money") return moeda(v);
    if (rz.kind === "int") return Number(v || 0).toLocaleString("pt-BR");
    return v ?? "—";
  };

  const colsVis = rel.cols.filter((c) => !c.adminOnly || veTudo);

  // ---- não autenticado ----
  if (sessaoLoaded && !sessao?.role) {
    return (
      <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: INK }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Relatórios</div>
        <div style={{ color: GRAY, fontSize: 14 }}>Você precisa entrar para ver os relatórios.</div>
        <Link href="/" style={{ color: CYAN, fontSize: 14, textDecoration: "none" }}>← ir para o login</Link>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: BG, color: INK, fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", background: SURF, borderBottom: `1px solid ${BORDER}` }}>
        <Link href="/" style={{ color: GRAY, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Funil</Link>
        <div style={{ fontSize: 18, fontWeight: 800, color: WINE }}>Relatórios</div>
        {dados?.escopo && <div style={{ marginLeft: "auto", fontSize: 12, color: GRAY }}>{dados.escopo}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 18, padding: 18, flexWrap: "wrap" }}>
        {/* lista de relatórios (extensível) */}
        <aside style={{ flex: "0 0 230px", minWidth: 200, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: GRAY, textTransform: "uppercase", padding: "0 4px" }}>Relatórios</div>
          {RELATORIOS.map((r) => {
            const on = r.id === sel;
            return (
              <button
                key={r.id}
                onClick={() => { setSel(r.id); setDados(null); setErro(null); }}
                style={{
                  textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                  background: on ? "#fbeef4" : SURF, border: `1px solid ${on ? "#e2c7d3" : BORDER}`,
                  borderLeft: `3px solid ${on ? WINE : "transparent"}`, borderRadius: 8, padding: "10px 12px",
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 700, color: on ? WINE : INK }}>{r.nome}</div>
                <div style={{ fontSize: 11.5, color: GRAY, marginTop: 2, lineHeight: 1.35 }}>{r.desc}</div>
              </button>
            );
          })}
        </aside>

        {/* painel do relatório */}
        <main style={{ flex: "1 1 640px", minWidth: 320, background: SURF, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, boxShadow: "0 1px 2px rgba(16,32,64,0.05)" }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{rel.nome}</div>
          <div style={{ fontSize: 13, color: GRAY, marginTop: 2 }}>{rel.desc}</div>

          {/* controles */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            {rel.temPeriodo !== false && (
              <>
                <span style={{ fontSize: 12, fontWeight: 700, color: GRAY }}>Período:</span>
                {PERIODOS.map((p) => {
                  const on = p.k === periodo;
                  return (
                    <button
                      key={p.k}
                      onClick={() => setPeriodo(p.k)}
                      style={{
                        cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                        padding: "5px 12px", borderRadius: 999,
                        background: on ? WINE : "#f4eef1", color: on ? "#fff" : "#6b4257",
                        border: `1px solid ${on ? WINE : "#e6d6df"}`,
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                onClick={carregar}
                disabled={carregando}
                style={{ cursor: carregando ? "wait" : "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8, background: "#eef6fb", color: "#0b6f96", border: "1px solid #bfe1f2" }}
              >
                {carregando ? "Carregando…" : "↻ Atualizar"}
              </button>
              <button
                onClick={baixar}
                disabled={baixando || !dados?.linhas?.length}
                title="Baixar em Excel (.xlsx)"
                style={{ cursor: baixando ? "wait" : "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, padding: "6px 14px", borderRadius: 8, background: dados?.linhas?.length ? "#1d7a43" : "#c9cfc9", color: "#fff", border: "none" }}
              >
                {baixando ? "Gerando…" : "⬇ Excel"}
              </button>
            </div>
          </div>

          {/* resumo */}
          {dados && !erro && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              {rel.resumo.map((rz) => (
                <div key={rz.k} style={{ background: "#faf4f7", border: `1px solid #ecdae4`, borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ fontSize: 11, color: GRAY, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{rz.label}</div>
                  <div style={{ fontSize: rz.kind === "raw" ? 15 : 20, fontWeight: 800, color: rz.cor ?? INK, marginTop: rz.kind === "raw" ? 4 : 0 }}>{resumoVal(rz)}</div>
                </div>
              ))}
            </div>
          )}

          {erro && (
            <div style={{ marginTop: 14, background: "#fdeceb", border: "1px solid #f3c4bf", color: "#a4271a", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
              {erro}
            </div>
          )}

          {/* tabela */}
          {dados && !erro && (
            <div style={{ marginTop: 14, overflowX: "auto", border: `1px solid ${BORDER}`, borderRadius: 10 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620, fontSize: 13 }}>
                <thead>
                  <tr>
                    {colsVis.map((c) => (
                      <th key={c.k} style={{ textAlign: c.align === "right" ? "right" : "left", position: "sticky", top: 0, background: "#f7f3f5", color: "#6b4257", fontWeight: 800, fontSize: 11.5, padding: "9px 12px", borderBottom: `2px solid ${BORDER}`, whiteSpace: "nowrap" }}>
                        {c.h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dados.linhas.length === 0 && (
                    <tr><td colSpan={colsVis.length} style={{ padding: 24, textAlign: "center", color: GRAY }}>{rel.vazio}</td></tr>
                  )}
                  {dados.linhas.map((row: any, idx: number) => (
                    <tr key={(row.codcli ?? idx) + "-" + (row.vendedor_slug ?? "")} style={{ background: idx % 2 ? "#fbfafb" : "#fff" }}>
                      {colsVis.map((c) => (
                        <td key={c.k} style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDER}`, textAlign: c.align === "right" ? "right" : "left", whiteSpace: c.kind === "text" ? "normal" : "nowrap", fontWeight: c.k === "cliente" ? 600 : (c.kind === "money" ? 700 : 400), color: c.kind === "date" || c.k === "telefone" ? GRAY : INK, textTransform: c.kind === "cap" ? "capitalize" : "none", fontVariantNumeric: c.kind === "num" || c.kind === "money" ? "tabular-nums" : "normal" }}>
                          {fmtCel(c, row[c.k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!dados && !erro && carregando && (
            <div style={{ marginTop: 20, color: GRAY, fontSize: 14 }}>Carregando…</div>
          )}
        </main>
      </div>
    </div>
  );
}
