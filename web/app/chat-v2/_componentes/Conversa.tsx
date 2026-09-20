"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Thread, type Nota, type Transferencia } from "./Thread";
import type { Gesto } from "./Compositor";
import type { Ligacao } from "../../../lib/ligacaoDados";
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

function Acao({
  rotulo,
  ativo,
  cor,
  onClick,
  children,
}: {
  rotulo: string;
  ativo?: boolean;
  cor?: "azul" | "ok" | "vinho";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const pintura = ativo
    ? cor === "ok"
      ? "bg-v2-ok-claro text-v2-ok"
      : cor === "vinho"
        ? "bg-v2-vinho-claro text-v2-vinho-texto"
        : "bg-v2-azul-claro text-v2-azul"
    : "text-v2-tinta-fraca hover:bg-v2-superficie-2";
  return (
    <button
      data-ripple
      onClick={onClick}
      title={rotulo}
      aria-label={rotulo}
      aria-pressed={ativo}
      className={["grid size-10 shrink-0 place-items-center rounded-full transition-colors", pintura].join(" ")}
    >
      {children}
    </button>
  );
}

export function Conversa({
  conversa,
  mensagens,
  notas,
  transferencias,
  citadas,
  temMais,
  carregando,
  carregandoAntigas,
  aoCarregarAntigas,
  aoVoltar,
  aoAbrirContato,
  painelAberto,
  enviando,
  progresso,
  locais,
  aoEnviar,
  aoTemplate,
  aoReenviar,
  aoArquivos,
  aoLocal,
  aoNota,
  aoApagarNota,
  aoEncaminhar,
  aoFavoritar,
  aoTransferir,
  aoResolver,
  aoReabrir,
  aoPegar,
  aoErro,
  ligacoes,
  podeLigar,
  aoLigar,
  ligando,
  presentes,
  aoRegistrarGesto,
  semVoltar,
  citando,
  aoResponder,
  aoCancelarCitacao,
}: {
  conversa: TConversa | null;
  mensagens: Mensagem[];
  notas: Nota[];
  transferencias: Transferencia[];
  citadas: Record<string, { conteudo: string | null; enviada_por: string | null }>;
  temMais: boolean;
  carregando: boolean;
  carregandoAntigas: boolean;
  aoCarregarAntigas: () => void;
  aoVoltar: () => void;
  aoAbrirContato: () => void;
  painelAberto: boolean;
  enviando: boolean;
  progresso: string | null;
  locais: { nome: string; endereco?: string }[];
  aoEnviar: (texto: string) => void;
  aoTemplate: () => void;
  aoReenviar: (m: Mensagem) => void;
  aoArquivos: (arquivos: File[], legenda: string) => void;
  aoLocal: (indice: number) => void;
  aoNota: (texto: string) => void;
  aoApagarNota: (n: Nota) => void;
  aoEncaminhar: (m: Mensagem) => void;
  aoFavoritar: () => void;
  aoTransferir: () => void;
  aoResolver: () => void;
  aoReabrir: () => void;
  aoPegar: () => void;
  aoErro: (msg: string) => void;
  /** as chamadas desta conversa, como marcos na thread */
  ligacoes: Ligacao[];
  /** resolvido no SERVIDOR pela mesma função que a rota de ligação usa
   *  (`conversaNaCloud`). A tela não deduz: botão que aparece e falha é pior
   *  que botão ausente (§22.7 / nota do /api/chat/thread). */
  podeLigar: boolean;
  aoLigar: (() => void) | null;
  ligando: boolean;
  /** outras pessoas nesta conversa agora */
  presentes?: string[];
  /** o compositor devolve por aqui os dois gestos que moram dentro dele
   *  (gravar e anexar), para o `?acao=` da lupa do board poder disparar */
  aoRegistrarGesto?: (fn: Gesto | null) => void;
  /** na lupa não há lista para onde voltar */
  semVoltar?: boolean;
  citando?: { id: string; trecho: string; minha: boolean } | null;
  aoResponder?: (m: Mensagem) => void;
  aoCancelarCitacao?: () => void;
}) {
  const j = useMemo(() => janela(mensagens), [mensagens]);

  // ---- ARRASTAR E SOLTAR ------------------------------------------------
  //
  // A zona é a CONVERSA INTEIRA, não a caixa de texto: quem arrasta uma foto
  // mira no lugar onde ela vai aparecer, não num campo de 36 px.
  //
  // Quem envia continua sendo o compositor, pela mesma função do clipe — daí a
  // ponte: ele registra o gesto aqui e a thread só o dispara.
  const gesto = useRef<Gesto | null>(null);
  const registrar = useCallback(
    (fn: Gesto | null) => {
      gesto.current = fn;
      aoRegistrarGesto?.(fn);
    },
    [aoRegistrarGesto],
  );

  // contador, e não um booleano: `dragleave` dispara ao entrar em cada filho, e
  // com booleano o aviso pisca a cada bolha que o cursor atravessa
  const profundidade = useRef(0);
  const [sobre, setSobre] = useState(false);

  /** Arrastar TEXTO ou um link não pode acender o aviso de soltar arquivo. */
  const ehArquivo = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

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

  const resolvida = conversa.status === "resolvida";

  return (
    <section
      className="relative flex h-full min-h-0 flex-col bg-v2-fundo"
      onDragEnter={(e) => {
        if (!ehArquivo(e)) return;
        e.preventDefault();
        profundidade.current++;
        setSobre(true);
      }}
      onDragOver={(e) => {
        if (!ehArquivo(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!ehArquivo(e)) return;
        profundidade.current = Math.max(0, profundidade.current - 1);
        if (!profundidade.current) setSobre(false);
      }}
      onDrop={(e) => {
        if (!ehArquivo(e)) return;
        // ⚠️ sem o `preventDefault` o navegador ABRE o arquivo, trocando a aba
        // do CRM pela foto — e o que estava sendo escrito se perde
        e.preventDefault();
        profundidade.current = 0;
        setSobre(false);
        const fs = Array.from(e.dataTransfer.files ?? []);
        if (!fs.length) return;
        // Janela fechada: o envio falharia na Meta com 131047 depois de o
        // arquivo subir. Recusar antes é o mesmo remédio da faixa de 24h —
        // descobrir tarde é o que custa caro (§29.2).
        if (!j.aberta) {
          aoErro("A janela de 24h está fechada: só um template reabre a conversa.");
          return;
        }
        gesto.current?.("soltar", fs);
      }}
    >
      {/* ⚠️ `pointer-events-none` é obrigatório: uma camada que captura o mouse
          engoliria o próprio `drop` que ela anuncia. */}
      {sobre && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-v2-superficie/85">
          <div
            className={[
              "rounded-2xl border-2 border-dashed px-8 py-6 text-center",
              j.aberta ? "border-v2-azul text-v2-azul" : "border-v2-laranja text-v2-laranja",
            ].join(" ")}
          >
            <svg viewBox="0 0 24 24" className="mx-auto size-9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-6" />
              <path d="M12 3v12m0-12 4 4m-4-4-4 4" />
            </svg>
            <p className="mt-2 text-[14.5px] font-semibold">
              {j.aberta ? "Solte para anexar" : "Janela de 24h fechada"}
            </p>
            <p className="mt-0.5 text-[12px] opacity-80">
              {j.aberta ? "o que estiver escrito vira a legenda" : "só um template reabre a conversa"}
            </p>
          </div>
        </div>
      )}
      {/* ---- cabeçalho ---------------------------------------------------- */}
      <header className="flex shrink-0 flex-wrap items-center gap-1 border-b border-v2-linha bg-v2-superficie px-2 py-2">
        <button
          data-ripple
          onClick={aoVoltar}
          aria-label="Voltar para a lista"
          className={["grid size-10 shrink-0 place-items-center rounded-full text-v2-tinta-fraca md:hidden", semVoltar ? "hidden" : ""].join(" ")}
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

        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-[15px] font-semibold leading-5">{nomeLimpo(conversa.cliente)}</p>
          <p className="truncate text-[12px] leading-4 text-v2-tinta-fraca">
            {conversa.codcli ? `cód. ${conversa.codcli} · ` : ""}
            {telefoneBonito(conversa.telefone)}
            {conversa.vendedor ? ` · ${conversa.vendedor}` : conversa.na_fila ? " · na fila" : ""}
            {resolvida ? ` · resolvida${conversa.motivo ? ` (${conversa.motivo})` : ""}` : ""}
          </p>
        </div>

        {/* a conversa sem dono é de todos: quem vai atender precisa poder pegar
            em um clique, e o histórico de quem pegou sai de graça (§21) */}
        {conversa.na_fila && (
          <button
            data-ripple
            onClick={aoPegar}
            className="shrink-0 rounded-full bg-v2-azul px-3 py-1.5 text-[13px] font-semibold text-white"
          >
            ✋ Pegar
          </button>
        )}

        {/* Ligar só existe quando há linha para discar. Botão desabilitado
            com explicação seria pior: convida a clicar e ensina que o sistema
            não funciona. `aoLigar` nulo = a camada de ligação ainda está
            carregando (ela é dinâmica) — some por um instante, não trava. */}
        {podeLigar && conversa.telefone && aoLigar && (
          <Acao rotulo={ligando ? "já há uma ligação em andamento" : "Ligar pelo WhatsApp"} cor="ok" onClick={ligando ? () => {} : aoLigar}>
            <svg viewBox="0 0 24 24" className={["size-5", ligando ? "opacity-40" : ""].join(" ")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />
            </svg>
          </Acao>
        )}

        <Acao rotulo={conversa.favorita ? "Desfavoritar" : "Favoritar"} ativo={conversa.favorita} onClick={aoFavoritar}>
          <svg viewBox="0 0 24 24" className="size-5" fill={conversa.favorita ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
            <path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8L12 4Z" />
          </svg>
        </Acao>

        <Acao rotulo="Transferir conversa" cor="vinho" onClick={aoTransferir}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 17h11a4 4 0 0 0 0-8H7" />
            <path d="m10 6-3 3 3 3" />
          </svg>
        </Acao>

        <Acao rotulo={resolvida ? "Reabrir conversa" : "Resolver conversa"} ativo={resolvida} cor="ok" onClick={resolvida ? aoReabrir : aoResolver}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            {resolvida ? <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /> : <path d="m5 13 4 4 10-10" />}
          </svg>
        </Acao>

        <Acao rotulo="Dados do cliente" ativo={painelAberto} onClick={aoAbrirContato}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V9m5 10V5m5 14v-7m5 7V8" />
          </svg>
        </Acao>
      </header>

      {/* ---- anti-colisão: alguém mais está aqui --------------------------
          Azul porque é estado, não erro: duas pessoas na mesma conversa é
          normal (o supervisor confere enquanto a consultora atende). O que o
          aviso evita é a resposta duplicada. */}
      {presentes && presentes.length > 0 && (
        <p className="shrink-0 border-b border-v2-azul/15 bg-v2-azul-claro px-3 py-1 text-[12px] text-v2-azul">
          👀 {presentes.join(", ")} {presentes.length > 1 ? "estão" : "está"} nesta conversa agora
        </p>
      )}

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
          notas={notas}
          transferencias={transferencias}
          ligacoes={ligacoes}
          citadas={citadas}
          temMais={temMais}
          carregandoAntigas={carregandoAntigas}
          aoCarregarAntigas={aoCarregarAntigas}
          aoReenviar={aoReenviar}
          aoEncaminhar={aoEncaminhar}
          aoResponder={aoResponder}
          aoApagarNota={aoApagarNota}
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

      <Compositor
        podeEnviar={!carregando}
        janelaAberta={j.aberta}
        enviando={enviando}
        progresso={progresso}
        locais={locais}
        aoEnviar={aoEnviar}
        aoTemplate={aoTemplate}
        aoArquivos={aoArquivos}
        aoLocal={aoLocal}
        aoNota={aoNota}
        aoErro={aoErro}
        aoRegistrarGesto={registrar}
        citando={citando}
        aoCancelarCitacao={aoCancelarCitacao}
      />
    </section>
  );
}
