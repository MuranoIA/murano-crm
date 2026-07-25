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
        <style dangerouslySetInnerHTML={{ __html: "@keyframes pulse-alert{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.25;transform:scale(.65)}}.et-tip-wrap{position:relative;display:inline-flex;align-items:center}.et-tip{display:none;position:absolute;top:22px;left:-8px;z-index:60;width:300px;background:#111d33;color:#fff;padding:11px 13px;border-radius:9px;font-size:11.5px;line-height:1.55;font-weight:400;letter-spacing:0;text-transform:none;white-space:pre-line;box-shadow:0 8px 26px rgba(16,32,64,.28)}.et-tip-wrap:hover .et-tip{display:block}" }} />
        {children}
      </body>
    </html>
  );
}
