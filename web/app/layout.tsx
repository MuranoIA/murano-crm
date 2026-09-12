import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import RegistrarPwa from "./pwa";
import LembrarTela from "./lembrarTela";
import VerComo from "./verComo";

// Antes disto o body só CITAVA "Inter" pelo nome — sem o arquivo da fonte
// carregado, o navegador caía no fallback do sistema sempre (a Inter não é
// fonte de sistema em quase nenhum SO). O hub (murano-app) já carrega a Inter
// de verdade via next/font; isto alinha o CRM ao mesmo padrão.
const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata = {
  title: "CRM — Funil de Atendimentos",
  description: "Funil de atendimentos (tentativa · negociação · pedido emitido)",
  // PWA: é o que permite instalar o chat como app (ícone na tela, tela cheia)
  // e, depois, receber push com o app fechado. `start_url` do manifesto aponta
  // para /chat — instalado, o app abre direto no atendimento.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Murano Chat", statusBarStyle: "black-translucent" as const },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192" }],
    apple: "/icons/apple-touch-icon.png",
  },
};

// `themeColor` e `viewport` saem de `metadata` no Next 15+ e vão para cá.
// `viewportFit: "cover"` é o que faz a área segura do iPhone existir — sem
// ele, `env(safe-area-inset-bottom)` devolve 0 e o compositor fica embaixo da
// barra de gestos.
export const viewport = {
  themeColor: "#621244",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
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
        <RegistrarPwa />
        <LembrarTela />
        <VerComo />
        {children}
      </body>
    </html>
  );
}
