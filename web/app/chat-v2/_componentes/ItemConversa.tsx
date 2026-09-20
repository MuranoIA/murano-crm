"use client";

import { memo } from "react";
import type { Conversa } from "./tipos";
import { iniciais, nomeLimpo, previa, quando, tomDoAvatar } from "./formato";

// Uma linha da lista. `memo` com props estáveis: quando uma mensagem chega, só
// a conversa dela muda de objeto — as outras 300 linhas não redesenham. É o
// oposto do chat antigo, onde o estado mora todo no mesmo componente de 5.400
// linhas e qualquer mudança redesenha a tela inteira.
function Linha({
  c,
  selecionada,
  aoAbrir,
  presentes,
}: {
  c: Conversa;
  selecionada: boolean;
  aoAbrir: (id: string) => void;
  /** outras pessoas com esta conversa aberta agora (anti-colisão) */
  presentes?: string[];
}) {
  const resolvida = c.status === "resolvida";
  return (
    <button
      data-ripple
      onClick={() => aoAbrir(c.cliente_id)}
      aria-current={selecionada ? "true" : undefined}
      className={[
        "relative flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors duration-150",
        "hover:bg-v2-superficie-2",
        selecionada ? "bg-v2-azul-claro" : "bg-transparent",
      ].join(" ")}
      style={{ transitionTimingFunction: "var(--ease-padrao)" }}
    >
      {/* filete azul: a conversa aberta é ESTADO, e estado nesta tela é azul.
          Filete e não fundo chapado — o fundo escuro atrapalharia a leitura da
          prévia, que é o que decide se vale abrir. */}
      {selecionada && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-v2-azul" />}

      <span
        aria-hidden
        className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-v2-tinta-fraca"
        style={{ background: tomDoAvatar(c.cliente_id) }}
      >
        {iniciais(c.cliente)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={[
              "min-w-0 flex-1 truncate text-[15px] leading-5",
              c.nao_lida ? "font-semibold text-v2-tinta" : "font-medium text-v2-tinta",
            ].join(" ")}
          >
            {nomeLimpo(c.cliente)}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-v2-tinta-fraca">{quando(c.ultima_atividade)}</span>
        </span>

        <span className="mt-0.5 flex items-center gap-2">
          <span
            className={[
              "min-w-0 flex-1 truncate text-[13px] leading-[18px]",
              c.nao_lida ? "text-v2-tinta" : "text-v2-tinta-fraca",
            ].join(" ")}
          >
            {previa(c)}
          </span>

          {/* laranja é acento pontual: só para o que PEDE resposta */}
          {c.nao_lida && <span aria-label="não lida" className="size-2 shrink-0 rounded-full bg-v2-laranja" />}
          {c.favorita && (
            <span aria-label="favorita" className="shrink-0 text-[12px] leading-none text-v2-azul">
              ★
            </span>
          )}
        </span>

        {(c.na_fila || resolvida || c.transferida_de || (presentes && presentes.length > 0)) && (
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {c.na_fila && (
              <span className="rounded-full bg-v2-laranja-claro px-1.5 py-px text-[10px] font-medium text-v2-laranja">
                na fila
              </span>
            )}
            {resolvida && (
              <span className="rounded-full bg-v2-ok-claro px-1.5 py-px text-[10px] font-medium text-v2-ok">
                resolvida
              </span>
            )}
            {c.transferida_de && (
              <span className="rounded-full bg-v2-vinho-claro px-1.5 py-px text-[10px] font-medium text-v2-vinho-texto">
                ↪ de {c.transferida_de}
              </span>
            )}
            {/* anti-colisão: alguém já está nesta conversa. Na LISTA basta o
                aviso de que há gente — o nome de quem é aparece ao abrir. */}
            {presentes && presentes.length > 0 && (
              <span
                title={`${presentes.join(", ")} ${presentes.length > 1 ? "estão" : "está"} nesta conversa`}
                className="rounded-full bg-v2-azul-claro px-1.5 py-px text-[10px] font-medium text-v2-azul"
              >
                👀 {presentes.length > 1 ? `${presentes.length} atendendo` : presentes[0]}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

export const ItemConversa = memo(Linha);
