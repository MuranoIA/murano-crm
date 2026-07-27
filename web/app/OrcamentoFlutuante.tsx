"use client";
import { useEffect, useMemo, useRef, useState } from "react";

// Janela FLUTUANTE de orçamento (arrastável), sobre o board — o vendedor vê o card do cliente
// e monta o orçamento na mesma tela. Preço+estoque do v2 via /api/orcamento (só leitura).
const C = {
  wine: "#57163f", cyan: "#0ea3dc", border: "#e6e0e4", navy: "#1f2937",
  gray: "#6b7280", grayLight: "#9aa1ab", surface: "#ffffff", bg: "#faf7f9",
  green: "#15803d", red: "#dc2626", amber: "#b45309",
};
type Camp = { nome: string; preco: number };
type Prod = { codprod: number; produto: string; marca: string | null; secao: string | null; preco: number; estoque: number | null; campanhas: Camp[] };
type Linha = Prod & { qtd: number; precoSel: number; campanhaSel: string | null };
const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function OrcamentoFlutuante({ onClose }: { onClose: () => void }) {
  const [produtos, setProdutos] = useState<Prod[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [copiado, setCopiado] = useState(false);
  const [pos, setPos] = useState({ x: 90, y: 84 });
  const txtRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    fetch("/api/orcamento")
      .then(async (r) => {
        if (r.status === 401) { setErro("Faça login primeiro."); return null; }
        const j = await r.json();
        if (!r.ok) { setErro(j?.error ?? "Falha ao carregar produtos"); return null; }
        return j;
      })
      .then((j) => { if (j?.produtos) setProdutos(j.produtos); })
      .catch((e) => setErro(String(e?.message ?? e)))
      .finally(() => setCarregando(false));
  }, []);

  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return [];
    return produtos.filter((p) => p.produto.toLowerCase().includes(q) || String(p.codprod).includes(q)).slice(0, 40);
  }, [busca, produtos]);
  const total = useMemo(() => linhas.reduce((s, l) => s + l.precoSel * l.qtd, 0), [linhas]);
  const totalItens = useMemo(() => linhas.reduce((s, l) => s + l.qtd, 0), [linhas]);
  const textoOrcamento = useMemo(() => {
    if (!linhas.length) return "";
    const itens = linhas.map((l, i) => `${i + 1}. ${l.produto}\n   ${l.qtd} x ${moeda(l.precoSel)}${l.campanhaSel ? ` (campanha ${l.campanhaSel})` : ""} = ${moeda(l.precoSel * l.qtd)}`).join("\n");
    return `*Orçamento — Murano Professional*\n\n${itens}\n\n*Total: ${moeda(total)}*  (${totalItens} un.)`;
  }, [linhas, total, totalItens]);

  const adicionar = (p: Prod) => setLinhas((prev) => {
    const i = prev.findIndex((l) => l.codprod === p.codprod);
    if (i >= 0) { const cp = [...prev]; cp[i] = { ...cp[i], qtd: cp[i].qtd + 1 }; return cp; }
    return [...prev, { ...p, qtd: 1, precoSel: p.preco, campanhaSel: null }];
  });
  // aplica preço de tabela ou de campanha à linha
  const aplicarPreco = (codprod: number, preco: number) => setLinhas((prev) => prev.map((l) => {
    if (l.codprod !== codprod) return l;
    const camp = (l.campanhas ?? []).find((c) => c.preco === preco);
    return { ...l, precoSel: preco, campanhaSel: camp ? camp.nome : null };
  }));
  const setQtd = (codprod: number, qtd: number) => setLinhas((prev) => prev.map((l) => (l.codprod === codprod ? { ...l, qtd: Math.max(1, qtd || 1) } : l)));
  const remover = (codprod: number) => setLinhas((prev) => prev.filter((l) => l.codprod !== codprod));

  const copiar = async () => {
    try { await navigator.clipboard.writeText(textoOrcamento); }
    catch { txtRef.current?.select(); try { document.execCommand("copy"); } catch {} }
    setCopiado(true); setTimeout(() => setCopiado(false), 1800);
  };

  const onDown = (e: { clientX: number; clientY: number }) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    const move = (ev: MouseEvent) => {
      if (!drag.current) return;
      const x = Math.max(-560, Math.min(ev.clientX - drag.current.dx, window.innerWidth - 60));
      const y = Math.max(0, Math.min(ev.clientY - drag.current.dy, window.innerHeight - 40));
      setPos({ x, y });
    };
    const up = () => { drag.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const estoqueTxt = (e: number | null) => (e == null ? "—" : String(e));
  const estoqueCor = (e: number | null) => (e == null ? C.grayLight : e <= 0 ? C.red : e < 5 ? C.amber : C.green);

  return (
    <div style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 400, width: 620, maxWidth: "94vw", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: "0 24px 70px rgba(16,32,64,.34)", display: "flex", flexDirection: "column", maxHeight: "82vh" }}>
      {/* cabeçalho = alça de arrastar */}
      <div onMouseDown={onDown} style={{ cursor: "move", userSelect: "none", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: C.wine, color: "#fff", borderRadius: "14px 14px 0 0" }}>
        <span style={{ fontSize: 14, fontWeight: 800 }}>🧮 Orçamento</span>
        <span style={{ fontSize: 10.5, opacity: 0.7 }}>arraste para mover</span>
        <button onClick={onClose} onMouseDown={(e) => e.stopPropagation()} title="Fechar" style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#fff", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
      </div>

      <div style={{ overflowY: "auto", padding: 14 }}>
        <input
          autoFocus
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="🔍  Buscar produto por nome ou código…"
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", fontSize: 13.5, color: C.navy, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, outline: "none" }}
        />
        <div style={{ marginTop: 5, fontSize: 11, color: C.grayLight }}>
          {carregando ? "Carregando produtos…" : erro ? <span style={{ color: C.red }}>{erro}</span> : `${produtos.length} produtos na tabela de preços`}
        </div>

        {/* resultados da busca */}
        {resultados.length > 0 && (
          <div style={{ marginTop: 8, maxHeight: 190, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5, border: `1px solid ${C.border}`, borderRadius: 10, padding: 6, background: C.bg }}>
            {resultados.map((p) => (
              <button key={p.codprod} onClick={() => adicionar(p)} title="Adicionar ao orçamento"
                style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", textAlign: "left", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", cursor: "pointer" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.produto}</div>
                  <div style={{ fontSize: 10.5, color: C.grayLight }}>#{p.codprod}{p.marca ? " · " + p.marca : ""} · estoque <b style={{ color: estoqueCor(p.estoque) }}>{estoqueTxt(p.estoque)}</b>{(p.campanhas ?? []).length > 0 && <span style={{ color: C.green, fontWeight: 700 }}> · 🏷️ {(p.campanhas ?? []).length === 1 ? "campanha" : (p.campanhas ?? []).length + " campanhas"}</span>}</div>
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.wine }}>{moeda(p.preco)}</div>
                  <div style={{ fontSize: 10, color: C.cyan, fontWeight: 700 }}>+ adicionar</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* linhas do orçamento */}
        <div style={{ marginTop: 12, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <b style={{ fontSize: 13.5, color: C.wine }}>Itens</b>
          <span style={{ fontSize: 11, color: C.grayLight }}>{linhas.length} {linhas.length === 1 ? "item" : "itens"} · {totalItens} un.</span>
        </div>
        {linhas.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.grayLight, padding: "14px 4px", textAlign: "center" }}>Busque e clique num produto para adicionar.</div>
        ) : (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
            {linhas.map((l) => {
              const excede = l.estoque != null && l.qtd > l.estoque;
              return (
                <div key={l.codprod} style={{ display: "grid", gridTemplateColumns: "1fr 74px 74px 84px 24px", gap: 6, alignItems: "center", borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.produto}</div>
                    <div style={{ fontSize: 10, color: excede ? C.red : C.grayLight, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                      <span>estoque <b style={{ color: estoqueCor(l.estoque) }}>{estoqueTxt(l.estoque)}</b>{excede ? " · acima!" : ""}</span>
                      {(l.campanhas ?? []).length > 0 && (
                        <select value={l.precoSel} onChange={(e) => aplicarPreco(l.codprod, Number(e.target.value))} title="Preço de tabela ou de campanha"
                          style={{ fontSize: 10, color: l.campanhaSel ? C.green : C.gray, fontWeight: 700, border: `1px solid ${l.campanhaSel ? C.green : C.border}`, borderRadius: 5, padding: "1px 4px", background: l.campanhaSel ? "#eafaf0" : C.surface, outline: "none", cursor: "pointer", maxWidth: 160 }}>
                          <option value={l.preco}>Tabela {moeda(l.preco)}</option>
                          {(l.campanhas ?? []).map((c, i) => <option key={i} value={c.preco}>🏷️ {moeda(c.preco)} · {c.nome}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, color: l.campanhaSel ? C.green : C.navy }}>
                    {moeda(l.precoSel)}
                    {l.campanhaSel && l.precoSel !== l.preco && <div style={{ fontSize: 9, color: C.grayLight, textDecoration: "line-through" }}>{moeda(l.preco)}</div>}
                  </div>
                  <input type="number" min={1} value={l.qtd} onChange={(e) => setQtd(l.codprod, parseInt(e.target.value, 10))}
                    style={{ width: "100%", boxSizing: "border-box", textAlign: "center", padding: "5px 2px", fontSize: 12.5, fontWeight: 700, color: C.navy, border: `1px solid ${excede ? C.red : C.border}`, borderRadius: 6, outline: "none" }} />
                  <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 800, color: C.wine }}>{moeda(l.precoSel * l.qtd)}</div>
                  <button onClick={() => remover(l.codprod)} title="Remover" style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.gray, cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 12, borderTop: `2px solid ${C.wine}`, paddingTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gray }}>Total do orçamento</span>
          <b style={{ fontSize: 20, color: C.wine }}>{moeda(total)}</b>
        </div>

        {linhas.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.gray }}>📋 Texto para o cliente</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setLinhas([])} style={{ fontSize: 12, fontWeight: 600, color: C.gray, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>Limpar</button>
                <button onClick={copiar} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: copiado ? C.green : C.cyan, border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>{copiado ? "Copiado ✓" : "Copiar"}</button>
              </div>
            </div>
            <textarea ref={txtRef} readOnly value={textoOrcamento} onFocus={(e) => e.currentTarget.select()} rows={Math.min(12, linhas.length * 2 + 4)}
              style={{ width: "100%", boxSizing: "border-box", fontSize: 12, lineHeight: 1.5, color: C.navy, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 11px", outline: "none", resize: "vertical", fontFamily: "inherit" }} />
          </div>
        )}
      </div>
    </div>
  );
}
