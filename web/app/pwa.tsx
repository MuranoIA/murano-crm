"use client";

import { useEffect } from "react";

/**
 * Registra o service worker do Murano Chat.
 *
 * Componente separado porque `layout.tsx` é Server Component e registrar SW
 * exige `window`. Não desenha nada — é só o gancho.
 *
 * O `sw.js` não faz cache (ver o comentário lá): existe para receber push com
 * o app fechado. Registrar cedo é o que permite pedir a permissão depois, na
 * hora certa, dentro do chat.
 */
export default function RegistrarPwa() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Falha aqui NÃO pode derrubar a tela: sem SW o chat continua inteiro, só
    // não recebe push. É degradação, não erro.
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}

/** True quando a página está rodando como app instalado (PWA ou APK/TWA). */
export function ehApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      // iOS não implementa display-mode; expõe esta flag proprietária
      (navigator as any).standalone === true
    );
  } catch {
    return false;
  }
}
