// Ícones de interface do /chat — só para o desenho `bancada` (Direção 4).
//
// POR QUE existir, já que emoji funciona: emoji é desenhado pelo SISTEMA, não
// por nós. Cada um tem peso, cor e alinhamento óptico próprios — 📊 é azul e
// cheio, ✋ é amarelo, ↪ é uma seta fininha de texto — e num cabeçalho com sete
// ações lado a lado o resultado é sete pesos visuais diferentes competindo. É o
// que o laudo chama de "improvisado mesmo mostrando a coisa certa"
// (`prototipos/laudo-tema-premium.md`, item 18).
//
// Aqui todos são traço monocromático em `currentColor`, mesma caixa de 24, mesma
// espessura. A cor passa a ser decidida pelo botão, não pela fonte de emoji do
// Windows — e é isso que permite a regra de "um acento por região".
//
// ⚠️ Nos outros desenhos os emoji CONTINUAM. Este arquivo não é importado por
// eles, e trocar o ícone de quem não pediu quebraria o rollback exato.
//
// O dicionário é fechado de propósito: 15 nomes, os que a tela usa. Ícone que
// não é usado é peso morto que ninguém percebe estar quebrado.

import React from "react";

/** `d` de cada `<path>`; caixa de 24×24, traço, sem preenchimento. */
const CAMINHOS: Record<string, string[]> = {
  // ---- ações do cabeçalho da conversa --------------------------------------
  /** pegar atendimento — puxar para si */
  pegar: ["M12 3v12", "M7 10l5 5 5-5", "M4 21h16"],
  /** cliente — o painel do ERP */
  cliente: ["M6 20v-5", "M12 20v-9", "M18 20V4"],
  /** devolver para a fila */
  devolver: ["M9 14L4 9l5-5", "M20 20v-7a4 4 0 0 0-4-4H4"],
  /** transferir para outro vendedor */
  transferir: ["M15 14l5-5-5-5", "M4 20v-7a4 4 0 0 1 4-4h12"],
  /** resolver a conversa */
  resolver: ["M20 6L9 17l-5-5"],
  /** reabrir a que estava resolvida */
  reabrir: ["M1 4v6h6", "M3.5 15a9 9 0 1 0 2.1-9.4L1 10"],
  /** abrir no WhatsApp (sai do sistema) */
  externo: ["M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", "M15 3h6v6", "M10 14L21 3"],
  /** ligar */
  telefone: ["M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"],

  // ---- compositor -----------------------------------------------------------
  /** anexo */
  clipe: ["M21.4 11l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.9-2.9l8.5-8.5"],
  /** gravar áudio */
  microfone: ["M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v4", "M8 23h8"],
  /** parar a gravação */
  parar: ["M6 6h12v12H6z"],
  /** ouvir a gravacao antes de enviar */
  tocar: ["M8 5l11 7-11 7z"],
  /** pausar o ETL */
  pausa: ["M6 4h4v16H6z", "M14 4h4v16h-4z"],
  /** respostas rápidas */
  raio: ["M13 2L3 14h9l-1 8 10-12h-9l1-8z"],
  /** nota interna */
  nota: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M8 13h8", "M8 17h5"],
  /** enviar */
  enviar: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4 20-7z"],
};

export type NomeIcone = keyof typeof CAMINHOS;

/**
 * `tamanho` é a caixa em px. 17 é o corpo de emoji que estes substituem, então
 * 18 mantém o peso óptico sem mexer na altura do botão.
 *
 * `aria-hidden` porque TODO botão que usa isto já tem `title` — o leitor de tela
 * lê o título, e anunciar o desenho por cima seria repetição.
 */
export function Icone({ n, tamanho = 18, traco = 1.7 }: { n: NomeIcone; tamanho?: number; traco?: number }) {
  const ds = CAMINHOS[n];
  if (!ds) return null;
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={traco} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}>
      {ds.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
