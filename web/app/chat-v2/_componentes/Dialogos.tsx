"use client";

import { useEffect, useState } from "react";
import { nomeLimpo } from "./formato";
import type { Conversa } from "./tipos";

// Os diálogos de atendimento: transferir, resolver, encaminhar e novo contato.
// Carregados por `next/dynamic` — quem só lê e responde não baixa nada disto.

function Moldura({
  titulo,
  children,
  rodape,
  aoFechar,
}: {
  titulo: string;
  children: React.ReactNode;
  rodape: React.ReactNode;
  aoFechar: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aoFechar]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 sm:items-center sm:p-4" onClick={aoFechar}>
      <div
        className="entrar flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-v2-superficie shadow-e3 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-v2-linha px-4 py-3">
          <h2 className="flex-1 text-[15px] font-semibold">{titulo}</h2>
          <button
            data-ripple
            onClick={aoFechar}
            aria-label="Fechar"
            className="grid size-9 place-items-center rounded-full text-v2-tinta-fraca hover:bg-v2-superficie-2"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="rolagem min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-v2-linha px-4 py-3">{rodape}</footer>
      </div>
    </div>
  );
}

const campo =
  "mt-1 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-3 py-2.5 focus:border-v2-azul focus:outline-none";
const primario = "rounded-full bg-v2-azul px-4 py-2 text-[14px] font-semibold text-white disabled:bg-v2-linha-forte";

