"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Conversa — a thread completa do /chat dentro do card ampliado do board.
//
// Pedido do usuário (24/08/2026): *"que em cada card apareça a conversa igual
// como aparece no chat... não somente algumas últimas mensagens, mas a rolagem
// das mensagens normal como é no chat, e em negociação o input para a mensagem
// deve ser normal como em um chat e não com limitações tipo inline"*.
//
// O que o card tinha antes: `/api/mensagens`, que devolve **30 mensagens só de
// texto** — sem mídia, sem tique de entrega, sem separador de dia, sem motivo de
// falha — e um `<input>` de uma linha. Aqui passa a usar `/api/chat/thread`, a
// MESMA rota do /chat: 200 mensagens com mídia, status, reação e citação, mais
// notas internas e transferências na mesma linha do tempo.
//
// ---------------------------------------------------------------------------
// POR QUE UM ARQUIVO NOVO, E NÃO UM TRECHO DENTRO DE page.tsx OU UM IMPORT DO CHAT
//
// `app/chat/page.tsx` passa de 2.900 linhas e a renderização de bolha lá está
// amarrada a presença, ligação, respostas rápidas, picker e ao layout D1 (0095).
// Extrair aquilo mexeria numa tela que a equipe usa o dia inteiro, para entregar
// uma que ela ainda não viu. `app/page.tsx` também já passa de 3.000 linhas.
//
// Mesma decisão — e mesmo motivo — de `app/chat/ligacao.tsx` (§22.8): módulo
// próprio, com uma superfície de contato pequena e explícita.
//
// ⚠️ Consequência assumida: existem DUAS renderizações de bolha no projeto.
// Quando o desenho da bolha mudar, muda nas duas. A alternativa (refatorar o
// chat agora) troca esse custo por risco na tela de produção.
// ---------------------------------------------------------------------------

export type CoresConversa = {
  ink: string; gray: string; grayLight: string; border: string; surface: string;
  acao: string;      // cor de ENVIAR — azul, porque ação é azul (skill murano-brand)
  marca: string;     // púrpura/vinho da marca
  aviso: string;     // laranja: janela fechada, falha de envio
  fundo: string;     // fundo da área de mensagens
};

export const CORES_PADRAO: CoresConversa = {
  ink: "#241327", gray: "#6f5c6d", grayLight: "#9a8098", border: "#e0cfdb",
  surface: "#ffffff", acao: "#1a5fa8", marca: "#621244", aviso: "#dd4222",
  fundo: "#fbfafb",
};

type Msg = {
  id: string; conteudo: string | null; enviada_por: string | null; tipo: string | null;
  status: string | null; criada_em: string; erro?: string | null;
  midia_tipo?: string | null; midia_nome?: string | null; midia_path?: string | null;
  linha_id?: string | null;   // null = RD Conversas (§23.4)
};
type Nota = { id: string; autor: string | null; texto: string; criada_em: string };
type Transf = {
  id: string; de_carteira: string | null; para_carteira: string | null;
  por: string | null; observacao: string | null; criada_em: string;
};
type Item =
  | { k: "m"; em: string; m: Msg }
  | { k: "n"; em: string; n: Nota }
  | { k: "t"; em: string; t: Transf };

