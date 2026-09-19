"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// A fila de sugestões de template esperando o administrador.
//
// Mora aqui, e não dentro de `page.tsx` ou de `chat/page.tsx`, porque o mesmo
// número aparece nas DUAS telas. Duas cópias divergiriam no primeiro ajuste —
// e a divergência apareceria como "o board diz 2, o chat diz 3", que é o tipo
// de defeito que ninguém reporta porque parece implausível.
//
// ---- Por que o limiar é 4 HORAS ------------------------------------------
// Medido em 15/09/2026 sobre as 11 sugestões já avaliadas:
//
//     esperaram menos de 4h ....... 7   (mediana ~1h — o admin é rápido quando vê)
//     passaram de um dia .......... 4   (1d, 1d04h, e duas de 9 e 12 dias)
//
// A MÉDIA de 2 dias e 7 horas engana: ela é puxada por duas sugestões de teste
// de agosto. O problema real não é lentidão, é a que ESCAPA — então uma faixa
// permanente seria ruído em 7 de cada 11 casos, e ruído que aparece sempre é
// ruído que se aprende a ignorar.
//
// Com 4 horas, a faixa teria aparecido nas 4 que passaram do dia e em nenhuma
// das 7 que foram bem. O número saiu da medição, não de gosto.
// ---------------------------------------------------------------------------

export const HORAS_PARA_COBRAR = 4;

export type FilaDeSugestoes = {
  /** Quantas esperam o administrador. */
  n: number;
  /** Há quantas horas a mais antiga espera. `null` quando não há nenhuma. */
  horas: number | null;
  /** A mais antiga já passou do limiar? É o que decide a faixa do board. */
  cobrando: boolean;
};

const VAZIA: FilaDeSugestoes = { n: 0, horas: null, cobrando: false };

/**
 * Busca a fila UMA vez, quando a tela monta.
 *
 * Sem poll de propósito: o número muda duas vezes por semana, e um intervalo
 * aqui seria mais uma requisição por aba aberta pelo resto do dia — o vício
 * que a §15.1 tirou do board. Quem acabou de avaliar uma sugestão está no
 * /admin, que recarrega a própria lista; o board e o chat se atualizam no
 * próximo carregamento, que é frequente o bastante para uma fila desse ritmo.
 */
export function useSugestoesPendentes(ehAdmin: boolean): FilaDeSugestoes {
  const [fila, setFila] = useState<FilaDeSugestoes>(VAZIA);

  useEffect(() => {
    if (!ehAdmin) { setFila(VAZIA); return; }
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/templates/pendentes", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json().catch(() => null);
        if (!vivo || !j) return;
        const n = Number(j.n ?? 0) || 0;
        const horas = j.mais_antiga
          ? Math.floor((Date.now() - new Date(j.mais_antiga).getTime()) / 3_600_000)
          : null;
        setFila({ n, horas, cobrando: n > 0 && (horas ?? 0) >= HORAS_PARA_COBRAR });
      } catch {
        // A tela toda continua funcionando sem o selo. Um aviso que derruba a
        // página que ele decora é pior que o aviso ausente.
      }
    })();
    return () => { vivo = false; };
  }, [ehAdmin]);

  return fila;
}

/** "há 3 horas" / "há 2 dias" — a idade é o que cria urgência; o número
 *  sozinho ("2 pendentes") não distingue o normal do esquecido. */
export function idadeEmPalavras(horas: number | null): string {
  if (horas == null) return "";
  if (horas < 1) return "agora há pouco";
  if (horas < 24) return `há ${horas} hora${horas === 1 ? "" : "s"}`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} dia${dias === 1 ? "" : "s"}`;
}

/**
 * O selo ao lado de "⚙️ Administração", nas duas telas.
 *
 * Fica VERMELHO quando passa do limiar e discreto antes disso — a mesma régua
 * da faixa, para o selo e a faixa nunca contarem histórias diferentes sobre a
 * mesma fila.
 */
export function SeloSugestoes({ fila }: { fila: FilaDeSugestoes }) {
  if (!fila.n) return null;
  const cor = fila.cobrando
    ? { bg: "#b3261e", fg: "#ffffff" }
    : { bg: "#e8e0e6", fg: "#4a3b45" };
  return (
    <span
      title={`${fila.n} sugestão${fila.n === 1 ? "" : "ões"} de template esperando avaliação — a mais antiga ${idadeEmPalavras(fila.horas)}`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 16, height: 16, padding: "0 4px", marginLeft: 5,
        borderRadius: 999, background: cor.bg, color: cor.fg,
        fontSize: 10.5, fontWeight: 800, lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {fila.n > 9 ? "9+" : fila.n}
    </span>
  );
}