// ---------------------------------------------------------------------------
// TRANSFERIR ≠ MUDAR CARTEIRA. A transferência vale só dentro do chat; a
// carteira é o dono comercial e vem do RCA do WinThor (§18). A tela DIZ isso,
// para ninguém usar o botão esperando trocar o RCA.
// ---------------------------------------------------------------------------
export function Transferir({
  conversa,
  vendedores,
  ocupado,
  aoFechar,
  aoConfirmar,
}: {
  conversa: Conversa;
  vendedores: { slug: string; cor: string | null }[];
  ocupado: boolean;
  aoFechar: () => void;
  aoConfirmar: (para: string | null, observacao: string) => void;
}) {
  const [para, setPara] = useState("");
  const [obs, setObs] = useState("");
  const devolver = para === "__fila";

  return (
    <Moldura
      titulo="Transferir conversa"
      aoFechar={aoFechar}
      rodape={
        <>
          <button data-ripple onClick={aoFechar} className="rounded-full px-3 py-2 text-[14px] text-v2-tinta-fraca">
            Cancelar
          </button>
          <button
            data-ripple
            disabled={!para || ocupado}
            onClick={() => aoConfirmar(devolver ? null : para, obs)}
            className={primario}
          >
            {ocupado ? "transferindo…" : devolver ? "Devolver para a fila" : "Transferir"}
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-5 text-v2-tinta-fraca">
        Passa <b className="text-v2-tinta">quem atende este diálogo</b>. A carteira do cliente não muda — ela é o dono
        comercial e vem do ERP.
      </p>

      <label className="mt-4 block">
        <span className="text-[12px] font-medium uppercase tracking-wide text-v2-tinta-fraca">Para quem</span>
        <select value={para} onChange={(e) => setPara(e.target.value)} className={campo}>
          <option value="">escolha…</option>
          {/* Devolver é uma linha a mais, não um botão escondido: quem pegou por
              engano precisa de uma saída óbvia (§56).

              ⚠️ SÓ quando o cliente NÃO tem dono comercial. Com carteira, o
              servidor recusa — devolvê-lo criaria um órfão, e o dono natural
              dele já existe. Oferecer a opção aqui seria o anti-padrão exato da
              §56: o botão aparece, a pessoa clica, e o servidor diz não. A
              paridade (fase 5) achou isto: o chat de hoje já escondia. */}
          {!conversa.carteira_dona && <option value="__fila">↩ devolver para a fila de espera</option>}
          {vendedores
            .filter((v) => v.slug !== conversa.vendedor)
            .map((v) => (
              <option key={v.slug} value={v.slug}>
                {v.slug}
              </option>
            ))}
        </select>
      </label>

      <label className="mt-3 block">
        <span className="text-[12px] font-medium uppercase tracking-wide text-v2-tinta-fraca">Motivo (aparece na conversa)</span>
        <input value={obs} onChange={(e) => setObs(e.target.value)} className={campo} placeholder="opcional" />
      </label>
    </Moldura>
  );
}

// ---------------------------------------------------------------------------
// RESOLVER com motivo — o motivo é a NOSSA tabulação, no fluxo natural do
// encerramento (§18 item 4). É o campo que transforma "atendi" em dado.
// ---------------------------------------------------------------------------
// ⚠️ os valores são os que `/api/chat/status` aceita — inventar rótulo aqui
// faria a rota recusar com "motivo inválido" só depois do clique
const MOTIVOS: { valor: string; rotulo: string }[] = [
  { valor: "venda_realizada", rotulo: "venda realizada" },
  { valor: "tentativa_contato", rotulo: "tentativa de contato" },
  { valor: "follow_up", rotulo: "follow-up" },
  { valor: "sem_interesse", rotulo: "sem interesse" },
  { valor: "outro", rotulo: "outro" },
];

export function Resolver({
  ocupado,
  aoFechar,
  aoConfirmar,
}: {
  ocupado: boolean;
  aoFechar: () => void;
  aoConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");

  return (
    <Moldura
      titulo="Resolver conversa"
      aoFechar={aoFechar}
      rodape={
        <>
          <button data-ripple onClick={aoFechar} className="rounded-full px-3 py-2 text-[14px] text-v2-tinta-fraca">
            Cancelar
          </button>
          <button
            data-ripple
            disabled={!motivo || ocupado}
            onClick={() => aoConfirmar(motivo)}
            className="rounded-full bg-v2-ok px-4 py-2 text-[14px] font-semibold text-white disabled:bg-v2-linha-forte"
          >
            {ocupado ? "encerrando…" : "Resolver"}
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-5 text-v2-tinta-fraca">
        A conversa sai da fila. <b className="text-v2-tinta">Ela reabre sozinha</b> se a cliente responder.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {MOTIVOS.map((m) => (
          <button
            key={m.valor}
            data-ripple
            onClick={() => setMotivo(m.valor)}
            className={[
              "rounded-full px-3 py-1.5 text-[13px]",
              motivo === m.valor ? "bg-v2-ok text-white" : "ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie-2",
            ].join(" ")}
          >
            {m.rotulo}
          </button>
        ))}
      </div>
    </Moldura>
  );
}

// ---------------------------------------------------------------------------
// ENCAMINHAR — e a tela avisa o que a API NÃO faz: a cliente recebe como
// mensagem normal, sem o selo "Encaminhada" (§49.2).
// ---------------------------------------------------------------------------
export function Encaminhar({
  trecho,
  conversas,
  ocupado,
  aoFechar,
  aoConfirmar,
}: {
  trecho: string;
  conversas: Conversa[];
  ocupado: boolean;
  aoFechar: () => void;
  aoConfirmar: (para: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [para, setPara] = useState<string | null>(null);
  const t = busca.trim().toLowerCase();
  const lista = conversas
    .filter((c) => !t || String(c.cliente ?? "").toLowerCase().includes(t))
    .slice(0, 40);

  return (
    <Moldura
      titulo="Encaminhar mensagem"
      aoFechar={aoFechar}
      rodape={
        <>
          <button data-ripple onClick={aoFechar} className="rounded-full px-3 py-2 text-[14px] text-v2-tinta-fraca">
            Cancelar
          </button>
          <button data-ripple disabled={!para || ocupado} onClick={() => para && aoConfirmar(para)} className={primario}>
            {ocupado ? "enviando…" : "Encaminhar"}
          </button>
        </>
      }
    >
      <p className="rounded-lg bg-v2-superficie-2 px-3 py-2 text-[13px] leading-5 text-v2-tinta-fraca">
        <span className="line-clamp-3 break-words">{trecho || "(mídia)"}</span>
      </p>
      <p className="mt-2 text-[12px] leading-4 text-v2-tinta-fraca">
        A cliente recebe como mensagem normal — o WhatsApp não deixa marcar como “encaminhada”.
      </p>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar conversa"
        className={campo}
      />

      <div className="mt-2 max-h-64 overflow-y-auto rounded-xl ring-1 ring-v2-linha">
        {lista.map((c) => (
          <button
            key={c.cliente_id}
            data-ripple
            onClick={() => setPara(c.cliente_id)}
            className={[
              "block w-full px-3 py-2 text-left text-[14px]",
              para === c.cliente_id ? "bg-v2-azul-claro" : "hover:bg-v2-superficie-2",
            ].join(" ")}
          >
            {nomeLimpo(c.cliente)}
          </button>
        ))}
        {lista.length === 0 && <p className="px-3 py-3 text-[13px] text-v2-tinta-fraca">Nenhuma conversa com esse nome.</p>}
      </div>
    </Moldura>
  );
}

// ---------------------------------------------------------------------------
// NOVO CONTATO (§35.2). Telefone e, opcional, nome.
//
// Não ENVIA nada: cadastrar e mandar mensagem são gestos separados de
// propósito — um clique em "abrir conversa" nunca deve disparar mensagem para
// um número digitado errado. Fora da janela de 24h o primeiro contato sai por
// template, e a faixa da conversa já diz isso.
//
// O mesmo diálogo serve à agenda quando o cadastro do WinThor não tem telefone
// utilizável: aí ele chega com o `codcli` e o nome do ERP, e o número digitado
// vira pedido de correção do cadastro. Uma tela de digitar número, não duas —
// elas divergiriam na primeira mudança.
// ---------------------------------------------------------------------------
export function NovoContato({
  doErp,
  ocupado,
  aoFechar,
  aoConfirmar,
}: {
  /** vindo da agenda: o cliente do ERP a quem o número pertence */
  doErp: { codcli: number; nome: string | null } | null;
  ocupado: boolean;
  aoFechar: () => void;
  aoConfirmar: (telefone: string, nome: string) => void;
}) {
  const [tel, setTel] = useState("");
  const [nome, setNome] = useState(doErp?.nome ?? "");
  const digitos = tel.replace(/\D/g, "");
  // a validação de verdade é do servidor (lib/telefone.ts); aqui só evita o
  // clique que certamente falha — DDD + 8 dígitos no mínimo
  const podeIr = digitos.length >= 10 && !ocupado;

  return (
    <Moldura
      titulo={doErp ? "Informar o número" : "Novo contato"}
      aoFechar={aoFechar}
      rodape={
        <>
          <button data-ripple onClick={aoFechar} className="rounded-full px-4 py-2 text-[14px] font-medium text-v2-tinta-fraca hover:bg-v2-superficie-2">
            Cancelar
          </button>
          <button data-ripple disabled={!podeIr} onClick={() => aoConfirmar(tel, nome)} className={primario}>
            {ocupado ? "Abrindo…" : "Abrir conversa"}
          </button>
        </>
      }
    >
      {doErp && (
        <p className="mb-3 rounded-xl bg-v2-laranja-claro px-3 py-2 text-[13px] text-v2-tinta">
          O cadastro do WinThor não tem um telefone utilizável para este cliente. O número que você
          informar abre a conversa e segue como pedido de correção do cadastro.
        </p>
      )}
      <label className="block text-[13px] font-medium text-v2-tinta-fraca">
        Telefone (com DDD)
        <input
          autoFocus
          inputMode="tel"
          value={tel}
          onChange={(e) => setTel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && podeIr && aoConfirmar(tel, nome)}
          placeholder="(91) 98166-0019"
          className={campo}
        />
      </label>
      {!doErp && (
        <label className="mt-3 block text-[13px] font-medium text-v2-tinta-fraca">
          Nome <span className="font-normal">(opcional)</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} />
        </label>
      )}
      <p className="mt-3 text-[12.5px] text-v2-tinta-fraca">
        Se o número já estiver na base, abre a conversa que existe — não duplica. Nada é enviado à
        cliente até você escrever.
      </p>
    </Moldura>
  );
}
