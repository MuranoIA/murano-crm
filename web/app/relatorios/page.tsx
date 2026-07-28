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

// Catálogo de relatórios (extensível — novos relatórios entram aqui).
const RELATORIOS = [
  {
    id: "vendas-periodo",
    nome: "Clientes que compraram",
    desc: "Todos os clientes com pelo menos uma compra no período selecionado.",
  },
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

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const r = await fetch(`/api/relatorios/vendas-periodo?periodo=${periodo}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j?.error ?? `HTTP ${r.status}`); setDados(null); }
      else setDados(j);
    } catch (e: any) { setErro(e?.message ?? String(e)); setDados(null); }
    finally { setCarregando(false); }
  }, [periodo]);

  // carrega ao entrar (após saber a sessão) e sempre que trocar o período
  useEffect(() => { if (sessaoLoaded && sessao?.role) carregar(); }, [sessaoLoaded, sessao?.role, carregar]);

  async function baixar() {
    setBaixando(true);
    try {
      const r = await fetch(`/api/relatorios/vendas-periodo?periodo=${periodo}&format=xlsx`);
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert("Falha ao gerar Excel: " + (j?.error ?? `HTTP ${r.status}`)); return; }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `clientes_${periodo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e: any) { alert("Erro: " + (e?.message ?? e)); }
    finally { setBaixando(false); }
  }

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

  const rel = RELATORIOS.find((r) => r.id === sel)!;

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
                onClick={() => setSel(r.id)}
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
              <div style={{ background: "#faf4f7", border: `1px solid #ecdae4`, borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: GRAY, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Clientes</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: WINE }}>{dados.clientes.toLocaleString("pt-BR")}</div>
              </div>
              <div style={{ background: "#eef7f1", border: `1px solid #cbe6d5`, borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: GRAY, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Total no período</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#15803d" }}>{moeda(dados.totalGeral)}</div>
              </div>
              <div style={{ background: "#f4f6f9", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: GRAY, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Período</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{dados.periodoLabel}</div>
              </div>
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
                    {["Cliente", "Telefone", ...(veTudo ? ["Vendedor"] : []), "Pedidos", "Total", "Última compra"].map((h, i) => (
                      <th key={h} style={{ textAlign: i >= (veTudo ? 3 : 2) ? "right" : "left", position: "sticky", top: 0, background: "#f7f3f5", color: "#6b4257", fontWeight: 800, fontSize: 11.5, padding: "9px 12px", borderBottom: `2px solid ${BORDER}`, whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dados.linhas.length === 0 && (
                    <tr><td colSpan={veTudo ? 6 : 5} style={{ padding: 24, textAlign: "center", color: GRAY }}>Nenhum cliente comprou nesse período.</td></tr>
                  )}
                  {dados.linhas.map((c: any, idx: number) => (
                    <tr key={c.codcli + "-" + c.vendedor_slug} style={{ background: idx % 2 ? "#fbfafb" : "#fff" }}>
                      <td style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDER}`, fontWeight: 600 }}>{c.cliente}</td>
                      <td style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDER}`, color: GRAY, whiteSpace: "nowrap" }}>{telBR(c.telefone)}</td>
                      {veTudo && <td style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDER}`, textTransform: "capitalize" }}>{c.vendedor_slug ?? "—"}</td>}
                      <td style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDER}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.pedidos}</td>
                      <td style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDER}`, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{moeda(c.total)}</td>
                      <td style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDER}`, textAlign: "right", color: GRAY, whiteSpace: "nowrap" }}>{brData(c.ultima_compra)}</td>
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
