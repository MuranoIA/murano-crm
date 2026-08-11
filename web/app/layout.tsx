import type { ReactNode } from "react";
import { Inter } from "next/font/google";

// Antes disto o body só CITAVA "Inter" pelo nome — sem o arquivo da fonte
// carregado, o navegador caía no fallback do sistema sempre (a Inter não é
// fonte de sistema em quase nenhum SO). O hub (murano-app) já carrega a Inter
// de verdade via next/font; isto alinha o CRM ao mesmo padrão.
const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata = {
  title: "CRM — Funil de Atendimentos",
  description: "Funil de atendimentos (tentativa · negociação · pedido emitido)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.className}>
      <body
        style={{
          margin: 0,
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
