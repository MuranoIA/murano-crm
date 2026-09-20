"use client";

import { useEffect, useState } from "react";
import { DESFECHOS, VIVOS, duracaoBR, horaBR, type Chamada, type Ligacao } from "../../lib/ligacaoChat";
import { Icone } from "./icones";

// ---------------------------------------------------------------------------
// A ligacao COMO O CHAT ANTIGO A DESENHA.
//
// A logica (hook, campainha, sinalizacao) mudou-se para `lib/ligacaoChat.ts`
// -- ver o cabecalho de la. Este arquivo ficou so com os cinco pedacos de
// tela, e continua reexportando o que `page.tsx` importa daqui: do lado do
// chat que a equipe usa, nada mudou.
// ---------------------------------------------------------------------------

export { useLigacao, ligacaoViva, DESFECHOS } from "../../lib/ligacaoChat";
export type { Ligacao, Chamada } from "../../lib/ligacaoChat";

const M = {
  wine: "#621244", roxo: "#7b2d8b", roxoSoft: "#f1e6f4", azul: "#1a5fa8",
  laranja: "#dd4222", verde: "#1a6b3c", verdeSoft: "#eaf5ee",
  bg: "#f5edf4", surface: "#ffffff", border: "#e0cfdb",
  ink: "#241327", muted: "#9a8098", gray: "#6f5c6d",
};
// ---------------------------------------------------------------------------
// Botão 📞 do cabeçalho
//
// `naCloud` é o que restringe a ligação ao piloto: em conversa que ainda corre
// pelo RD o botão simplesmente NÃO EXISTE. Botão desabilitado com explicação
// seria pior — convida a clicar e ensina que o sistema não funciona. Quem manda
// de verdade é o servidor, que barra a chamada de qualquer jeito.
// ---------------------------------------------------------------------------
export function BotaoLigar({ onLigar, ocupado, emChamada, temTelefone, naCloud, compacto, pad, fonte, bancada }: {
  onLigar: () => void;
  ocupado: boolean; emChamada: boolean; temTelefone: boolean; naCloud: boolean;
  /** desenho `bancada`: icone de traco no lugar do emoji. Sem isto, este
   *  botao ficaria sendo o UNICO emoji colorido numa fileira de sete acoes
   *  monocromaticas -- que e exatamente a inconsistencia que o item 18 do
   *  laudo existe para acabar. */
  bancada?: boolean;
  /** dentro da lupa do board a largura util e ~500px: so o icone, com o texto
   *  no `title` que este botao ja tinha (§41.5) */
  compacto?: boolean;
  /** padding e tamanho do ícone, quando quem chama precisa alinhar este botão
   *  com os vizinhos (o celular usa alvos maiores que o desktop). */
  pad?: string;
  fonte?: number;
}) {
  if (!temTelefone || !naCloud) return null;

  const travado = ocupado || emChamada;
  return (
    <button onClick={onLigar} disabled={travado}
      title={emChamada ? "já há uma ligação em andamento" : "Ligar para o cliente pelo WhatsApp"}
      style={{ fontSize: fonte ?? 11.5, fontWeight: 700, color: M.verde, background: M.verdeSoft,
        border: "1px solid #bfe0cb", borderRadius: 999, padding: pad ?? (compacto ? "5px 9px" : "5px 11px"),
        cursor: travado ? "default" : "pointer", opacity: travado ? 0.55 : 1,
        fontFamily: "inherit", whiteSpace: "nowrap" }}>
      {ocupado ? "…" : bancada ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: compacto ? 0 : 6 }}>
          <Icone n="telefone" />{!compacto && "Ligar"}
        </span>
      ) : compacto ? "📞" : "📞 Ligar"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Barra da chamada em curso — fixa no rodapé, some ao desligar
