"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { pedacoDeMapa, urlDoLadrilho } from "../../../lib/mapaTiles";
import type { Citada, Mensagem } from "./tipos";
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

/** O andamento do upload, por cima da prévia: um anel e o número. */
function Subindo({ pct }: { pct: number | null }) {
  return (
    <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/35 text-white">
      <span className="grid place-items-center">
        <svg viewBox="0 0 36 36" className="size-11 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeOpacity=".35" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${((pct ?? 8) / 100) * 94.2} 94.2`}
            className={pct == null ? "origin-center animate-spin" : ""}
          />
        </svg>
        {pct != null && <span className="-mt-7 text-[11px] font-semibold tabular-nums">{pct}%</span>}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// A IMAGEM AMPLIADA (pedido do piloto, 22/09/2026): tocar na foto a abre na
// própria tela, sobre um fundo escuro — como no WhatsApp.
//
// O chat de hoje abre a foto numa ABA NOVA. Dentro do iframe do hub isso tira a
// pessoa do CRM; aqui ela fica, e fecha no ✕, no Esc ou tocando fora. "Abrir
// em nova aba" e "Baixar" continuam à mão, para quem precisa do arquivo.
//
// Vai por PORTAL no `body`: dentro da bolha, um `fixed` ficaria preso ao
// contexto de empilhamento dela (a bolha tem sombra e animação de entrada), e
// o visualizador sairia por baixo da lista virtualizada.
// ---------------------------------------------------------------------------
function ImagemAmpliavel({
  src,
  nome,
  desligado,
  children,
}: {
  src: string;
  nome: string | null;
  desligado: boolean;
  children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    if (!aberta) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberta(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberta]);

  if (desligado) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        aria-label="Ampliar a imagem"
        title="Ampliar"
        className="block w-full cursor-zoom-in"
      >
        {children}
      </button>
      {aberta &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Imagem ampliada"
            onClick={() => setAberta(false)}
            className="v2 fixed inset-0 z-[60] flex flex-col bg-black/90 text-white"
          >
            <div className="flex shrink-0 items-center gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]" onClick={(e) => e.stopPropagation()}>
              <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">{nome ?? "imagem"}</span>
              <a href={src} target="_blank" rel="noopener noreferrer" className="rounded-full px-3 py-1.5 text-[13px] text-white/90 hover:bg-white/10">
                Abrir em nova aba
              </a>
              <a href={src} download={nome ?? "imagem"} className="rounded-full px-3 py-1.5 text-[13px] text-white/90 hover:bg-white/10">
                Baixar
              </a>
              <button
                type="button"
                onClick={() => setAberta(false)}
                aria-label="Fechar"
                className="grid size-10 place-items-center rounded-full hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {/* tocar na FOTO não fecha — só fora dela: quem quer olhar de
                  perto não pode perder a imagem por encostar nela */}
              <img
                src={src}
                alt={nome ?? "imagem"}
                onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full rounded-md object-contain"
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Conteudo({ m }: { m: Mensagem }) {
  // Anexo que ainda está SUBINDO: a prévia é o próprio arquivo, que já está no
  // navegador. Pedir a mídia ao servidor aqui daria 404 — ela ainda não existe
  // lá. Quando a linha de verdade chega, a prévia local continua valendo (ela
  // é carregada junto em `juntarNovas`), então a bolha não pisca.
  // ⚠️ o que FALHOU não está subindo: sem esta condição a bolha seguia com o
  // anel girando e parecia que ainda ia sair (visto na foto da prova)
  const subindo = m.local && m.id.startsWith("tmp:") && m.status !== "failed" && !m.erro;
  const src = m.local?.url ?? `/api/chat/midia?id=${encodeURIComponent(m.id)}`;
  if (m.midia_tipo === "image" || m.midia_tipo === "sticker") {
    return (
      // largura e altura reservadas: sem isso a bolha pula quando a imagem
      // termina de carregar, e o CLS estoura (meta da spec: < 0,1)
      <span className="relative block w-[260px] max-w-full">
        {/* Tocar AMPLIA (pedido do piloto, 22/09). Subindo não amplia: a
            prévia ainda não é a foto que a cliente recebeu. */}
        <ImagemAmpliavel src={src} nome={m.midia_nome} desligado={!!subindo}>
          <img
            src={src}
            alt={m.midia_nome ?? "imagem"}
            loading="lazy"
            width={260}
            height={195}
            className="max-h-[300px] w-[260px] max-w-full rounded-lg bg-v2-superficie-2 object-cover"
          />
        </ImagemAmpliavel>
        {subindo && <Subindo pct={m.local?.pct ?? null} />}
      </span>
    );
  }
  if (m.midia_tipo === "audio" || m.midia_tipo === "voice") {
    return (
      <span className="relative block">
        <audio controls preload="none" src={src} className="h-10 w-[260px] max-w-full" />
        {subindo && m.local?.pct != null && (
          <span className="mt-1 block text-[11px] tabular-nums text-v2-tinta-fraca">enviando… {m.local.pct}%</span>
        )}
      </span>
    );
  }
  if (m.midia_tipo === "video") {
    return (
      <span className="relative block w-[260px] max-w-full">
        {/* a prévia local sem controles enquanto sobe: dar play num vídeo que
            ainda não saiu confundiria "estou vendo" com "ela recebeu" */}
        <video
          controls={!subindo}
          muted={!!subindo}
          preload={subindo ? "metadata" : "none"}
          src={src}
          className="w-[260px] max-w-full rounded-lg bg-v2-superficie-2"
        />
        {subindo && <Subindo pct={m.local?.pct ?? null} />}
      </span>
    );
  }
  if (m.midia_tipo === "document") {
    // ainda subindo não há o que abrir: o nome, sem link, e o andamento
    if (subindo) {
      return (
        <span className="flex items-center gap-2 text-v2-tinta">
          <span aria-hidden>📄</span>
          <span className="min-w-0 flex-1 truncate">{m.midia_nome ?? "documento"}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-v2-tinta-fraca">
            {m.local?.pct != null ? `${m.local.pct}%` : "enviando…"}
          </span>
        </span>
      );
    }
    return (
      <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-v2-azul underline">
        <span aria-hidden>📄</span>
        {m.midia_nome ?? "documento"}
      </a>
    );
  }
  // ---- O PINO (demanda #44, 28/09/2026) ---------------------------------
  //
  // A cliente manda a localização e o consultor via o texto cru — que, quando o
  // pino não tem nome, é um par de coordenadas: `📍 -1.3774588, -48.3543379`.
  // Ilegível, e sem nada em que tocar para abrir o mapa.
  //
  // O dado já estava no banco e já vinha na thread (0115, §62.2); só a bolha do
  // chat-v2 não sabia desenhá-lo. Mesmo cartão nos dois sentidos, senão a
  // conversa contaria duas histórias visuais para a mesma coisa.
  //
  // ⚠️ A MINIATURA (28/09/2026, pedido do dono): o cartão de texto respondia
  // "tem uma localização", não "onde". Ela é montada com ladrilhos do
  // OpenStreetMap servidos pela NOSSA rota — ver `lib/mapaTiles.ts` para a
  // conta e `api/chat/mapa` para o porquê de passarem por nós.
  //
  // O que a mantém barata: `loading="lazy"` (só custa quando a bolha entra na
  // tela), ladrilho cacheado por uma semana, e o volume — 61 mensagens de
  // localização em toda a base, 56 nos últimos 30 dias.
  //
  // Se o mapa não vier, a bolha volta a ser o cartão de texto que já era: o
  // `onError` esconde o mosaico e nada mais muda.
  if (m.localizacao && Number.isFinite(m.localizacao.lat) && Number.isFinite(m.localizacao.lng)) {
    const { lat, lng, nome, endereco, url } = m.localizacao;
    const mapa = url || `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    return (
      <a
        href={mapa}
        target="_blank"
        rel="noreferrer"
        className="block w-[260px] max-w-full overflow-hidden rounded-lg bg-v2-superficie-2 no-underline"
      >
        <Miniatura lat={lat} lng={lng} />
        <span className="flex items-start gap-2 p-2">
          <span aria-hidden className="text-[18px] leading-none">📍</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-v2-tinta">{nome || "Localização"}</span>
            {/* sem nome nem endereço sobram as coordenadas — e aí elas são a
                informação, não um rótulo feio: dizem onde é, e o toque abre */}
            <span className="mt-0.5 block text-[12.5px] leading-[17px] text-v2-tinta-fraca">
              {endereco || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
            </span>
            <span className="mt-1 block text-[12px] font-medium text-v2-azul">abrir no mapa</span>
          </span>
        </span>
      </a>
    );
  }

  return <span className="whitespace-pre-wrap break-words">{m.conteudo}</span>;
}

/**
 * O mosaico 2×2 com o alfinete no centro.
 *
 * ⚠️ A ALTURA É RESERVADA no `span` de fora: sem isso a bolha pula quando os
 * ladrilhos terminam de carregar, e o CLS estoura — a mesma regra da imagem.
 *
 * A atribuição do OpenStreetMap não é enfeite: é condição de uso dos ladrilhos.
 */
function Miniatura({ lat, lng }: { lat: number; lng: number }) {
  const [caiu, setCaiu] = useState(false);
  const pedaco = useMemo(() => pedacoDeMapa(lat, lng), [lat, lng]);
  if (!pedaco || caiu) return null;
  return (
    <span
      className="relative block overflow-hidden bg-v2-superficie-2"
      style={{ width: "100%", height: pedaco.altura }}
    >
      {pedaco.ladrilhos.map((t) => (
        <img
          key={`${t.z}/${t.x}/${t.y}`}
          src={urlDoLadrilho(t)}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          width={256}
          height={256}
          onError={() => setCaiu(true)}
          className="absolute max-w-none"
          style={{ left: t.esq, top: t.topo }}
        />
      ))}
      {/* o alfinete fica no centro porque o mosaico foi deslocado para isso */}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full text-[20px] leading-none drop-shadow"
      >
        📍
      </span>
      <span className="absolute bottom-0 right-0 bg-white/70 px-1 text-[9px] leading-[13px] text-v2-tinta-fraca">
        © OpenStreetMap
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// A TIRINHA DA CITAÇÃO (23/09/2026)
//
// A cliente manda "vou querer 2 desse" marcando UMA das cinco fotos que o
// vendedor acabou de enviar. Sem a miniatura, a bolha dizia só "mídia" — e a
// pergunta que importa ("qual delas?") ficava sem resposta na tela; o vendedor
// tinha de abrir o WhatsApp no celular para saber. Era o que o piloto relatou,
// e o chat de hoje já mostrava a foto.
//
// A miniatura vem da MESMA rota da bolha (`/api/chat/midia?id=`), que devolve
// uma URL assinada — nada de link do bucket na tela. Falhar aqui não pode
// quebrar a citação: `onError` esconde a imagem e resta o rótulo.
// ---------------------------------------------------------------------------
const ROTULO_MIDIA: Record<string, string> = {
  image: "Foto", sticker: "Figurinha", audio: "Áudio", voice: "Áudio",
  video: "Vídeo", document: "Documento",
};

function Citacao({ c }: { c: Citada }) {
  const tipo = String(c.midia_tipo ?? "");
  const temImagem = tipo === "image" || tipo === "sticker" || tipo === "video";
  const rotulo = ROTULO_MIDIA[tipo];
  // legenda quando existe; senão o nome do arquivo; senão o tipo. A ordem
  // importa: "Vou querer 2 desse" é mais útil que "IMG-20260923.jpg".
  const texto = c.conteudo?.trim() || (rotulo ? c.midia_nome ?? rotulo : "mensagem");
  return (
    <span className="mb-1 flex items-stretch gap-2 overflow-hidden rounded-md border-l-[3px] border-v2-azul bg-black/[0.035] pl-2 text-[12.5px] leading-4 text-v2-tinta-fraca">
      <span className="min-w-0 flex-1 py-1">
        <span className="block text-[10.5px] font-semibold uppercase tracking-wide text-v2-azul">
          {c.enviada_por === "customer" ? "cliente" : "você"}
        </span>
        <span className="flex items-center gap-1">
          {rotulo && !temImagem && <span aria-hidden>{tipo === "document" ? "📄" : "🎤"}</span>}
          <span className="line-clamp-2 break-words">{texto}</span>
        </span>
      </span>
      {temImagem && (
        // 44px de lado, reservados: a tirinha não pode mudar de altura quando a
        // miniatura chega, senão a thread inteira pula (meta de CLS da spec)
        <img
          src={`/api/chat/midia?id=${encodeURIComponent(c.id)}`}
          alt={c.midia_nome ?? "mídia citada"}
          loading="lazy"
          width={44}
          height={44}
          onError={(e) => { e.currentTarget.style.display = "none"; }}
          className="size-11 shrink-0 self-center rounded bg-v2-superficie-2 object-cover"
        />
      )}
    </span>
  );
}

function BolhaBase({
  m,
  primeiraDoGrupo,
  ultimaDoGrupo,
  citada,
  aoReenviar,
  aoEncaminhar,
  aoResponder,
  aoSalvarFigurinha,
}: {
  m: Mensagem;
  primeiraDoGrupo: boolean;
  ultimaDoGrupo: boolean;
  /** o trecho citado, quando esta mensagem responde a outra (0086) */
  citada?: Citada;
  aoReenviar?: (m: Mensagem) => void;
  aoEncaminhar?: (m: Mensagem) => void;
  /** responder CITANDO esta mensagem. Vale para a da cliente e para a nossa, e
   *  para mídia — responder uma foto com outra foto é o gesto normal de quem
   *  atende salão. Ausente quando a mensagem não pode ser citada (ver abaixo). */
  aoResponder?: (m: Mensagem) => void;
  /** guardar esta figurinha no pacote (0144). Só vem quando a bolha é
   *  uma figurinha — para o resto não há o que salvar. */
  aoSalvarFigurinha?: (m: Mensagem) => void;
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
        {citada && <Citacao c={citada} />}

        {m.tipo === "template" && (
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-v2-vinho-texto">
            template
          </span>
        )}
        <Conteudo m={m} />

        <span className="mt-1 flex items-center justify-end gap-1 text-[11px] tabular-nums text-v2-tinta-fraca">
          {hora(m.criada_em)}
          {otimista && !falhou && (
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

      {(aoResponder || aoEncaminhar || (aoSalvarFigurinha && m.midia_tipo === "sticker")) && !otimista && !falhou && (
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
          {/* SALVAR NO PACOTE (0144): só na figurinha, e é daqui que o pacote
              nasce na prática — ninguém tem um `.webp` à mão, mas figurinha boa
              chega na conversa toda semana. */}
          {aoSalvarFigurinha && m.midia_tipo === "sticker" && (
            <button
              data-ripple
              onClick={() => aoSalvarFigurinha(m)}
              title="Guardar esta figurinha para reenviar depois"
              aria-label="Salvar figurinha"
              className="acao-msg rounded-full px-2 py-0.5 text-[11px] text-v2-tinta-fraca hover:bg-v2-superficie-2"
            >
              ☆ salvar figurinha
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
