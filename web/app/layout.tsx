import type { ReactNode } from "react";

export const metadata = {
  title: "CRM — Funil de Atendimentos",
  description: "Funil de atendimentos (tentativa · negociação · pedido emitido)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
          background: "#efe9ed",
          color: "#142138",
          minHeight: "100vh",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: "@keyframes pulse-alert{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.25;transform:scale(.65)}}.et-tip-wrap{display:inline-flex;align-items:center;cursor:help}" }} />
        {children}
      </body>
    </html>
  );
}
