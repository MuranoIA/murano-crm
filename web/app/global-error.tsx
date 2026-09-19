"use client";

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Mesmo papel de `error.tsx`, para o caso mais raro: quebra dentro do
// LAYOUT RAIZ (o que `error.tsx` normal não cobre — ele só pega erro dentro
// de uma rota). Por isso precisa do próprio <html>/<body>: quando este
// arquivo entra em cena, o layout raiz inteiro já quebrou junto.
// ---------------------------------------------------------------------------
export default function ErroGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    let embutido = false;
    try { embutido = window.self !== window.top; } catch { embutido = true; }

    fetch("/api/erros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rota: location.pathname + location.search,
        mensagem: error?.message ?? String(error),
        stack: error?.stack ?? null,
        digest: error?.digest ?? null,
        embutido,
        extra: { global: true },
      }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0 }}>
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 14,
          padding: 24, textAlign: "center", background: "#f5edf4",
          color: "#241327", fontFamily: "Inter, system-ui, sans-serif",
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#621244" }}>
            O sistema encontrou um erro
          </div>
          <div style={{ fontSize: 13, color: "#6f5c6d", maxWidth: 360, lineHeight: 1.5 }}>
            Já foi registrado. Recarregar costuma resolver.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <button onClick={() => reset()} style={{
              fontSize: 13, fontWeight: 700, color: "#fff", background: "#7b2d8b",
              border: "none", borderRadius: 999, padding: "8px 18px", cursor: "pointer",
            }}>
              Tentar de novo
            </button>
            <button onClick={() => location.reload()} style={{
              fontSize: 13, fontWeight: 700, color: "#621244", background: "transparent",
              border: "1px solid #e0cfdb", borderRadius: 999, padding: "8px 18px", cursor: "pointer",
            }}>
              Recarregar a página
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
