"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TEMAS, temaSalvo, type Paleta } from "../../lib/tema";

// converte "#rrggbb" -> "rgba(r,g,b,a)"
const rgba = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

const VISOES = [
  {
    slug: "melhores", emoji: "🏆", cor: "#b8860b", tag: "F/M",
    titulo: "30 Melhores",
    desc: "Top 30 clientes por frequência e monetização. Ativo ou inativo pela regra dos 120 dias.",
  },
  {
    slug: "frequencia", emoji: "📅", cor: "#1a6b3c", tag: "Todo mês",
    titulo: "Frequência",
    desc: "Quem compra todo mês — 3 meses seguidos de compra é frequente; sem a sequência, não frequente.",
  },
  {
    slug: "fidelizacao", emoji: "🌱", cor: "#1a5fa8", tag: "Rumo aos 3 meses",
    titulo: "Fidelização",
    desc: "Clientes novos no processo de fidelização. Ao fechar 3 meses de compra, passam para a Frequência.",
  },
  {
    slug: "mes", emoji: "🛒", cor: "#c4370f", tag: "Mês atual",
    titulo: "Compras do mês",
    desc: "Clientes que já compraram dentro do mês atual, ordenados pelo valor faturado.",
  },
  {
    slug: "desativados", emoji: "🚫", cor: "#7b2d8b", tag: "Gestão",
    titulo: "Desativados",
    desc: "Clientes desativados do board, com motivo da desativação e observação editáveis.",
  },
];

export default function Visoes() {
  const [C, setC] = useState<Paleta>(TEMAS.padrao);
  useEffect(() => { setC(TEMAS[temaSalvo()]); }, []);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.navy, fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <Link href="/" style={{ color: C.gray, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Funil</Link>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.wine }}>Visões</div>
      </div>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 20px 60px" }}>
        <div style={{ fontSize: 14, color: C.gray, marginBottom: 20 }}>
          Escolha uma visão da carteira para abrir.
        </div>

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {VISOES.map((v) => (
            <Link
              key={v.slug}
              href={`/visoes/${v.slug}`}
              style={{
                textDecoration: "none", color: C.navy, position: "relative", overflow: "hidden",
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
                boxShadow: "0 1px 2px rgba(16,32,64,0.05)", transition: "transform .12s ease, box-shadow .12s ease",
                display: "block",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 10px 26px rgba(16,32,64,0.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 2px rgba(16,32,64,0.05)"; }}
            >
              {/* faixa de topo colorida */}
              <div style={{ height: 74, background: `linear-gradient(135deg, ${rgba(v.cor, 0.16)}, ${rgba(v.cor, 0.04)})`, display: "flex", alignItems: "center", padding: "0 18px", gap: 12 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: C.surface, border: `1px solid ${rgba(v.cor, 0.35)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, boxShadow: `0 2px 8px ${rgba(v.cor, 0.18)}` }}>
                  {v.emoji}
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: v.cor, background: C.surface, border: `1px solid ${rgba(v.cor, 0.3)}`, borderRadius: 999, padding: "3px 9px" }}>
                  {v.tag}
                </span>
              </div>
              {/* corpo */}
              <div style={{ padding: "14px 18px 18px" }}>
                <div style={{ fontSize: 16.5, fontWeight: 800 }}>{v.titulo}</div>
                <div style={{ fontSize: 13, color: C.gray, marginTop: 5, lineHeight: 1.45 }}>{v.desc}</div>
                <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, color: v.cor }}>
                  Abrir visão →
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
