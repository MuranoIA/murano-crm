"use client";

import { useState } from "react";
import { telefoneBonito } from "./formato";

// ---------------------------------------------------------------------------
// TROCAR O NÚMERO DA CLIENTE (pedido do usuário, 22/09/2026)
//
// A troca vale NA HORA no Pulse — o envio e o recebimento passam a usar o número
// novo — e vai para a fila do supervisor corrigir no WinThor
// (/admin → 🔄 Atualização cadastral). A regra toda mora na rota
// `/api/chat/trocar-numero`; aqui é só o gesto e o desfecho.
//
// ⚠️ O NÚMERO É DIGITADO DUAS VEZES. A plataforma não confirma se um número tem
// WhatsApp antes de mandar, e o primeiro contato no número novo é um TEMPLATE
// (a janela de 24h é por número): um dígito trocado mandaria o template, pago,
// para um desconhecido — com o nome da cliente dentro.
// ---------------------------------------------------------------------------
export function TrocarNumero({
  clienteId,
  atual,
  aoTrocou,
  aoAbrirConversa,
  aoAviso,
}: {
  clienteId: string;
  atual: string | null;
  aoTrocou: (novo: string) => void;
  aoAbrirConversa: (id: string) => void;
  aoAviso?: (texto: string, ok: boolean) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [um, setUm] = useState("");
  const [dois, setDois] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conflito, setConflito] = useState<{ cliente_id: string; nome: string | null } | null>(null);

  const d1 = um.replace(/\D/g, "");
  const d2 = dois.replace(/\D/g, "");
  const bate = d1.length >= 10 && d1 === d2;

  if (!aberto) {
    return (
      <button
        data-ripple
        onClick={() => { setAberto(true); setErro(null); setConflito(null); }}
        className="text-[12.5px] font-medium text-v2-azul underline-offset-2 hover:underline"
      >
        Trocar número
      </button>
    );
  }

  const campo =
    "mt-1 h-10 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-3 text-[14px] focus:border-v2-azul focus:outline-none";

  return (
    <div className="mt-2 rounded-2xl border border-v2-linha p-3">
      <p className="text-[12px] leading-4 text-v2-tinta-fraca">
        Hoje: <b className="text-v2-tinta">{telefoneBonito(atual)}</b>. O número novo passa a valer já, aqui no chat, e
        a correção vai para o supervisor fazer no WinThor. O primeiro contato por ele é um template.
      </p>
      <label className="mt-2 block text-[12px] text-v2-tinta-fraca">
        Número novo (com DDD)
        <input autoFocus inputMode="tel" value={um} onChange={(e) => setUm(e.target.value)} placeholder="(91) 98166-0019" className={campo} />
      </label>
      <label className="mt-2 block text-[12px] text-v2-tinta-fraca">
        Repita o número
        <input inputMode="tel" value={dois} onChange={(e) => setDois(e.target.value)} className={campo} />
      </label>
      {d2.length >= 10 && d1 !== d2 && <p className="mt-1 text-[12px] text-v2-laranja">Os dois números não são iguais.</p>}

      {erro && <p className="mt-2 text-[12.5px] leading-4 text-v2-erro">{erro}</p>}
      {conflito && (
        <button
          data-ripple
          onClick={() => aoAbrirConversa(conflito.cliente_id)}
          className="mt-2 w-full rounded-full bg-v2-azul-claro px-3 py-2 text-[13px] font-semibold text-v2-azul"
        >
          Abrir a conversa de {conflito.nome || "quem já usa esse número"}
        </button>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button data-ripple onClick={() => setAberto(false)} className="rounded-full px-3 py-1.5 text-[13px] text-v2-tinta-fraca">
          Cancelar
        </button>
        <button
          data-ripple
          disabled={!bate || ocupado}
          onClick={() => {
            setOcupado(true);
            setErro(null);
            setConflito(null);
            fetch("/api/chat/trocar-numero", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ cliente_id: clienteId, telefone: um }),
            })
              .then(async (r) => ({ r, j: await r.json().catch(() => ({})) }))
              .then(({ r, j }) => {
                if (!r.ok) {
                  setErro(j?.error ?? `erro ${r.status}`);
                  if (j?.conflito) setConflito(j.conflito);
                  return;
                }
                setAberto(false);
                setUm("");
                setDois("");
                aoTrocou(j.telefone);
                aoAviso?.(j.aviso ?? "Número trocado.", true);
              })
              .catch((e) => setErro(String(e?.message ?? e)))
              .finally(() => setOcupado(false));
          }}
          className="rounded-full bg-v2-azul px-3 py-1.5 text-[13px] font-semibold text-white disabled:bg-v2-linha-forte"
        >
          {ocupado ? "trocando…" : "Trocar"}
        </button>
      </div>
    </div>
  );
}