const rotuloMidia = (t: string) =>
  ({ image: "Imagem", audio: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha" }[t] ?? "Mídia");

const diaBR = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const horaBR = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);

function rotuloDia(dia: string): string {
  const hoje = diaBR(new Date().toISOString());
  const ontem = diaBR(new Date(Date.now() - 86400000).toISOString());
  if (dia === hoje) return "hoje";
  if (dia === ontem) return "ontem";
  return dia.split("-").reverse().join("/");
}

// Mensagem de sistema do RD vem com bytes de controle crus (§3): sem esta
// limpeza a bolha ganha caracteres invisíveis que quebram a quebra de linha.
const limpa = (s: string | null | undefined) =>
  String(s ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim();

// ticks estilo WhatsApp — mesma régua do /chat: wait ✓ · success ✓✓ ·
// read/checked ✓✓ azul · failed "!" com o motivo da Meta no title (0091).
function Ticks({ status, erro, c }: { status: string | null; erro?: string | null; c: CoresConversa }) {
  if (status === "failed") {
    return <span title={erro ?? "a Meta não explicou o motivo"}
      style={{ color: c.aviso, fontWeight: 800, cursor: erro ? "help" : "default" }}>!</span>;
  }
  const lida = status === "read" || status === "checked";
  const duplo = lida || status === "success";
  return <span style={{ color: lida ? c.acao : c.grayLight, letterSpacing: -2, fontWeight: 700 }}>
    {duplo ? "✓✓" : "✓"}
  </span>;
}

// URL assinada por redirect (§18): <img>/<audio> apontam direto para a rota.
// `midia_path` vazio = chegou mas o download falhou — aviso, não player quebrado.
function Midia({ m, c }: { m: Msg; c: CoresConversa }) {
  if (!m.midia_tipo) return null;
  const src = `/api/chat/midia?id=${encodeURIComponent(m.id)}`;
  const caixa = { borderRadius: 9, marginBottom: 4, display: "block" } as const;

  if (!m.midia_path) {
    return <div style={{ fontSize: 11, color: c.aviso, background: "#fdeae3", border: "1px solid #f0c4b0", borderRadius: 8, padding: "4px 8px", marginBottom: 4 }}>
      ⚠️ {rotuloMidia(m.midia_tipo)} não pôde ser baixada
    </div>;
  }
  if (m.midia_tipo === "image" || m.midia_tipo === "sticker") {
    const max = m.midia_tipo === "sticker" ? 120 : 220;
    return <a href={src} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
      <img src={src} alt={m.conteudo || "imagem"} style={{ ...caixa, maxWidth: max, maxHeight: 260, objectFit: "cover", cursor: "zoom-in" }} />
    </a>;
  }
  if (m.midia_tipo === "audio") return <audio controls preload="none" src={src} style={{ ...caixa, width: 210, height: 36 }} />;
  if (m.midia_tipo === "video") return <video controls preload="metadata" src={src} style={{ ...caixa, maxWidth: 220, maxHeight: 260 }} />;
  return <a href={src} target="_blank" rel="noopener noreferrer"
    style={{ ...caixa, display: "flex", alignItems: "center", gap: 7, padding: "6px 9px", background: "rgba(98,18,68,.06)", border: `1px solid ${c.border}`, textDecoration: "none", color: c.ink, maxWidth: 210 }}>
    <span style={{ fontSize: 16 }}>📎</span>
    <span style={{ minWidth: 0 }}>
      <b style={{ display: "block", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.midia_nome || "documento"}</b>
      <span style={{ fontSize: 10, color: c.acao, fontWeight: 700 }}>abrir ↗</span>
    </span>
  </a>;
}

export type ConversaProps = {
  clienteId: string;
  /** Altura da área de mensagens. O card ampliado é uma janela flutuante. */
  altura?: number;
  cores?: Partial<CoresConversa>;
  /** Chamado depois de um envio confirmado, para o board recarregar o funil. */
  aoEnviar?: () => void;
  /** Muda de valor -> recarrega a thread. É o ↻ do card, sem remontar o
   *  componente: remontar apagaria o texto que a pessoa está escrevendo. */
  recarregar?: number;
  /** Ação de template do board (janela fechada). Ausente = só o aviso. */
  aoPedirTemplate?: () => void;
  enviandoTemplate?: boolean;
};

export function Conversa({
  clienteId, altura = 300, cores, aoEnviar, aoPedirTemplate, enviandoTemplate, recarregar,
}: ConversaProps) {
  const c = { ...CORES_PADRAO, ...(cores ?? {}) };

  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  // por qual canal ESTA conversa sai, já com a escolha do admin (0102)
  const [canalEnvio, setCanalEnvio] = useState<"rd" | "whatsapp" | null>(null);
  // histórico do RD (0103): quantas mensagens a seleção de linhas esconde, e se
  // esta thread já foi carregada com elas
  const [ocultas, setOcultas] = useState(0);
  const [comHistorico, setComHistorico] = useState(false);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [transfs, setTransfs] = useState<Transf[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const rolagem = useRef<HTMLDivElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);

  // Card sintético (`winthor:`/`venda:`) não tem thread: é cliente do ERP que
  // nunca conversou. Pedir a rota devolveria vazio com erro no console.
  const sintetico = clienteId.includes(":") && !clienteId.startsWith("wa:");

  const carregar = useCallback(async (rolar: boolean, historico = false) => {
    if (sintetico) { setMsgs([]); return; }
    try {
      const r = await fetch(
        `/api/chat/thread?cliente_id=${encodeURIComponent(clienteId)}${historico ? "&historico=1" : ""}`,
        { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j?.error ?? `erro ${r.status}`); setMsgs([]); return; }
      setErro(null);
      setMsgs(j.mensagens ?? []);
      setCanalEnvio(j.canal_envio ?? null);
      setOcultas(j.historico_oculto ?? 0);
      setComHistorico(!!j.historico_carregado);
      setNotas(j.notas ?? []);
      setTransfs(j.transferencias ?? []);
      if (rolar) setTimeout(() => fim.current?.scrollIntoView({ behavior: "auto" }), 30);
    } catch (e: any) {
      setErro(String(e?.message ?? e));
      setMsgs([]);
    }
  }, [clienteId, sintetico]);

  useEffect(() => { setMsgs(null); setTexto(""); setAviso(null); void carregar(true); }, [carregar]);

  // ↻ do card: recarrega sem mexer no que está escrito na caixa
  const primeiroRecarregar = useRef(true);
  useEffect(() => {
    if (primeiroRecarregar.current) { primeiroRecarregar.current = false; return; }
    void carregar(false);
  }, [recarregar]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Rede de proteção, do mesmo tamanho da do /chat (§15.4): o Realtime do board
  // já recarrega o funil, mas a thread aberta precisa de um caminho próprio.
  useEffect(() => {
    if (sintetico) return;
    const t = setInterval(() => void carregar(false, comHistorico), 60000);
    return () => clearInterval(t);
  }, [carregar, sintetico, comHistorico]);

  // ---- janela de 24h -------------------------------------------------------
  // Conta a partir da última mensagem DO CLIENTE, que é o que a regra do
  // WhatsApp define — responder não reabre nada. O dado já veio na thread:
  // nenhuma chamada a mais, e o aviso aparece ANTES de escrever, não depois de
  // o envio falhar (§29.2 item 2), que é o erro que custa R$ 0,43.
  //
  // ⚠️ A JANELA É POR NÚMERO. Um cliente que respondeu há 10 minutos NO RD não
  // tem janela aberta na Cloud, e vice-versa. Contar sobre a conversa inteira
  // faria a tela liberar o campo de texto e o envio falhar com 131047 — com o
  // texto já escrito. Por isso só contam as mensagens do canal de ENVIO.
  const doCanalDeEnvio = (m: Msg) =>
    canalEnvio === null ? true : canalEnvio === "rd" ? !m.linha_id : !!m.linha_id;
  const ultimaRecebida = (msgs ?? [])
    .filter((m) => m.enviada_por === "customer" && m.tipo !== "evento_sistema" && doCanalDeEnvio(m))
    .slice(-1)[0];
  const msRestantes = ultimaRecebida
    ? 24 * 3600 * 1000 - (Date.now() - new Date(ultimaRecebida.criada_em).getTime())
    : null;
  const janelaAberta = msRestantes != null && msRestantes > 0;
  const restante = !janelaAberta ? "" :
    msRestantes! > 2 * 3600 * 1000
      ? `${Math.floor(msRestantes! / 3600000)}h`
      : `${Math.max(1, Math.floor(msRestantes! / 60000))} min`;

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando || !janelaAberta) return;
    setEnviando(true); setAviso(null);

    // otimista: a bolha aparece na hora com tique de espera; o refresh confirma
    const provisoria: Msg = {
      id: `local-${Date.now()}`, conteudo: t, enviada_por: "operator",
      tipo: "mensagem", status: "wait", criada_em: new Date().toISOString(),
    };
    setMsgs((prev) => [...(prev ?? []), provisoria]);
    setTexto("");
    setTimeout(() => fim.current?.scrollIntoView({ behavior: "smooth" }), 30);

    try {
      const r = await fetch("/api/send-message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, texto: t }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // devolve o texto à caixa: perder o que foi escrito é pior que o erro
        setMsgs((prev) => (prev ?? []).filter((m) => m.id !== provisoria.id));
        setTexto(t);
        setAviso(j?.foraDaJanela
          ? "A janela de 24h fechou enquanto você escrevia. Só template reabre."
          : (j?.error ?? `não consegui enviar (erro ${r.status})`));
        return;
      }
      await carregar(true);
      aoEnviar?.();
    } catch (e: any) {
      setMsgs((prev) => (prev ?? []).filter((m) => m.id !== provisoria.id));
      setTexto(t);
      setAviso(String(e?.message ?? e));
    } finally {
      setEnviando(false);
    }
  }

  // thread = mensagens + notas + transferências na mesma linha do tempo,
  // agrupadas por dia. Mesma montagem do /chat (`linhaDoTempo` lá).
  const itens: Item[] = [
    ...(msgs ?? []).map((m) => ({ k: "m" as const, em: m.criada_em, m })),
    ...notas.map((n) => ({ k: "n" as const, em: n.criada_em, n })),
    ...transfs.map((t) => ({ k: "t" as const, em: t.criada_em, t })),
  ].sort((a, b) => (a.em < b.em ? -1 : a.em > b.em ? 1 : 0));

  const grupos: { dia: string; itens: Item[] }[] = [];
  for (const it of itens) {
    const d = diaBR(it.em);
    const g = grupos[grupos.length - 1];
    if (g && g.dia === d) g.itens.push(it);
    else grupos.push({ dia: d, itens: [it] });
  }

  const Separador = ({ txt }: { txt: string }) => (
    <div style={{ textAlign: "center", margin: "8px 0 4px" }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: c.gray, background: c.surface, border: `1px solid ${c.border}`, borderRadius: 20, padding: "2px 10px" }}>{txt}</span>
    </div>
  );

  return (
    <>
      <div ref={rolagem} style={{ height: altura, overflowY: "auto", padding: "6px 12px 10px", background: c.fundo }}>
        {sintetico ? (
          <div style={{ fontSize: 12, color: c.grayLight, textAlign: "center", padding: 18, lineHeight: 1.5 }}>
            Cliente da carteira sem conversa no CRM.<br />O contato começa por um template.
          </div>
        ) : msgs === null ? (
          <div style={{ fontSize: 12, color: c.grayLight, textAlign: "center", padding: 18 }}>Carregando conversa…</div>
        ) : erro ? (
          <div style={{ fontSize: 12, color: c.aviso, textAlign: "center", padding: 18 }}>{erro}</div>
        ) : itens.length === 0 ? (
          <div style={{ fontSize: 12, color: c.grayLight, textAlign: "center", padding: 18 }}>Sem mensagens nesta conversa.</div>
        ) : (<>
          {/* Histórico do outro número: um clique, como no RD Conversas. Fica no
              topo porque é o que vem ANTES na linha do tempo — e some depois de
              carregado, virando o rótulo que separa as duas origens. */}
          {ocultas > 0 && !comHistorico && (
            <div style={{ textAlign: "center", padding: "4px 0 10px" }}>
              <button
                onClick={() => void carregar(false, true)}
                style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
                  color: c.acao, background: c.surface, border: `1px solid ${c.border}`,
                  borderRadius: 20, padding: "5px 14px" }}>
                ↑ Ver histórico anterior ({ocultas})
              </button>
              <div style={{ fontSize: 10, color: c.grayLight, marginTop: 4 }}>
                conversas deste cliente no outro número
              </div>
            </div>
          )}
          {comHistorico && (
            <div style={{ textAlign: "center", padding: "2px 0 8px" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: c.gray, background: c.surface,
                border: `1px solid ${c.border}`, borderRadius: 20, padding: "2px 10px" }}>
                histórico do Murano Pro (RD Conversas)
              </span>
            </div>
          )}
          {grupos.map((g) => (
          <div key={g.dia}>
            <Separador txt={rotuloDia(g.dia)} />
            {g.itens.map((it) => {
              if (it.k === "n") return (
                <div key={`n${it.n.id}`} style={{ margin: "5px auto", maxWidth: "88%", background: "#fdf6e3", border: "1px solid #e8d9a8", borderRadius: 9, padding: "6px 10px" }}>
                  <div style={{ fontSize: 9.5, fontWeight: 800, color: "#6b5a1f", textTransform: "uppercase", letterSpacing: 0.4 }}>
                    nota interna{it.n.autor ? ` · ${it.n.autor}` : ""}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#6b5a1f", whiteSpace: "pre-wrap", marginTop: 2 }}>{it.n.texto}</div>
                </div>
              );
              if (it.k === "t") return (
                <div key={`t${it.t.id}`} style={{ textAlign: "center", margin: "6px 0" }}>
                  <span style={{ fontSize: 10.5, color: c.gray, background: c.surface, border: `1px solid ${c.border}`, borderRadius: 20, padding: "3px 10px" }}>
                    ↪ {it.t.de_carteira ?? "ninguém"} → <b>{it.t.para_carteira}</b>
                    {it.t.observacao ? ` · ${it.t.observacao}` : ""}
                  </span>
                </div>
              );

              const m = it.m;
              if (m.tipo === "evento_sistema") return null;
              const doCliente = m.enviada_por === "customer";
              const falhou = m.status === "failed";
              const corpo = limpa(m.conteudo);
              return (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: doCliente ? "flex-start" : "flex-end", marginBottom: 5 }}>
                  <div style={{ maxWidth: "82%", background: doCliente ? "#f2f4f7" : "#eaf3fb", border: `1px solid ${doCliente ? "#e4e8ee" : "#cfe2f5"}`, borderRadius: 12, borderTopLeftRadius: doCliente ? 3 : 12, borderTopRightRadius: doCliente ? 12 : 3, padding: "6px 10px" }}>
                    {m.tipo === "template" && (
                      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.4, color: c.marca, textTransform: "uppercase", marginBottom: 2 }}>template</div>
                    )}
                    <Midia m={m} c={c} />
                    {corpo && (
                      <div style={{ fontSize: 12.5, lineHeight: 1.42, color: c.ink, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{corpo}</div>
                    )}
                    <div style={{ marginTop: 2, textAlign: "right", fontSize: 9.5, color: c.grayLight, display: "flex", gap: 4, justifyContent: "flex-end", alignItems: "center" }}>
                      {horaBR(m.criada_em)}
                      {!doCliente && <Ticks status={m.status} erro={m.erro} c={c} />}
                    </div>
                  </div>
                  {/* A falha sai do `title`: em toque não existe hover, e o motivo
                      da Meta é a única pista útil quando o envio não sai (§29.2). */}
                  {falhou && !doCliente && (
                    <div style={{ fontSize: 10.5, color: c.aviso, marginTop: 2, maxWidth: "82%", textAlign: "right" }}>
                      não entregue{m.erro ? ` — ${m.erro}` : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          ))}
        </>)}
        <div ref={fim} />
      </div>

      {/* ---- compositor ---------------------------------------------------- */}
      {!sintetico && (
        <div style={{ borderTop: `1px solid ${c.border}`, padding: "8px 12px 10px", background: c.surface }}>
          {aviso && (
            <div style={{ fontSize: 11.5, color: c.aviso, marginBottom: 6, lineHeight: 1.4 }}>{aviso}</div>
          )}

          {janelaAberta ? (
            <>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <textarea
                  ref={caixa}
                  value={texto}
                  onChange={(e) => {
                    setTexto(e.target.value);
                    // cresce com o texto até um teto — é o que faz a caixa
                    // parecer um chat em vez de um campo de formulário
                    const el = e.target;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
                  }}
                  onKeyDown={(e) => {
                    // Enter envia, Shift+Enter quebra linha — a convenção de
                    // qualquer chat. Sem isso, escrever dois parágrafos obriga
                    // a usar o mouse.
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); }
                  }}
                  rows={1}
                  placeholder="Escreva uma mensagem…"
                  disabled={enviando}
                  style={{
                    flex: 1, minWidth: 0, resize: "none", overflowY: "auto", maxHeight: 110,
                    fontSize: 13, fontFamily: "inherit", lineHeight: 1.4, color: c.ink,
                    padding: "8px 11px", border: `1px solid ${c.border}`, borderRadius: 10, outline: "none",
                  }}
                />
                <button
                  onClick={() => void enviar()}
                  disabled={enviando || !texto.trim()}
                  title="Enviar (Enter) · Shift+Enter quebra linha"
                  style={{
                    flexShrink: 0, cursor: enviando || !texto.trim() ? "default" : "pointer",
                    background: enviando || !texto.trim() ? c.grayLight : c.acao,
                    color: "#fff", border: "none", borderRadius: 10, padding: "0 14px", height: 36,
                    fontSize: 15, fontWeight: 700,
                  }}
                >{enviando ? "…" : "➤"}</button>
              </div>
              <div style={{ fontSize: 10, color: c.gray, marginTop: 4 }}>
                Janela aberta · fecha em <b>{restante}</b>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: c.aviso, lineHeight: 1.4, flex: "1 1 180px", minWidth: 0 }}>
                {ultimaRecebida
                  ? "A janela de 24h fechou — só um template reabre a conversa."
                  : canalEnvio === "whatsapp"
                    ? "Sem conversa aberta neste número — só um template inicia."
                    : "Esta cliente ainda não respondeu — só um template inicia a conversa."}
              </span>
              {aoPedirTemplate && (
                <button
                  onClick={aoPedirTemplate}
                  disabled={enviandoTemplate}
                  title="Enviar o template padrão para reabrir a conversa"
                  style={{
                    flexShrink: 0, cursor: enviandoTemplate ? "wait" : "pointer",
                    background: "#f8e6ec", color: "#9c1f47", border: "1px solid #ecc6d2",
                    borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 800,
                  }}
                >{enviandoTemplate ? "ENVIANDO…" : "TEMPLATE"}</button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
