"use client";
import { useEffect, useMemo, useRef, useState } from "react";

// Construtor de orçamento: busca produto -> preço de tabela + estoque (v2/WinThor via /api/orcamento),
// escolhe quantidade, vê subtotal e total. Só leitura; nada é gravado.
const C = {
  wine: "#57163f", wineSoft: "#f7eef3", cyan: "#0ea3dc", cyanSoft: "#eaf6fd",
  border: "#e6e0e4", navy: "#1f2937", gray: "#6b7280", grayLight: "#9aa1ab",
  surface: "#ffffff", bg: "#faf7f9", green: "#15803d", red: "#dc2626", amber: "#b45309",
};
type Prod = { codprod: number; produto: string; marca: string | null; secao: string | null; preco: number; estoque: number | null };
type Linha = Prod & { qtd: number };

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function Orcamento() {
  const [produtos, setProdutos] = useState<Prod[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [copiado, setCopiado] = useState(false);
  const txtRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/orcamento")
      .then(async (r) => {
        if (r.status === 401) { setErro("Faça login no funil primeiro."); return null; }
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
    return produtos.filter((p) => p.produto.toLowerCase().includes(q) || String(p.codprod).includes(q)).slice(0, 60);
  }, [busca, produtos]);

  const total = useMemo(() => linhas.reduce((s, l) => s + l.preco * l.qtd, 0), [linhas]);
  const totalItens = useMemo(() => linhas.reduce((s, l) => s + l.qtd, 0), [linhas]);

  // texto pronto p/ colar no chat do cliente (formatação amigável ao WhatsApp)
  const textoOrcamento = useMemo(() => {
    if (!linhas.length) return "";
    const itens = linhas.map((l) => `*${l.produto}*\n${l.qtd} x ${moeda(l.preco)} = *${moeda(l.preco * l.qtd)}*`).join("\n");
    return `*Orçamento — Murano Professional*\n\n${itens}\n*TOTAL: ${moeda(total)}* (${totalItens} un.)`;
  }, [linhas, total, totalItens]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(textoOrcamento);
    } catch {
      // fallback: seleciona o textarea e copia via execCommand
      txtRef.current?.select();
      try { document.execCommand("copy"); } catch { /* sem clipboard: usuário copia manual */ }
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  };

  const adicionar = (p: Prod) => {
    setLinhas((prev) => {
      const i = prev.findIndex((l) => l.codprod === p.codprod);
      if (i >= 0) { const cp = [...prev]; cp[i] = { ...cp[i], qtd: cp[i].qtd + 1 }; return cp; }
      return [...prev, { ...p, qtd: 1 }];
    });
  };
  const setQtd = (codprod: number, qtd: number) =>
    setLinhas((prev) => prev.map((l) => (l.codprod === codprod ? { ...l, qtd: Math.max(1, qtd || 1) } : l)));
  const remover = (codprod: number) => setLinhas((prev) => prev.filter((l) => l.codprod !== codprod));

  const estoqueTxt = (e: number | null) => (e == null ? "—" : String(e));
  const estoqueCor = (e: number | null) => (e == null ? C.grayLight : e <= 0 ? C.red : e < 5 ? C.amber : C.green);

  const inputStyle = { padding: "10px 12px", fontSize: 14, color: C.navy, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, outline: "none" } as const;

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <div style={{ height: 3, background: C.wine }} />
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 26px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", minHeight: 56, display: "flex", alignItems: "center", gap: 14 }}>
          <b style={{ fontSize: 16, color: C.navy }}>Murano CRM</b>
          <span style={{ color: C.cyan, fontWeight: 700, fontSize: 14 }}>Orçamento</span>
          <a href="/" style={{ marginLeft: "auto", color: C.gray, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>← Voltar ao funil</a>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 26px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)", gap: 22, alignItems: "start" }}>
        {/* Busca de produtos */}
        <div>
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="🔍  Buscar produto por nome ou código…"
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
          />
          <div style={{ marginTop: 6, fontSize: 12, color: C.grayLight }}>
            {carregando ? "Carregando produtos…" : erro ? <span style={{ color: C.red }}>{erro}</span> : `${produtos.length} produtos na tabela de preços`}
          </div>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {resultados.map((p) => (
              <button
                key={p.codprod}
                onClick={() => adicionar(p)}
                title="Adicionar ao orçamento"
                style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", textAlign: "left", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.produto}</div>
                  <div style={{ fontSize: 11, color: C.grayLight }}>
                    #{p.codprod}{p.marca ? " · " + p.marca : ""} · estoque <b style={{ color: estoqueCor(p.estoque) }}>{estoqueTxt(p.estoque)}</b>
                  </div>
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.wine }}>{moeda(p.preco)}</div>
                  <div style={{ fontSize: 10.5, color: C.cyan, fontWeight: 700 }}>+ adicionar</div>
                </div>
              </button>
            ))}
            {busca.trim() && !carregando && resultados.length === 0 && (
              <div style={{ fontSize: 13, color: C.grayLight, padding: 8 }}>Nenhum produto encontrado.</div>
            )}
            {!busca.trim() && !carregando && !erro && (
              <div style={{ fontSize: 13, color: C.grayLight, padding: 8 }}>Digite acima para buscar um produto.</div>
            )}
          </div>
        </div>

        {/* Orçamento */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, boxShadow: "0 1px 3px rgba(16,32,64,.05)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <b style={{ fontSize: 15, color: C.wine }}>Orçamento</b>
            <span style={{ fontSize: 12, color: C.grayLight }}>{linhas.length} {linhas.length === 1 ? "item" : "itens"} · {totalItens} un.</span>
          </div>

          {linhas.length === 0 ? (
            <div style={{ fontSize: 13, color: C.grayLight, padding: "24px 8px", textAlign: "center" }}>Nenhum produto no orçamento ainda. Busque e clique num produto ao lado.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 84px 96px 96px 28px", gap: 8, fontSize: 10.5, color: C.grayLight, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, padding: "0 2px" }}>
                <span>Produto</span><span style={{ textAlign: "right" }}>Preço</span><span style={{ textAlign: "center" }}>Qtd</span><span style={{ textAlign: "right" }}>Subtotal</span><span />
              </div>
              {linhas.map((l) => {
                const excede = l.estoque != null && l.qtd > l.estoque;
                return (
                  <div key={l.codprod} style={{ display: "grid", gridTemplateColumns: "1fr 84px 96px 96px 28px", gap: 8, alignItems: "center", borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.produto}</div>
                      <div style={{ fontSize: 10.5, color: excede ? C.red : C.grayLight }}>
                        #{l.codprod} · estoque <b style={{ color: estoqueCor(l.estoque) }}>{estoqueTxt(l.estoque)}</b>{excede ? " · acima do estoque!" : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 13, color: C.navy }}>{moeda(l.preco)}</div>
                    <input
                      type="number" min={1} value={l.qtd}
                      onChange={(e) => setQtd(l.codprod, parseInt(e.target.value, 10))}
                      style={{ width: "100%", boxSizing: "border-box", textAlign: "center", padding: "6px 4px", fontSize: 13, fontWeight: 700, color: C.navy, border: `1px solid ${excede ? C.red : C.border}`, borderRadius: 6, outline: "none" }}
                    />
                    <div style={{ textAlign: "right", fontSize: 13, fontWeight: 800, color: C.wine }}>{moeda(l.preco * l.qtd)}</div>
                    <button onClick={() => remover(l.codprod)} title="Remover" style={{ width: 24, height: 24, borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.gray, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 16, borderTop: `2px solid ${C.wine}`, paddingTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.gray }}>Total do orçamento</span>
            <b style={{ fontSize: 22, color: C.wine }}>{moeda(total)}</b>
          </div>
          {linhas.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.gray }}>📋 Texto para enviar ao cliente</span>
                <button
                  onClick={copiar}
                  style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: copiado ? C.green : C.cyan, border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}
                >
                  {copiado ? "Copiado ✓" : "Copiar"}
                </button>
              </div>
              <textarea
                ref={txtRef}
                readOnly
                value={textoOrcamento}
                onFocus={(e) => e.currentTarget.select()}
                rows={Math.min(14, linhas.length * 2 + 4)}
                style={{ width: "100%", boxSizing: "border-box", fontSize: 12.5, lineHeight: 1.5, color: C.navy, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", outline: "none", resize: "vertical", fontFamily: "inherit" }}
              />
              <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setLinhas([])} style={{ fontSize: 12, fontWeight: 600, color: C.gray, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>Limpar orçamento</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
