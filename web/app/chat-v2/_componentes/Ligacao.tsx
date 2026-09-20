"use client";

import { useEffect } from "react";
import { useState } from "react";
import { useLigacao, duracaoBR, DESFECHOS, type Chamada } from "../../../lib/ligacaoChat";

// ---------------------------------------------------------------------------
// A CAMADA DE LIGAÇÃO do chat-v2 — carregada por `next/dynamic`, sem SSR.
//
// Ela NÃO envolve a tela. Envolver seria o caminho óbvio (um provider de
// contexto em volta de tudo), e derrubaria justamente o que a fase 1 conquistou:
// com `ssr: false`, nada do que estivesse dentro apareceria no primeiro byte, e
// a lista voltaria a esperar o JS. Então esta camada é uma IRMÃ da tela: desenha
// só as suas quatro sobreposições e PUBLICA para cima o pouco que o cabeçalho
// da conversa precisa — discar, e saber se pode.
//
// ⚠️ Ela tem de estar montada SEMPRE, e não só quando alguém vai ligar: é ela
// que assina o canal `ligacao` e faz a campainha tocar quando a cliente liga
// para nós. Dinâmica pela ordem, não pela condição — o `RTCPeerConnection`, o
// `getUserMedia` e a máquina de estados saem do pedaço de JS da primeira
// pintura e chegam um instante depois, com a tela já de pé.
//
// A régua de quando tocar, o que é chamada viva e o que fazer quando ela morre
// está em `lib/ligacaoChat` — a MESMA do chat antigo (§22.2).
// ---------------------------------------------------------------------------

export type ApiLigacao = {
  ligar: (clienteId: string, nome: string) => void;
  ocupado: boolean;
  emChamada: boolean;
};

