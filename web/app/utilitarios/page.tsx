"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { UTILITARIOS } from "./registry";

const WINE = "#57163f", GRAY = "#7d8695", INK = "#142138", BORDER = "#e6e0e6", SURF = "#ffffff", BG = "#efe9ed";

const rgba = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

export default function Utilitarios() {
  const router = useRouter();
  return (
    <div style={{ minHeight: "100vh", background: BG, color: INK, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", background: SURF, borderBottom: `1px solid ${BORDER}` }}>
        <Link href="/" style={{ color: GRAY, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Funil</Link>
        <div style={{ fontSize: 18, fontWeight: 800, color: WINE }}>Utilitários</div>
      </div>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "26px 20px 60px" }}>
        <div style={{ fontSize: 14, color: GRAY, marginBottom: 20 }}>Ferramentas rápidas para o dia a dia.</div>

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {UTILITARIOS.map((u) => (
            <button
              key={u.slug}
              onClick={() => router.push(u.url)}
              style={{
                textAlign: "left", cursor: "pointer", fontFamily: "inherit", position: "relative", overflow: "hidden",
                background: SURF, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 0,
                boxShadow: "0 1px 2px rgba(16,32,64,0.05)", transition: "transform .12s ease, box-shadow .12s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 10px 26px rgba(16,32,64,0.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 2px rgba(16,32,64,0.05)"; }}
            >
              <div style={{ height: 74, background: `linear-gradient(135deg, ${rgba(u.cor, 0.16)}, ${rgba(u.cor, 0.04)})`, display: "flex", alignItems: "center", padding: "0 18px", gap: 12 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: SURF, border: `1px solid ${rgba(u.cor, 0.35)}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, boxShadow: `0 2px 8px ${rgba(u.cor, 0.18)}` }}>
                  {u.emoji}
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: u.cor, background: SURF, border: `1px solid ${rgba(u.cor, 0.3)}`, borderRadius: 999, padding: "3px 9px" }}>
                  {u.tag}
                </span>
              </div>
              <div style={{ padding: "14px 18px 18px" }}>
                <div style={{ fontSize: 16.5, fontWeight: 800, color: INK }}>{u.titulo}</div>
                <div style={{ fontSize: 13, color: GRAY, marginTop: 5, lineHeight: 1.45 }}>{u.desc}</div>
                <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, color: u.cor }}>
                  Abrir <span aria-hidden>→</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
