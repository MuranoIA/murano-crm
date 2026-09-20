"use client";

import { memo } from "react";
import type { Mensagem } from "./tipos";
import { hora } from "./formato";
import { traduzErroMeta } from "../../../lib/erroMeta";

// Uma mensagem. `memo`: a thread tem centenas delas e só a nova muda.
//
// A cor conta a história: o que SAIU daqui é azul (ação), o que a cliente
// mandou é superfície branca. Nada de verde-WhatsApp — a identidade é outra.

const TICK: Record<string, { txt: string; azul: boolean; rotulo: string }> = {
  wait: { txt: "✓", azul: false, rotulo: "enviada" },
  success: { txt: "✓✓", azul: false, rotulo: "entregue" },
  read: { txt: "✓✓", azul: true, rotulo: "lida" },
  checked: { txt: "✓✓", azul: true, rotulo: "lida" },
};

function Conteudo({ m }: { m: Mensagem }) {
  const src = `/api/chat/midia?id=${encodeURIComponent(m.id)}`;
  if (m.midia_tipo === "image" || m.midia_tipo === "sticker") {
    return (
      // largura e altura reservadas: sem isso a bolha pula quando a imagem
      // termina de carregar, e o CLS estoura (meta da spec: < 0,1)
      <img
        src={src}
        alt={m.midia_nome ?? "imagem"}
        loading="lazy"
        width={260}
        height={195}
        className="max-h-[300px] w-[260px] rounded-lg bg-v2-superficie-2 object-cover"
      />
    );
  }
  if (m.midia_tipo === "audio" || m.midia_tipo === "voice") {
    return <audio controls preload="none" src={src} className="h-10 w-[260px] max-w-full" />;
  }
  if (m.midia_tipo === "video") {
    return <video controls preload="none" src={src} className="w-[260px] max-w-full rounded-lg" />;
  }
  if (m.midia_tipo === "document") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-v2-azul underline">
        <span aria-hidden>📄</span>
        {m.midia_nome ?? "documento"}
      </a>
    );
  }
  return <span className="whitespace-pre-wrap break-words">{m.conteudo}</span>;
}

