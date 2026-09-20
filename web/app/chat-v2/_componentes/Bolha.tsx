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
}: {
  m: Mensagem;
  primeiraDoGrupo: boolean;
  ultimaDoGrupo: boolean;
}) {
  const minha = m.enviada_por !== "customer";
  const falhou = m.status === "failed" || !!m.erro;
  const tick = minha && !falhou ? TICK[String(m.status ?? "")] : null;
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
        {m.tipo === "template" && (
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-v2-vinho-texto">
            template
          </span>
        )}
        <Conteudo m={m} />

        <span className="mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums text-v2-tinta-fraca">
          {hora(m.criada_em)}
          {tick && (
            <span aria-label={tick.rotulo} title={tick.rotulo} className={tick.azul ? "text-v2-azul" : ""}>
              {tick.txt}
            </span>
          )}
        </span>
      </div>

      {m.reacao && (
        <span className="-mt-1.5 rounded-full bg-v2-superficie px-1.5 py-px text-[12px] shadow-e1">{m.reacao}</span>
      )}

      {erro && (
        // o motivo da falha fica em TEXTO, tocável. No chat antigo ele vive num
        // `title`, que exige hover — inalcançável no celular (achado 5 do laudo)
        <span
          title={erro.tecnico}
          className="mt-1 max-w-[min(72%,560px)] rounded-lg bg-v2-erro-claro px-2 py-1 text-[12px] leading-4 text-v2-erro"
        >
          {erro.texto}
          {erro.acao ? ` ${erro.acao}` : ""}
        </span>
      )}
    </div>
  );
}

export const Bolha = memo(BolhaBase);
