import type { ReactNode } from "react";
import "../chat-v2/v2.css";

// ⚠️ A folha do v2 é a mesma do chat — importada aqui de novo porque o layout
// dela vive na rota `/chat-v2` e não alcança esta. Sem preflight e com tokens
// prefixados, então importá-la numa segunda rota é seguro: o que vaza é inerte
// (ver o cabeçalho de `v2.css`).
//
// O painel novo nasce com o desenho do v2 de propósito. O `/admin` de hoje é
// estilo inline construído em cima do padrão do navegador; copiá-lo seria levar
// adiante o que a frente do chat já pagou para deixar para trás.

export const metadata = { title: "Admin (novo) — Murano" };

export default function LayoutAdminNovo({ children }: { children: ReactNode }) {
  return children;
}
