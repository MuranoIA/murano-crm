import type { ReactNode } from "react";
import { ATUALIZADO_EM } from "../lib/empresa";

// Moldura compartilhada pela Política de Privacidade e pelos Termos de Uso.
//
// São páginas PÚBLICAS de propósito — não há middleware de sessão no projeto,
// então qualquer rota nasce aberta, e é isso que a Meta exige: ela busca essas
// URLs sem cookie nenhum. Nada aqui pode depender de login, de tema salvo no
// navegador ou de qualquer chamada ao Supabase.
//
// Identidade Murano fixa (vinho #621244 / laranja #dd4222), sem o alternador de
// tema do board: o seletor guarda a escolha em localStorage e exigiria um
// componente de cliente numa página que só precisa de texto.

const VINHO = "#621244";
const LARANJA = "#dd4222";
const TINTA = "#241a20";
const CINZA = "#5d5159";
const BORDA = "#e3d5df";

export function PaginaLegal({ titulo, resumo, children }: { titulo: string; resumo: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "clamp(20px, 5vw, 56px) clamp(18px, 5vw, 32px) 72px", color: TINTA, lineHeight: 1.65 }}>
      <header style={{ borderBottom: `2px solid ${VINHO}`, paddingBottom: 20, marginBottom: 30 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 1.4, color: LARANJA, textTransform: "uppercase" }}>
          Murano Professional
        </div>
        <h1 style={{ fontSize: "clamp(25px, 5vw, 33px)", lineHeight: 1.2, color: VINHO, margin: "8px 0 12px" }}>{titulo}</h1>
        <p style={{ fontSize: 15, color: CINZA, margin: 0 }}>{resumo}</p>
        <p style={{ fontSize: 13, color: CINZA, margin: "14px 0 0" }}>Última atualização: {ATUALIZADO_EM}</p>
      </header>

      {children}

      <footer style={{ marginTop: 48, paddingTop: 20, borderTop: `1px solid ${BORDA}`, fontSize: 13.5, color: CINZA, display: "flex", gap: 18, flexWrap: "wrap" }}>
        <a href="/privacidade" style={{ color: VINHO, fontWeight: 600 }}>Política de Privacidade</a>
        <a href="/termos" style={{ color: VINHO, fontWeight: 600 }}>Termos de Uso</a>
      </footer>
    </main>
  );
}

/** Seção com âncora — o `id` vira link direto, usado pelo campo de exclusão de dados do painel da Meta. */
export function Secao({ id, titulo, children }: { id?: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 30, scrollMarginTop: 20 }}>
      <h2 style={{ fontSize: 19, color: VINHO, margin: "0 0 10px", lineHeight: 1.3 }}>{titulo}</h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 15.5, margin: "0 0 12px" }}>{children}</p>;
}

export function Lista({ itens }: { itens: ReactNode[] }) {
  return (
    <ul style={{ fontSize: 15.5, margin: "0 0 12px", paddingLeft: 22 }}>
      {itens.map((item, i) => (
        <li key={i} style={{ marginBottom: 7 }}>{item}</li>
      ))}
    </ul>
  );
}

/** Destaque para o que o leitor precisa achar sem ler tudo (como pedir exclusão). */
export function Caixa({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: "#f7eff5", border: `1px solid ${BORDA}`, borderLeft: `4px solid ${LARANJA}`, borderRadius: 8, padding: "14px 16px", fontSize: 15.5, margin: "0 0 12px" }}>
      {children}
    </div>
  );
}

export const CORES = { VINHO, LARANJA, TINTA, CINZA, BORDA };
