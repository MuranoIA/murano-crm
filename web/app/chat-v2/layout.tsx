import type { ReactNode } from "react";
import "./v2.css";

// ⚠️ O CSS do v2 é importado SÓ aqui. Sem preflight, e com tokens prefixados —
// ver o cabeçalho de `v2.css` para o porquê das duas coisas.

export const metadata = { title: "Chat — Murano" };

// `interactiveWidget: "resizes-content"` é o que faz o teclado virtual do
// Android EMPURRAR a tela em vez de cobrir o compositor. Fica neste layout, e
// não na raiz, de propósito: mudar o comportamento do teclado nas telas antigas
// não é assunto desta frente.
export const viewport = {
  themeColor: "#621244",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  interactiveWidget: "resizes-content" as const,
};

export default function LayoutChatV2({ children }: { children: ReactNode }) {
  return children;
}
