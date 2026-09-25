"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// A tela que aparece no lugar do "Application error" em branco do Next.js.
//
// Existe porque em 17/09/2026 a Kamilly relatou exatamente essa tela em
// branco — quatro vezes no mesmo dia — e não sobrou NENHUMA pista: nem
// console (ela já tinha saído), nem banco (não existia onde gravar). Este
// arquivo cobre erros dentro de uma rota; `global-error.tsx` cobre o caso
// mais raro de quebra no layout raiz.
//
// Grava em `erro_cliente` (migration 0140) assim que a tela aparece — não
// espera clique nenhum, porque é exatamente no "ninguém pensou em apertar
// F12" que a informação se perde.
// ---------------------------------------------------------------------------
export default function ErroDaRota({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    // dentro de um iframe (o hub embute o CRM inteiro) `window.self !==
    // window.top` lança em cross-origin estrito — por isso o try/catch em
    // vez de comparar direto.
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
      }),
      // não faz a tela esperar o registro para atualizar o texto
      keepalive: true,
    }).catch(() => {}).finally(() => setEnviado(true));
  }, [error]);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 14,
      padding: 24, textAlign: "center", background: "#f5edf4",
      color: "#241327", fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#621244" }}>
        Algo deu errado nesta tela
      </div>
      <div style={{ fontSize: 13, color: "#6f5c6d", maxWidth: 360, lineHeight: 1.5 }}>
        Já foi registrado{enviado ? "" : "…"} — pode tentar de novo, ou
        recarregar a página se não resolver.
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
  );
}
