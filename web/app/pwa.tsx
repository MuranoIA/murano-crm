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

// ---------------------------------------------------------------------------
// Web Push (migration 0096) — o lado do navegador.
//
// Mora aqui, e não em `chat/page.tsx`, porque é mecânica de plataforma: nada
// disto tem a ver com atendimento, e aquela tela já passa de 2.400 linhas.
// ---------------------------------------------------------------------------

/** A chave VAPID viaja em base64url; `applicationServerKey` exige bytes. */
function chaveEmBytes(base64url: string): Uint8Array {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Nome curto do aparelho, para a pessoa se reconhecer numa lista. */
function nomeDoAparelho(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  const so = /Android/i.test(ua) ? "Android"
    : /iPhone|iPad|iPod/i.test(ua) ? "iPhone"
    : /Windows/i.test(ua) ? "Windows"
    : /Mac OS X/i.test(ua) ? "Mac" : "";
  const nav = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "navegador";
  return [nav, so].filter(Boolean).join(" no ") || "este aparelho";
}

/** Já existe inscrição de push neste navegador? */
export async function pushInscrito(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch { return false; }
}

/**
 * Pede a permissão e registra a inscrição no servidor.
 *
 * Devolve um motivo legível quando não dá — a mensagem "não foi possível
 * ativar" sem causa é o tipo de erro que vira chamado no suporte. Em especial
 * `negada`: uma vez que a pessoa bloqueia, o navegador NUNCA mais pergunta, e
 * a única saída é o cadeado do site. Dizer isso é a diferença entre resolver
 * em dez segundos e desistir.
 */
export async function ativarPush(): Promise<{ ok: true } | { ok: false; motivo: string }> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return { ok: false, motivo: "Este navegador não recebe notificações. No iPhone, é preciso adicionar o app à tela de início primeiro." };
    }
    const cfg = await fetch("/api/chat/push", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (!cfg?.disponivel || !cfg?.chave) {
      return { ok: false, motivo: "As notificações ainda não foram configuradas no servidor." };
    }

    const permissao = await Notification.requestPermission();
    if (permissao !== "granted") {
      return { ok: false, motivo: permissao === "denied"
        ? "As notificações estão bloqueadas para este site. Libere no cadeado ao lado do endereço — depois de bloquear, o navegador não pergunta de novo."
        : "Permissão não concedida." };
    }

    const reg = await navigator.serviceWorker.ready;
    // `userVisibleOnly` é obrigatório no Chrome: promete que todo push vira uma
    // notificação visível. Push silencioso não é permitido, e é bom que não seja.
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chaveEmBytes(cfg.chave) as unknown as ArrayBuffer,
    });

    const r = await fetch("/api/chat/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sub.toJSON(), aparelho: nomeDoAparelho() }),
    });
    if (!r.ok) {
      // não deixa inscrição órfã no navegador: ela existiria sem par no banco,
      // e o botão diria "ativado" sem nunca entregar nada
      await sub.unsubscribe().catch(() => {});
      const j = await r.json().catch(() => null);
      return { ok: false, motivo: j?.error ?? "O servidor recusou a inscrição." };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, motivo: e?.message ?? "Não foi possível ativar." };
  }
}

/** Desliga a notificação neste aparelho (os outros continuam). */
export async function desativarPush(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    await fetch("/api/chat/push", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
    return true;
  } catch { return false; }
}