// ---------------------------------------------------------------------------
export function BarraChamada({ c, estadoRtc, mudo, onMudo, onDesligar }: {
  c: Chamada; estadoRtc: string; mudo: boolean;
  onMudo: () => void; onDesligar: () => void;
}) {
  const [seg, setSeg] = useState(0);
  useEffect(() => {
    const calc = () => setSeg(c.atendida_em
      ? Math.max(0, Math.round((Date.now() - new Date(c.atendida_em).getTime()) / 1000)) : 0);
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [c.atendida_em]);

  const rotulo = c.status === "discando" ? "Chamando…"
    : c.status === "tocando" ? "Tocando no aparelho do cliente…"
    : estadoRtc === "conectado" ? "Em conversa"
    : estadoRtc === "caiu" ? "Conexão instável…"
    : "Conectando o áudio…";

  return (
    // ⚠️ TOPO, não rodapé — e isto vale para TODOS os desenhos, não é tema.
    // Ela era `bottom: 0` em largura total, ou seja, ficava EM CIMA da caixa de
    // texto: durante uma ligação não se digitava. E é justamente durante uma
    // ligação que se anota o pedido, se manda o catálogo, se confirma o preço.
    // O laudo mediu isso (§29.2 item 4); a correção é trocar a âncora.
    <div style={{ position: "fixed", left: 0, right: 0, top: 0, zIndex: 60,
      background: M.wine, color: "#fff", padding: "10px 16px",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      boxShadow: "0 4px 16px rgba(28,14,27,0.28)" }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
        background: estadoRtc === "conectado" ? "#5cd68a" : "#ffce4f" }} />
      <span style={{ fontSize: 13, fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {c.cliente_nome ?? "Cliente"}
      </span>
      <span style={{ fontSize: 11.5, opacity: 0.82 }}>{rotulo}</span>
      {c.atendida_em && (
        <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", opacity: 0.95 }}>
          {duracaoBR(seg)}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <button onClick={onMudo} title={mudo ? "Reativar o microfone" : "Desativar o microfone"}
          style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: mudo ? M.laranja : "rgba(255,255,255,0.16)",
            border: "1px solid rgba(255,255,255,0.3)", borderRadius: 999, padding: "5px 13px", cursor: "pointer", fontFamily: "inherit" }}>
        {mudo ? "🔇 Mudo" : "🎤 Microfone"}
      </button>
      <button onClick={onDesligar}
        style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: M.laranja, border: "none",
          borderRadius: 999, padding: "7px 17px", cursor: "pointer", fontFamily: "inherit" }}>
        📵 Desligar
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chamada recebida — o cliente está ligando
// ---------------------------------------------------------------------------
export function ChamadaRecebida({ c, ocupado, onAtender, onRecusar }: {
  c: Chamada; ocupado: boolean; onAtender: () => void; onRecusar: () => void;
}) {
  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 70, width: 300,
      background: M.surface, border: `2px solid ${M.verde}`, borderRadius: 14,
      boxShadow: "0 12px 34px rgba(28,14,27,0.26)", padding: 15 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", color: M.verde, marginBottom: 5 }}>
        📞 Chamada recebida
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: M.wine, lineHeight: 1.3, marginBottom: 2 }}>
        {c.cliente_nome ?? c.telefone ?? "Cliente"}
      </div>
      <div style={{ fontSize: 11, color: M.gray, marginBottom: 12 }}>
        está ligando pelo WhatsApp
        {!c.carteira && <b style={{ color: M.laranja }}> · sem dono, na fila</b>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onAtender} disabled={ocupado}
          style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#fff", background: M.verde, border: "none",
            borderRadius: 999, padding: "9px 0", cursor: ocupado ? "default" : "pointer", opacity: ocupado ? 0.6 : 1, fontFamily: "inherit" }}>
          {ocupado ? "…" : "Atender"}
        </button>
        <button onClick={onRecusar} disabled={ocupado}
          style={{ flex: 1, fontSize: 13, fontWeight: 700, color: M.laranja, background: "#fdeae3",
            border: "1px solid #f0c4b0", borderRadius: 999, padding: "9px 0", cursor: "pointer", fontFamily: "inherit" }}>
          Recusar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "No que deu?" — aparece assim que a chamada termina
