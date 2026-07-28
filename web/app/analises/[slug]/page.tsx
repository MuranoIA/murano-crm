"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { analiseBySlug } from "../registry";

const WINE = "#57163f", CYAN = "#0ea3dc", INK = "#142138", GRAY = "#7d8695", BORDER = "#e6e0e6", SURF = "#ffffff", BG = "#efe9ed";

export default function AnaliseViewer() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug ?? "");
  const analise = analiseBySlug(slug);

  const [role, setRole] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRole(j?.role))
      .catch(() => setRole(undefined))
      .finally(() => setLoaded(true));
  }, []);

  if (loaded && role !== "admin") {
    return (
      <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: INK }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Análises</div>
        <div style={{ color: GRAY, fontSize: 14 }}>Acesso restrito ao administrador.</div>
        <Link href="/" style={{ color: CYAN, fontSize: 14, textDecoration: "none" }}>← voltar ao funil</Link>
      </div>
    );
  }

  if (!analise) {
    return (
      <div style={{ minHeight: "100vh", background: BG, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: INK }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Análise não encontrada</div>
        <Link href="/analises" style={{ color: CYAN, fontSize: 14, textDecoration: "none" }}>← todas as análises</Link>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: BG, fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* cabeçalho */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", background: SURF, borderBottom: `1px solid ${BORDER}` }}>
        <Link href="/analises" style={{ color: GRAY, textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>← Análises</Link>
        <span style={{ fontSize: 18 }}>{analise.emoji}</span>
        <div style={{ fontSize: 16, fontWeight: 800, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{analise.titulo}</div>
        <a
          href={analise.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: CYAN, textDecoration: "none", border: `1px solid #bfe1f2`, background: "#eef6fb", borderRadius: 8, padding: "6px 12px", whiteSpace: "nowrap" }}
        >
          Abrir em nova aba <span aria-hidden>↗</span>
        </a>
      </div>

      {/* conteúdo embutido */}
      <iframe
        title={analise.titulo}
        src={analise.url}
        style={{ flex: 1, minHeight: 0, width: "100%", border: "none", background: "#fff" }}
      />
    </div>
  );
}
