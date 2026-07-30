"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

const WINE = "#57163f", CYAN = "#0ea3dc", INK = "#142138", GRAY = "#7d8695", BORDER = "#e6e0e6", SURF = "#ffffff", BG = "#efe9ed", ACC = "#7c5cfc";

type Sess = { slug: string | null; url: string | null };

export default function FotoRanking() {
  const [sess, setSess] = useState<Sess | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/utilitarios/foto-ranking", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { slug: null, url: null }))
      .then((j) => setSess({ slug: j.slug ?? null, url: j.url ?? null }))
      .catch(() => setSess({ slug: null, url: null }))
      .finally(() => setCarregando(false));
  }, []);

  const escolher = useCallback((f: File | null | undefined) => {
    setMsg(null);
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { setMsg({ tipo: "erro", texto: "Formato inválido. Use JPG, PNG ou WEBP." }); return; }
    if (f.size > 5 * 1024 * 1024) { setMsg({ tipo: "erro", texto: "Imagem muito grande (máx. 5 MB)." }); return; }
    setFile(f);
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(f); });
  }, []);

  // colar (Ctrl+V) da área de transferência
  useEffect(() => {
    if (!sess?.slug) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) { escolher(f); e.preventDefault(); } return; }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [sess?.slug, escolher]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function subir() {
    if (!file) return;
    setEnviando(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("foto", file);
      const r = await fetch("/api/utilitarios/foto-ranking", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: "erro", texto: j?.error ?? `Erro ${r.status}` }); return; }
      setSess((s) => (s ? { ...s, url: j.url } : s));
      setFile(null);
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return null; });
      setMsg({ tipo: "ok", texto: "Foto atualizada! Ela já aparece no ranking (a TV atualiza em segundos)." });
    } catch (e: any) {
      setMsg({ tipo: "erro", texto: e?.message ?? String(e) });
    } finally { setEnviando(false); }
  }

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const mostra = preview ?? sess?.url ?? null;

  return (
    <div style={{ minHeight: "100vh", background: BG, color: INK, fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: SURF, borderBottom: `1px solid ${BORDER}` }}>
        <Link href="/utilitarios" style={{ color: GRAY, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>← Utilitários</Link>
        <div style={{ fontSize: 18, fontWeight: 800, color: WINE }}>📸 Foto no Ranking</div>
      </div>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "26px 20px 60px" }}>
        {carregando && <div style={{ color: GRAY }}>Carregando…</div>}

        {!carregando && !sess?.slug && (
          <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Este utilitário é para vendedores</div>
            <div style={{ fontSize: 13.5, color: GRAY, marginTop: 6, lineHeight: 1.5 }}>
              A foto aparece <b>ao lado do seu nome</b> no ranking. Entre com o seu usuário de vendedor para enviar a sua foto.
            </div>
          </div>
        )}

        {!carregando && sess?.slug && (
          <div style={{ background: SURF, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 22, boxShadow: "0 1px 2px rgba(16,32,64,0.05)" }}>
            <div style={{ fontSize: 13, color: GRAY, marginBottom: 18 }}>
              Você está enviando a foto de <b style={{ color: INK, textTransform: "capitalize" }}>{cap(sess.slug)}</b>. Ela substitui a foto atual ao lado do seu nome no ranking.
            </div>

            {/* preview / avatar atual */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
              <div style={{ width: 96, height: 96, borderRadius: 14, overflow: "hidden", background: "#f0edf1", border: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {mostra
                  ? <img src={mostra} alt="prévia" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: 30, color: GRAY }}>{cap(sess.slug).slice(0, 1)}</span>}
              </div>
              <div style={{ fontSize: 12.5, color: GRAY, lineHeight: 1.5 }}>
                {preview ? <span style={{ color: ACC, fontWeight: 700 }}>Prévia da nova foto.</span> : (sess.url ? "Foto atual." : "Sem foto ainda — aparece pelas iniciais.")}
                <br />Dica: foto <b>quadrada</b> e com o rosto centralizado fica melhor.
              </div>
            </div>

            {/* dropzone */}
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); escolher(e.dataTransfer.files?.[0]); }}
              style={{
                cursor: "pointer", borderRadius: 14, padding: "26px 18px", textAlign: "center",
                border: `2px dashed ${dragOver ? ACC : "#d7cfe8"}`, background: dragOver ? "#f3f0fd" : "#faf9fc",
                transition: "all .12s ease",
              }}
            >
              <div style={{ fontSize: 26, marginBottom: 6 }}>⬆️</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Escolher arquivo, arrastar aqui ou colar (Ctrl+V)</div>
              <div style={{ fontSize: 12, color: GRAY, marginTop: 4 }}>JPG, PNG ou WEBP · até 5 MB</div>
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }}
                onChange={(e) => escolher(e.target.files?.[0])} />
            </div>

            {msg && (
              <div style={{ marginTop: 14, borderRadius: 10, padding: "10px 14px", fontSize: 13,
                background: msg.tipo === "ok" ? "#eaf7ef" : "#fdeceb",
                border: `1px solid ${msg.tipo === "ok" ? "#bfe3cc" : "#f3c4bf"}`,
                color: msg.tipo === "ok" ? "#15803d" : "#a4271a" }}>
                {msg.texto}
              </div>
            )}

            <button
              onClick={subir}
              disabled={!file || enviando}
              style={{
                marginTop: 16, width: "100%", cursor: !file || enviando ? "not-allowed" : "pointer", fontFamily: "inherit",
                fontSize: 14, fontWeight: 800, padding: "12px 16px", borderRadius: 10, border: "none", color: "#fff",
                background: !file || enviando ? "#c9c3d6" : ACC,
              }}
            >
              {enviando ? "Enviando…" : "Subir foto para o ranking"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