// ---------------------------------------------------------------------------
export function DesfechoLigacao({ c, onSalvar }: {
  c: Chamada; onSalvar: (motivo: string | null, observacao: string) => void;
}) {
  const [obs, setObs] = useState("");
  const [motivo, setMotivo] = useState<string | null>(null);

  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 65, width: 316,
      background: M.surface, border: `1px solid ${M.border}`, borderRadius: 13,
      boxShadow: "0 10px 30px rgba(28,14,27,0.2)", padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: M.wine, marginBottom: 3 }}>
        Ligação encerrada
      </div>
      <div style={{ fontSize: 11.5, color: M.gray, marginBottom: 9, lineHeight: 1.4 }}>
        {c.cliente_nome ?? "Cliente"}
        {c.duracao_seg != null && <> · falou {duracaoBR(c.duracao_seg)}</>} — no que deu?
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
        {DESFECHOS.map((d) => (
          <button key={d.v} onClick={() => setMotivo(motivo === d.v ? null : d.v)}
            style={{ fontSize: 11.5, fontWeight: 600, color: motivo === d.v ? "#fff" : M.ink,
              background: motivo === d.v ? M.roxo : M.surface,
              border: `1px solid ${motivo === d.v ? M.roxo : M.border}`,
              borderRadius: 999, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit" }}>
            {d.rotulo}
          </button>
        ))}
      </div>
      <input value={obs} onChange={(e) => setObs(e.target.value)}
        placeholder="Observação (opcional) — fica na conversa"
        style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12, fontFamily: "inherit",
          color: M.ink, background: M.bg, border: `1px solid ${M.border}`, borderRadius: 8, outline: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <button onClick={() => onSalvar(motivo, obs)}
          style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: M.roxo, border: "none",
            borderRadius: 999, padding: "7px 16px", cursor: "pointer", fontFamily: "inherit" }}>
          Salvar
        </button>
        <button onClick={() => onSalvar(null, "")}
          style={{ fontSize: 12, color: M.gray, background: "transparent", border: "none", padding: "6px 4px", cursor: "pointer", fontFamily: "inherit" }}>
          agora não
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marco na thread — a ligação no ponto em que aconteceu, como a transferência
// ---------------------------------------------------------------------------
export function MarcoLigacao({ l }: { l: Ligacao }) {
  const entrada = l.direcao === "entrada";
  const ok = l.status === "concluida";
  const perdida = ["nao_atendida", "recusada", "falhou", "cancelada"].includes(l.status);
  const viva = VIVOS.includes(l.status);

  const cor = viva ? M.verde : perdida ? M.laranja : M.gray;
  const fundo = viva ? M.verdeSoft : perdida ? "#fdeae3" : M.surface;
  const borda = viva ? "#bfe0cb" : perdida ? "#f0c4b0" : M.border;

  const titulo = viva
    ? (entrada ? "Chamada recebida — em andamento" : "Ligação em andamento")
    : entrada
      ? (ok ? "Chamada recebida" : l.status === "recusada" ? "Chamada recusada" : "Chamada perdida")
      : (ok ? "Ligação feita" : l.status === "nao_atendida" ? "Não atendeu" : l.status === "falhou" ? "Ligação falhou" : "Ligação cancelada");

  const desfecho = DESFECHOS.find((d) => d.v === l.motivo)?.rotulo;

  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "6px 0" }}>
      <div style={{ maxWidth: "80%", textAlign: "center", fontSize: 11, color: cor, background: fundo,
        border: `1px solid ${borda}`, borderRadius: 999, padding: "4px 15px", lineHeight: 1.5 }}>
        {entrada ? "📲" : "📞"} <b>{titulo}</b>
        {l.duracao_seg != null && <span style={{ opacity: 0.8 }}> · {duracaoBR(l.duracao_seg)}</span>}
        <span style={{ opacity: 0.7 }}> · {horaBR(l.iniciada_em)}</span>
        {desfecho && <div style={{ fontWeight: 700, marginTop: 1 }}>{desfecho}</div>}
        {l.observacao && <div style={{ fontStyle: "italic", opacity: 0.85, marginTop: 1 }}>“{l.observacao}”</div>}
      </div>
    </div>
  );
}
