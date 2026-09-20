"use client";

import { useMemo } from "react";
import { Thread } from "./Thread";
import { Compositor } from "./Compositor";
import type { Conversa as TConversa, Mensagem } from "./tipos";
import { iniciais, nomeLimpo, telefoneBonito, tomDoAvatar } from "./formato";

const VINTE_QUATRO_H = 24 * 3600 * 1000;

/** A janela de 24h desta conversa, calculada do que JÁ está na tela.
 *  Zero chamada nova: a última mensagem recebida veio junto da thread. */
function janela(mensagens: Mensagem[]) {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    if (mensagens[i].enviada_por === "customer") {
      const resta = new Date(mensagens[i].criada_em).getTime() + VINTE_QUATRO_H - Date.now();
      return { aberta: resta > 0, resta };
    }
  }
  return { aberta: false, resta: 0 };
}

const horasEMinutos = (ms: number) => {
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  return h >= 1 ? `${h}h${String(min % 60).padStart(2, "0")}` : `${min} min`;
};

export function Conversa({
  conversa,
  mensagens,
  temMais,
  carregando,
  carregandoAntigas,
  aoCarregarAntigas,
  aoVoltar,
  aoAbrirContato,
  painelAberto,
}: {
  conversa: TConversa | null;
  mensagens: Mensagem[];
  temMais: boolean;
  carregando: boolean;
  carregandoAntigas: boolean;
  aoCarregarAntigas: () => void;
  aoVoltar: () => void;
  aoAbrirContato: () => void;
  painelAberto: boolean;
}) {
  const j = useMemo(() => janela(mensagens), [mensagens]);

  if (!conversa) {
    return (
      <div className="hidden h-full place-items-center bg-v2-fundo md:grid">
        <p className="max-w-xs text-center text-[13.5px] leading-5 text-v2-tinta-fraca">
          Escolha uma conversa à esquerda.
          <br />
          Ela abre aqui, com o histórico do cliente ao lado.
        </p>
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-v2-fundo">
      {/* ---- cabeçalho ---------------------------------------------------- */}
      <header className="flex shrink-0 items-center gap-2 border-b border-v2-linha bg-v2-superficie px-2 py-2">
        <button
          data-ripple
          onClick={aoVoltar}
          aria-label="Voltar para a lista"
          className="grid size-10 shrink-0 place-items-center rounded-full text-v2-tinta-fraca md:hidden"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="m14 6-6 6 6 6" />
          </svg>
        </button>

        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-v2-tinta-fraca"
          style={{ background: tomDoAvatar(conversa.cliente_id) }}
        >
          {iniciais(conversa.cliente)}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-5">{nomeLimpo(conversa.cliente)}</p>
          <p className="truncate text-[12px] leading-4 text-v2-tinta-fraca">
            {conversa.codcli ? `cód. ${conversa.codcli} · ` : ""}
            {telefoneBonito(conversa.telefone)}
            {conversa.vendedor ? ` · ${conversa.vendedor}` : conversa.na_fila ? " · na fila" : ""}
          </p>
        </div>

        <button
          data-ripple
          onClick={aoAbrirContato}
          aria-pressed={painelAberto}
          title="Dados do cliente"
          className={[
            "grid size-10 shrink-0 place-items-center rounded-full transition-colors",
            painelAberto ? "bg-v2-azul-claro text-v2-azul" : "text-v2-tinta-fraca hover:bg-v2-superficie-2",
          ].join(" ")}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V9m5 10V5m5 14v-7m5 7V8" />
          </svg>
        </button>
      </header>

      {/* ---- a conversa ---------------------------------------------------- */}
      {carregando ? (
        <div className="flex-1 space-y-3 p-4">
          {[62, 40, 72, 48].map((w, i) => (
            <div key={i} className={i % 2 ? "flex justify-end" : ""}>
              <div className="esqueleto h-10" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      ) : (
        <Thread
          mensagens={mensagens}
          temMais={temMais}
          carregandoAntigas={carregandoAntigas}
          aoCarregarAntigas={aoCarregarAntigas}
        />
      )}

      {/* ---- a janela de 24h, ANTES de escrever ---------------------------
          No chat antigo ela só se manifesta como erro, depois da mensagem
          pronta (achado 2 do laudo de UX) — e cada descoberta tardia custa
          R$ 0,43 de template. */}
      {!carregando && (
        <div
          className={[
            "shrink-0 border-t px-3 py-1.5 text-[12px]",
            j.aberta
              ? "border-v2-linha bg-v2-superficie-2 text-v2-tinta-fraca"
              : "border-v2-laranja/20 bg-v2-laranja-claro text-v2-laranja",
          ].join(" ")}
        >
          {j.aberta ? (
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-v2-ok" aria-hidden />
              Janela aberta — fecha em <b className="tabular-nums font-semibold">{horasEMinutos(j.resta)}</b>
              <span className="ml-auto hidden h-1 w-24 overflow-hidden rounded-full bg-v2-linha sm:block">
                <span
                  className="block h-full rounded-full bg-v2-azul"
                  style={{ width: `${Math.max(2, Math.min(100, (j.resta / VINTE_QUATRO_H) * 100))}%` }}
                />
              </span>
            </span>
          ) : (
            <span>Janela de 24h fechada — só um template reabre a conversa.</span>
          )}
        </div>
      )}

      <Compositor podeEnviar={false} />
    </section>
  );
}
