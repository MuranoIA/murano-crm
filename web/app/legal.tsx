import Link from "next/link";
import type { ReactNode } from "react";

// Moldura das páginas públicas /privacidade e /termos.
//
// Nome de arquivo comum de propósito: no App Router só `page.tsx`, `route.ts` e
// os arquivos especiais viram rota — `legal.tsx` é módulo compartilhado, como
// `OrcamentoFlutuante.tsx` e `chat/ligacao.tsx` já são.
//
// Estas são as ÚNICAS telas do sistema que abrem sem login: a Meta precisa ler
// as duas para tirar o app do modo Desenvolvimento, e o cliente precisa poder
// consultar a política sem ter conta em lugar nenhum. Por isso não há nada aqui
// que consulte sessão, carteira ou dado de cliente.

const L = {
  wine: "#621244", roxo: "#7b2d8b", laranja: "#dd4222",
  bg: "#f5edf4", surface: "#ffffff", border: "#e0cfdb",
  ink: "#241327", gray: "#5c4a5b", muted: "#8b7589",
};

export function MolduraLegal({ titulo, resumo, vigencia, outra, children }: {
  titulo: string; resumo: string; vigencia: string;
  outra: { href: string; texto: string };
  children: ReactNode;
}) {
  return (
    <div style={{ minHeight: "100vh", background: L.bg, color: L.ink,
      fontFamily: "Inter, system-ui, sans-serif", lineHeight: 1.65 }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${L.laranja}, ${L.wine}, ${L.roxo})` }} />

      <header style={{ background: L.surface, borderBottom: `1px solid ${L.border}` }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "22px 20px 20px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: L.roxo }}>
            Murano Professional
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: L.wine, margin: "6px 0 8px" }}>
            {titulo}
          </h1>
          <p style={{ fontSize: 15, color: L.gray, margin: 0, maxWidth: 640 }}>{resumo}</p>
          {vigencia && (
            <p style={{ fontSize: 12.5, color: L.muted, margin: "12px 0 0" }}>Vigente desde {vigencia}</p>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 820, margin: "0 auto", padding: "26px 20px 10px" }}>
        <article style={{ background: L.surface, border: `1px solid ${L.border}`, borderRadius: 14, padding: "26px 26px 30px" }}>
          {children}
        </article>
      </main>

      <footer style={{ maxWidth: 820, margin: "0 auto", padding: "18px 20px 56px",
        display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <Link href={outra.href} style={{ color: L.roxo, fontWeight: 700, textDecoration: "none" }}>
          {outra.texto} →
        </Link>
        <span style={{ color: L.border }}>·</span>
        <Link href="/" style={{ color: L.muted, textDecoration: "none" }}>Ir para o sistema</Link>
      </footer>
    </div>
  );
}

export function Secao({ n, titulo, id, children }: {
  n: number; titulo: string; id?: string; children: ReactNode;
}) {
  return (
    <section id={id} style={{ scrollMarginTop: 18, marginBottom: 26 }}>
      <h2 style={{ fontSize: 17, fontWeight: 800, color: L.wine, margin: "0 0 10px", letterSpacing: -0.2 }}>
        <span style={{ color: L.muted, fontWeight: 700, marginRight: 8 }}>{n}.</span>{titulo}
      </h2>
      <div style={{ fontSize: 14.5, color: L.gray }}>{children}</div>
    </section>
  );
}

export const P = ({ children }: { children: ReactNode }) => (
  <p style={{ margin: "0 0 11px" }}>{children}</p>
);

export const Lista = ({ itens }: { itens: ReactNode[] }) => (
  <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
    {itens.map((it, i) => <li key={i} style={{ margin: "0 0 6px" }}>{it}</li>)}
  </ul>
);

/**
 * Bloco de identificação/contato. OMITE a linha cujo valor está vazio — uma
 * política pública com "CNPJ: —" é pior do que uma sem a linha; a cobrança do
 * que falta preencher acontece no /admin, onde só nós vemos.
 */
export function Dados({ linhas }: { linhas: [string, string][] }) {
  const preenchidas = linhas.filter(([, v]) => String(v ?? "").trim());
  if (!preenchidas.length) return null;
  return (
    <div style={{ background: L.bg, border: `1px solid ${L.border}`, borderRadius: 10, padding: "14px 16px", margin: "0 0 12px" }}>
      {preenchidas.map(([r, v]) => (
        <div key={r} style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 14, margin: "0 0 5px" }}>
          <span style={{ minWidth: 120, fontWeight: 700, color: L.ink }}>{r}</span>
          <span style={{ color: L.gray }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export const Destaque = ({ children }: { children: ReactNode }) => (
  <div style={{ borderLeft: `3px solid ${L.roxo}`, background: "rgba(123,45,139,.05)",
    padding: "11px 14px", borderRadius: "0 8px 8px 0", margin: "0 0 12px", fontSize: 14.5, color: L.ink }}>
    {children}
  </div>
);