function BolhaBase({
  m,
  primeiraDoGrupo,
  ultimaDoGrupo,
  citada,
  aoReenviar,
  aoEncaminhar,
  aoResponder,
}: {
  m: Mensagem;
  primeiraDoGrupo: boolean;
  ultimaDoGrupo: boolean;
  /** o trecho citado, quando esta mensagem responde a outra (0086) */
  citada?: { conteudo: string | null; enviada_por: string | null };
  aoReenviar?: (m: Mensagem) => void;
  aoEncaminhar?: (m: Mensagem) => void;
  /** responder CITANDO esta mensagem. Vale para a da cliente e para a nossa, e
   *  para mídia — responder uma foto com outra foto é o gesto normal de quem
   *  atende salão. Ausente quando a mensagem não pode ser citada (ver abaixo). */
  aoResponder?: (m: Mensagem) => void;
}) {
  const minha = m.enviada_por !== "customer";
  const falhou = m.status === "failed" || !!m.erro;
  // `tmp:` = ainda não voltou do servidor. A bolha já está na tela (otimismo),
  // e o relógio diz a verdade: saiu daqui, ainda não há recibo.
  const otimista = m.id.startsWith("tmp:");
  const tick = minha && !falhou && !otimista ? TICK[String(m.status ?? "")] : null;
  const erro = falhou ? traduzErroMeta(m.erro) : null;

  return (
    <div
      data-msg={m.id}
      className={[
        "flex flex-col px-3",
        minha ? "items-end" : "items-start",
        primeiraDoGrupo ? "mt-2.5" : "mt-0.5",
      ].join(" ")}
    >
      <div
        className={[
          "entrar max-w-[min(72%,560px)] px-3 py-2 text-[14.5px] leading-[20px] shadow-e1",
          minha ? "bg-v2-azul-claro text-v2-tinta" : "bg-v2-superficie text-v2-tinta ring-1 ring-v2-linha",
          // a quina que aponta para o autor só na última do grupo: é o que
          // agrupa visualmente sem precisar de espaço entre as bolhas
          "rounded-2xl",
          ultimaDoGrupo ? (minha ? "rounded-br-md" : "rounded-bl-md") : "",
        ].join(" ")}
      >
        {citada && (
          // o trecho citado vem do servidor (`citadas`), porque a mensagem
          // original pode estar centenas de bolhas atrás — ou fora do lote
          <span className="mb-1 block border-l-[3px] border-v2-azul bg-black/[0.035] px-2 py-1 text-[12.5px] leading-4 text-v2-tinta-fraca">
            <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-v2-azul">
              {citada.enviada_por === "customer" ? "cliente" : "você"}
            </span>
            <span className="line-clamp-2 break-words">{citada.conteudo || "mídia"}</span>
          </span>
        )}

        {m.tipo === "template" && (
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-v2-vinho-texto">
            template
          </span>
        )}
        <Conteudo m={m} />

        <span className="mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums text-v2-tinta-fraca">
          {hora(m.criada_em)}
          {otimista && (
            <span aria-label="enviando" title="enviando" className="leading-none">
              <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5V12l3 2" />
              </svg>
            </span>
          )}
          {tick && (
            <span aria-label={tick.rotulo} title={tick.rotulo} className={tick.azul ? "text-v2-azul" : ""}>
              {tick.txt}
            </span>
          )}
        </span>
      </div>

      {(aoResponder || aoEncaminhar) && !otimista && !falhou && (
        <span className="mt-0.5 flex gap-1">
          {/* ⚠️ Só dá para citar uma mensagem que a META conhece. Um id nosso
              (a bolha otimista) ou herdado do RD faria o Graph recusar a
              mensagem INTEIRA com 131009 — e o que a pessoa escreveu se
              perderia por causa do enfeite. Aqui o botão simplesmente não
              aparece; o servidor confere de novo, porque a tela pode estar
              desatualizada e ele é quem fala com a Meta. */}
          {aoResponder && m.id.startsWith("wamid.") && (
            <button
              data-ripple
              onClick={() => aoResponder(m)}
              title="Responder citando esta mensagem"
              aria-label="Responder citando"
              className="acao-msg rounded-full px-2 py-0.5 text-[11px] text-v2-tinta-fraca hover:bg-v2-superficie-2"
            >
              ↩ responder
            </button>
          )}
          {aoEncaminhar && (
            <button
              data-ripple
              onClick={() => aoEncaminhar(m)}
              title="Encaminhar para outra conversa"
              aria-label="Encaminhar"
              className="acao-msg rounded-full px-2 py-0.5 text-[11px] text-v2-tinta-fraca hover:bg-v2-superficie-2"
            >
              ↪ encaminhar
            </button>
          )}
        </span>
      )}

      {m.reacao && (
        <span className="-mt-1.5 rounded-full bg-v2-superficie px-1.5 py-px text-[12px] shadow-e1">{m.reacao}</span>
      )}

      {erro && (
        // o motivo da falha fica em TEXTO, tocável. No chat antigo ele vive num
        // `title`, que exige hover — inalcançável no celular (achado 5 do laudo)
        <span
          title={erro.tecnico}
          className="mt-1 flex max-w-[min(72%,560px)] items-center gap-2 rounded-lg bg-v2-erro-claro px-2 py-1 text-[12px] leading-4 text-v2-erro"
        >
          <span className="min-w-0 flex-1">
            {erro.texto}
            {erro.acao ? ` ${erro.acao}` : ""}
          </span>
          {aoReenviar && m.conteudo && !m.midia_tipo && (
            <button
              data-ripple
              onClick={() => aoReenviar(m)}
              className="shrink-0 rounded-md px-1.5 py-0.5 font-semibold underline underline-offset-2"
            >
              Reenviar
            </button>
          )}
        </span>
      )}
    </div>
  );
}

export const Bolha = memo(BolhaBase);
