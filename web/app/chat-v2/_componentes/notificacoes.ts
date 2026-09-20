"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ativarPush, desativarPush, pushInscrito } from "../../pwa";
import { ORIGEM_HUB } from "../../../lib/hub";

// ---------------------------------------------------------------------------
// AVISAR QUE CHEGOU MENSAGEM — os quatro caminhos, e quando cada um vale.
//
//   título da aba     a pessoa está no sistema, noutra aba
//   bipe              a pessoa está no sistema, nesta aba, olhando outra coisa
//   notificação       o navegador está aberto, a aba não está à frente
//   push (0096)       o navegador está FECHADO — só isto alcança
//
// São degraus, não alternativas: o push existe porque os outros três exigem a
// tela aberta, e o título existe porque o push exige permissão que nem todo
// aparelho concede.
// ---------------------------------------------------------------------------

/**
 * O contador no título: "(3) Chat — Murano".
 *
 * GLOBAL de propósito (§23.5): ele avisa que chegou mensagem e não pode calar
 * porque alguém filtrou a tela por carteira, por número ou por etapa. Quem
 * escolhe um recorte não está pedindo para ser avisado de menos.
 */
export function useTituloDaAba(naoLidas: number | null) {
  useEffect(() => {
    // `null` = o número ainda não chegou do servidor. O título fica como está,
    // em vez de anunciar um zero que seria mentira — a mesma regra dos chips.
    if (naoLidas === null) return;
    const antes = document.title;
    document.title = naoLidas ? `(${naoLidas}) Chat — Murano` : "Chat — Murano";
    return () => {
      document.title = antes;
    };
  }, [naoLidas]);
}

/**
 * Bipe e notificação do sistema quando o número de não lidas SOBE.
 *
 * ⚠️ Compara com o valor anterior, e ignora a primeira medida. Sem isso a tela
 * apitaria ao abrir com conversas pendentes — que é toda manhã, e é o caminho
 * mais curto para a equipe desligar o som e nunca mais ligar.
 */
export function useAvisoDeChegada(naoLidas: number | null) {
  const anterior = useRef<number | null>(null);

  useEffect(() => {
    // ⚠️ Enquanto o número não chegou, não há com o que comparar — e registrar
    // um zero aqui faria a primeira medida de verdade parecer uma subida: a
    // tela apitaria ao abrir, toda manhã.
    if (naoLidas === null) return;
    const antes = anterior.current;
    anterior.current = naoLidas;
    if (antes === null || naoLidas <= antes) return;

    // WebAudio, não um <audio src>: não põe arquivo no bundle e não depende de
    // rede — o aviso tem de funcionar na conexão ruim em que ele mais importa.
    try {
      const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const ganho = ctx.createGain();
        osc.connect(ganho);
        ganho.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = 880;
        ganho.gain.setValueAtTime(0.0001, ctx.currentTime);
        ganho.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
        ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.36);
        setTimeout(() => ctx.close().catch(() => {}), 600);
      }
    } catch {
      /* navegador sem WebAudio, ou ainda sem gesto do usuário: silencioso */
    }

    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        new Notification("Nova mensagem no Chat", {
          body: `${naoLidas} conversa${naoLidas > 1 ? "s" : ""} aguardando resposta`,
          // `tag` fixa: dez mensagens não viram dez notificações empilhadas,
          // viram uma que se atualiza
          tag: "chat-murano",
        });
      }
    } catch {
      /* idem */
    }
  }, [naoLidas]);
}

/**
 * Pede a permissão de notificação no PRIMEIRO clique, uma vez só.
 *
 * Na carga da página o navegador costuma negar sem perguntar (exige gesto), e
 * uma negativa é definitiva: depois de bloquear, ele nunca mais pergunta e a
 * única saída é o cadeado do site.
 *
 * ⚠️ Dentro de um iframe cross-origin `Notification.permission` já responde
 * `denied` ANTES de qualquer pergunta, e não há `allow=` que resolva — notificação
 * não é recurso delegável por Permissions Policy (§72.1). Por isso quem trabalha
 * no hub recebe pela inscrição do hub, não por esta.
 */
export function usePermissaoDeNotificacao(ligado = true) {
  useEffect(() => {
    if (!ligado) return;
    const pedir = () => {
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
      } catch {}
      window.removeEventListener("click", pedir);
    };
    window.addEventListener("click", pedir);
    return () => window.removeEventListener("click", pedir);
  }, [ligado]);
}

/**
 * O interruptor de notificação com o app fechado.
 *
 * `null` = ainda não sabemos, e nesse estado nada é desenhado: um botão
 * "Ativar" que pisca e some ao descobrir que já estava ativo é pior que esperar
 * meio segundo. Sem chave VAPID no servidor o recurso não existe, e a tela some
 * com o botão em vez de oferecer algo que vai falhar.
 */
export function usePush(ligado = true) {
  const [estado, setEstado] = useState<boolean | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!ligado) return;
    let vivo = true;
    (async () => {
      const cfg = await fetch("/api/chat/push", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!vivo || !cfg?.disponivel) return;
      const inscrito = await pushInscrito();
      if (vivo) setEstado(inscrito);
    })();
    return () => {
      vivo = false;
    };
  }, [ligado]);

  const alternar = useCallback(async (): Promise<string | null> => {
    setOcupado(true);
    try {
      if (estado) {
        await desativarPush();
        setEstado(false);
        return "Notificações desligadas neste aparelho.";
      }
      const r = await ativarPush();
      if (r.ok) {
        setEstado(true);
        return "Notificações ligadas neste aparelho.";
      }
      return r.motivo;
    } finally {
      setOcupado(false);
    }
  }, [estado]);

  return { estado, ocupado, alternar };
}

/**
 * A PONTE DO HUB: "abra esta conversa", vinda do clique em Responder no push.
 *
 * Quem clica está no hub (`app.muranoprofessional.com.br`) e o CRM roda num
 * iframe de outra origem — `postMessage` é o único caminho de volta (§72.5).
 *
 * ⚠️ `event.origin` É A TRAVA, e é conferida ANTES de olhar o conteúdo.
 * `message` é um canal aberto: qualquer página que embuta esta consegue postar.
 * Sem a conferência, um site de fora mandaria `{tipo:"hub:abrir-conversa"}` com
 * um id qualquer e leria pela tela a conversa de uma cliente. A origem é uma
 * CONSTANTE, nunca algo derivado do próprio evento — um
 * `origin.endsWith("muranoprofessional.com.br")` pareceria equivalente e deixa
 * passar `muranoprofessional.com.br.evil.com`.
 */
export function usePonteDoHub(embutido: boolean, abrir: (clienteId: string) => void) {
  const abrirRef = useRef(abrir);
  abrirRef.current = abrir;

  useEffect(() => {
    if (!embutido) return; // fora do quadro não há pai para falar conosco
    const ouvir = (e: MessageEvent) => {
      if (e.origin !== ORIGEM_HUB) return;
      const d: any = e.data;
      if (!d || d.tipo !== "hub:abrir-conversa") return;
      if (typeof d.cliente_id !== "string" || !d.cliente_id) return;
      abrirRef.current(d.cliente_id);
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
  }, [embutido]);
}
