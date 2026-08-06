"use client";

import Link from "next/link";

const WINE = "#57163f", GRAY = "#7d8695", INK = "#142138", BORDER = "#e6e0e6", SURF = "#ffffff", BG = "#efe9ed";

export default function Visoes() {
  return (
    <div style={{ minHeight: "100vh", background: BG, color: INK, fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", background: SURF, borderBottom: `1px solid ${BORDER}` }}>
        <Link href="/" style={{ color: GRAY, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Funil</Link>
        <div style={{ fontSize: 18, fontWeight: 800, color: WINE }}>Visões</div>
      </div>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 20px 60px" }}>
        <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "40px 24px", textAlign: "center", boxShadow: "0 1px 2px rgba(16,32,64,0.05)" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>👁️</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: WINE }}>Visões</div>
          <div style={{ fontSize: 14, color: GRAY, marginTop: 8, lineHeight: 1.5 }}>
            Em construção — em breve você poderá montar e salvar visões personalizadas aqui.
          </div>
        </div>
      </div>
    </div>
  );
}