export default function CamadaLigacao({
  sessao,
  aoMudar,
  aoPublicar,
}: {
  sessao: { role: string; carteira: string | null } | null;
  /** recarrega thread e lista quando uma chamada muda de estado */
  aoMudar: () => void;
  /** entrega ao cabeçalho da conversa o botão de discar */
  aoPublicar: (api: ApiLigacao | null) => void;
}) {
  const lig = useLigacao({ sessao, aoMudar });

  // ⚠️ Publica só o que é ESTÁVEL entre renders. O objeto inteiro do hook nasce
  // novo a cada render: publicá-lo faria o pai gravar estado, re-renderizar o
  // filho, gerar outro objeto — um laço sem fim. `ligar` só troca de identidade
  // quando `ocupado` ou `chamada` mudam, ou seja, algumas vezes por chamada.
  const { ligar, ocupado, chamada } = lig;
  const emChamada = !!chamada;
  useEffect(() => {
    aoPublicar({ ligar, ocupado, emChamada });
    return () => aoPublicar(null);
  }, [ligar, ocupado, emChamada, aoPublicar]);

  return (
    <>
      {chamada && (
        <BarraChamada c={chamada} estadoRtc={lig.estadoRtc} mudo={lig.mudo} onMudo={lig.alternarMudo} onDesligar={lig.desligar} />
      )}
      {lig.recebida && (
        <ChamadaRecebida c={lig.recebida} ocupado={lig.ocupado} onAtender={lig.atender} onRecusar={lig.recusar} />
      )}
      {lig.desfechoDe && <Desfecho c={lig.desfechoDe} onSalvar={lig.salvarDesfecho} />}
      {lig.erro && (
        <Recado
          texto={lig.erro}
          acao={lig.pedirPara ? { rotulo: "Pedir autorização", fazer: lig.pedirPermissao } : null}
          ocupado={lig.ocupado}
          aoFechar={lig.limparErro}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Barra da chamada em curso.
//
// ⚠️ NO TOPO, e isso não é escolha de tema. Ela já foi `bottom: 0` em largura
// total, ou seja, ficava EM CIMA da caixa de texto: durante uma ligação não se
// digitava — e é justamente durante uma ligação que se anota o pedido, se manda
// o catálogo, se confirma o preço (§60.8, item 30 do laudo).
// ---------------------------------------------------------------------------
function BarraChamada({
  c, estadoRtc, mudo, onMudo, onDesligar,
}: {
  c: Chamada; estadoRtc: string; mudo: boolean; onMudo: () => void; onDesligar: () => void;
}) {
  const [seg, setSeg] = useState(0);
  useEffect(() => {
    const calc = () =>
      setSeg(c.atendida_em ? Math.max(0, Math.round((Date.now() - new Date(c.atendida_em).getTime()) / 1000)) : 0);
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [c.atendida_em]);

  const rotulo =
    c.status === "discando" ? "Chamando…"
    : c.status === "tocando" ? "Tocando no aparelho do cliente…"
    : estadoRtc === "conectado" ? "Em conversa"
    : estadoRtc === "caiu" ? "Conexão instável…"
    : "Conectando o áudio…";

  return (
    <div className="entrar fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center gap-3 bg-v2-vinho px-4 py-2.5 text-white shadow-e3 pt-[calc(0.625rem+env(safe-area-inset-top))]">
      <span
        aria-hidden
        className={["size-2.5 shrink-0 rounded-full", estadoRtc === "conectado" ? "bg-emerald-400" : "bg-amber-300"].join(" ")}
      />
      <span className="min-w-0 truncate text-[13px] font-semibold">{c.cliente_nome ?? "Cliente"}</span>
      <span className="text-[11.5px] text-white/80">{rotulo}</span>
      {c.atendida_em && <span className="text-[13px] font-semibold tabular-nums">{duracaoBR(seg)}</span>}
      <span className="flex-1" />
      <button
        data-ripple
        onClick={onMudo}
        title={mudo ? "Reativar o microfone" : "Desativar o microfone"}
        className={[
          "rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 ring-inset ring-white/30",
          mudo ? "bg-v2-laranja" : "bg-white/15",
        ].join(" ")}
      >
        {mudo ? "🔇 Mudo" : "🎤 Microfone"}
      </button>
      <button
        data-ripple
        onClick={onDesligar}
        className="rounded-full bg-v2-laranja px-4 py-1.5 text-[12.5px] font-bold"
      >
        📵 Desligar
      </button>
    </div>
  );
}

function ChamadaRecebida({
  c, ocupado, onAtender, onRecusar,
}: {
  c: Chamada; ocupado: boolean; onAtender: () => void; onRecusar: () => void;
}) {
  return (
    <div className="entrar fixed inset-x-3 top-3 z-[70] rounded-2xl border-2 border-v2-ok bg-v2-superficie p-4 shadow-e3 sm:left-auto sm:right-4 sm:w-[19rem]">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-v2-ok">📞 Chamada recebida</p>
      <p className="mt-1 text-[15px] font-bold leading-5 text-v2-vinho-texto">
        {c.cliente_nome ?? c.telefone ?? "Cliente"}
      </p>
      <p className="mt-0.5 text-[11.5px] text-v2-tinta-fraca">
        está ligando pelo WhatsApp
        {!c.carteira && <b className="text-v2-laranja"> · sem dono, na fila</b>}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          data-ripple
          onClick={onAtender}
          disabled={ocupado}
          className="h-10 flex-1 rounded-full bg-v2-ok text-[13.5px] font-bold text-white disabled:opacity-60"
        >
          {ocupado ? "…" : "Atender"}
        </button>
        <button
          data-ripple
          onClick={onRecusar}
          disabled={ocupado}
          className="h-10 flex-1 rounded-full bg-v2-laranja-claro text-[13.5px] font-semibold text-v2-laranja ring-1 ring-inset ring-v2-laranja/25 disabled:opacity-60"
        >
          Recusar
        </button>
      </div>
    </div>
  );
}

// "No que deu?" — a nossa tabulação por voz.
//
// Aparece também quando é a CLIENTE que desliga, que é o caso mais comum numa
// ligação de saída; sem isso a ligação mais frequente ficaria sem registro
// nenhum (§22.4).
function Desfecho({ c, onSalvar }: { c: Chamada; onSalvar: (motivo: string | null, obs: string) => void }) {
  const [motivo, setMotivo] = useState<string | null>(null);
  const [obs, setObs] = useState("");

  return (
    <div className="entrar fixed inset-x-3 bottom-3 z-[65] rounded-2xl border border-v2-linha bg-v2-superficie p-4 shadow-e3 sm:left-auto sm:right-4 sm:w-[21rem]">
      <p className="text-[10.5px] font-bold uppercase tracking-wide text-v2-vinho-texto">Ligação encerrada</p>
      <p className="mt-0.5 text-[11.5px] leading-4 text-v2-tinta-fraca">
        {c.cliente_nome ?? "Cliente"}
        {c.duracao_seg != null && <> · falou {duracaoBR(c.duracao_seg)}</>} — no que deu?
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {DESFECHOS.map((d) => {
          const ativo = motivo === d.v;
          return (
            <button
              key={d.v}
              data-ripple
              onClick={() => setMotivo(ativo ? null : d.v)}
              aria-pressed={ativo}
              className={[
                "rounded-full px-2.5 py-1 text-[11.5px] transition-colors",
                ativo ? "bg-v2-azul text-white" : "text-v2-tinta ring-1 ring-inset ring-v2-linha-forte",
              ].join(" ")}
            >
              {d.rotulo}
            </button>
          );
        })}
      </div>
      <input
        value={obs}
        onChange={(e) => setObs(e.target.value)}
        placeholder="Observação (opcional) — fica na conversa"
        className="mt-2 h-10 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie-2 px-3 text-[13px] placeholder:text-v2-tinta-fraca focus:border-v2-azul focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          data-ripple
          onClick={() => onSalvar(motivo, obs)}
          className="rounded-full bg-v2-azul px-4 py-1.5 text-[12.5px] font-bold text-white"
        >
          Salvar
        </button>
        <button onClick={() => onSalvar(null, "")} className="px-2 py-1.5 text-[12.5px] text-v2-tinta-fraca">
          agora não
        </button>
      </div>
    </div>
  );
}

// Erro da chamada. Quando é falta de autorização da cliente, o beco sem saída
// vira uma AÇÃO — é o caminho que a própria API aponta (§22.6): um cartão
// interativo que ela toca para permitir. Cota de 1 por dia, 2 por semana, então
// é um clique consciente e não algo automático.
function Recado({
  texto, acao, ocupado, aoFechar,
}: {
  texto: string;
  acao: { rotulo: string; fazer: () => void } | null;
  ocupado: boolean;
  aoFechar: () => void;
}) {
  return (
    <div className="entrar fixed inset-x-3 bottom-3 z-[66] rounded-2xl border border-v2-laranja/25 bg-v2-laranja-claro p-3.5 shadow-e2 sm:left-auto sm:right-4 sm:w-[21rem]">
      <p className="text-[13px] leading-5 text-v2-tinta">{texto}</p>
      <div className="mt-2 flex items-center gap-2">
        {acao && (
          <button
            data-ripple
            onClick={acao.fazer}
            disabled={ocupado}
            className="rounded-full bg-v2-laranja px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-60"
          >
            {ocupado ? "…" : acao.rotulo}
          </button>
        )}
        <button onClick={aoFechar} className="px-2 py-1.5 text-[12.5px] font-medium text-v2-tinta-fraca">
          fechar
        </button>
      </div>
    </div>
  );
}
