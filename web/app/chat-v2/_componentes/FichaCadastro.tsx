"use client";

import { useEffect, useState } from "react";
import {
  CAMPOS_PADRAO, faltando, fichaEmTexto, textoPedidoDeDados, type CampoCadastro,
} from "../../../lib/cadastroCampos";

// ---------------------------------------------------------------------------
// FICHA PARA O WINTHOR (0109, §47) — paridade, lacuna 5.
//
// A cliente dita, a consultora cola, alguém digita no ERP depois. Substitui o
// "salvar nome e CPF", como no chat de hoje: a ficha grava os dois também
// (`PUT /api/chat/cadastro`), e pedir só o CPF deixava de fora endereço, IE e
// fantasia — a consultora voltava a perguntar, dias depois, o que a cliente
// teria respondido de uma vez.
//
// A LISTA DE CAMPOS NÃO MORA AQUI: vem de `crm_config.cadastro_campos`, pela
// rota. E a mensagem que pede os dados é GERADA da mesma lista — dois textos
// divergiriam, e alguém perguntaria duas vezes.
//
// "Pedir os dados" põe o texto na CAIXA DE MENSAGEM, não no WhatsApp: quem
// envia é a pessoa, depois de ler. Disparar mensagem real ao clicar num painel
// de consulta seria o tipo de engano que não tem desfazer.
// ---------------------------------------------------------------------------
export function FichaCadastro({
  clienteId,
  aoPedirDados,
  aoAviso,
}: {
  clienteId: string;
  /** escreve o pedido na caixa do compositor (não envia) */
  aoPedirDados?: (texto: string) => void;
  aoAviso?: (texto: string, ok: boolean) => void;
}) {
  const [campos, setCampos] = useState<CampoCadastro[]>(CAMPOS_PADRAO);
  const [dados, setDados] = useState<Record<string, string>>({});
  const [obs, setObs] = useState("");
  const [ficha, setFicha] = useState<any>(null);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    setAberto(false);
    setDados({});
    setObs("");
    setFicha(null);
    fetch(`/api/chat/cadastro?cliente_id=${encodeURIComponent(clienteId)}`)
      .then((r) => r.json())
      .then((j) => {
        // a resposta de A não pode aterrissar na ficha de B (§70)
        if (!vivo) return;
        setCampos(j?.campos ?? CAMPOS_PADRAO);
        setFicha(j?.ficha ?? null);
        setDados((j?.ficha?.dados ?? {}) as Record<string, string>);
        setObs(j?.ficha?.observacao ?? "");
        // ficha já começada reabre ABERTA: fechada, quem estava no meio acharia
        // que perdeu o que digitou ontem
        if (j?.ficha) setAberto(true);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [clienteId]);

  const falta = faltando(campos, dados);
  const preenchidos = campos.filter((c) => String(dados[c.k] ?? "").trim()).length;

  const pedir = (metodo: "PUT" | "POST", corpo: Record<string, unknown>, depois: () => void) => {
    setOcupado(true);
    fetch("/api/chat/cadastro", {
      method: metodo,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cliente_id: clienteId, ...corpo }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
        return j;
      })
      .then((j) => {
        depois();
        aoAviso?.(j?.aviso ?? "Ficha salva.", true);
      })
      .catch((e) => aoAviso?.(String(e?.message ?? e), false))
      .finally(() => setOcupado(false));
  };

  const campo =
    "mt-1 h-10 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-3 text-[14px] focus:border-v2-azul focus:outline-none";

  return (
    <section className="mt-4 rounded-2xl border border-v2-linha p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">
          Ficha para o WinThor
        </h3>
        {ficha?.copiado_em ? (
          <span className="rounded-full bg-v2-ok-claro px-2 py-px text-[10.5px] font-medium text-v2-ok">cadastrada</span>
        ) : (
          preenchidos > 0 && (
            <span className="text-[11px] tabular-nums text-v2-tinta-fraca">
              {preenchidos}/{campos.length}
            </span>
          )
        )}
      </div>

      {aoPedirDados && (
        <button
          data-ripple
          onClick={() => aoPedirDados(textoPedidoDeDados(campos, String(dados["nome"] ?? "").trim().split(/\s+/)[0]))}
          className="w-full rounded-full bg-v2-azul-claro px-3 py-2 text-[13px] font-semibold text-v2-azul"
        >
          Pedir os dados à cliente
        </button>
      )}

      {!aberto ? (
        <button
          data-ripple
          onClick={() => setAberto(true)}
          className="mt-2 w-full rounded-full px-3 py-2 text-[13px] font-medium text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-superficie-2"
        >
          Preencher a ficha
        </button>
      ) : (
        <div className="mt-2">
          {campos.map((c) => (
            <label key={c.k} className="mb-2 block">
              <span className="text-[11.5px] text-v2-tinta-fraca">
                {c.rotulo}
                {c.obrigatorio && <span className="text-v2-laranja"> *</span>}
                {c.ajuda && <span className="opacity-80"> — {c.ajuda}</span>}
              </span>
              <input
                value={dados[c.k] ?? ""}
                onChange={(e) => setDados((d) => ({ ...d, [c.k]: e.target.value }))}
                className={campo}
              />
            </label>
          ))}
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            placeholder="Observação (opcional)"
            className="w-full resize-y rounded-xl border border-v2-linha-forte bg-v2-superficie px-3 py-2 text-[14px] focus:border-v2-azul focus:outline-none"
          />
          {falta.length > 0 && <p className="mt-1 text-[11.5px] text-v2-laranja">Falta: {falta.join(", ")}</p>}
          <div className="mt-2 flex gap-2">
            <button
              data-ripple
              disabled={ocupado || falta.length > 0}
              onClick={() => pedir("PUT", { dados, observacao: obs }, () => setFicha({ ...(ficha ?? {}), dados, observacao: obs }))}
              className="flex-1 rounded-full bg-v2-azul px-3 py-2 text-[13px] font-semibold text-white disabled:bg-v2-linha-forte"
            >
              {ocupado ? "Salvando…" : "Salvar ficha"}
            </button>
            <button
              data-ripple
              title="Copia a ficha em texto, um campo por linha, para colar no ERP"
              onClick={() =>
                navigator.clipboard?.writeText(fichaEmTexto(campos, dados)).then(
                  () => aoAviso?.("Ficha copiada — cole no WinThor.", true),
                  () => aoAviso?.("Não consegui copiar; selecione o texto à mão.", false),
                )
              }
              className="rounded-full px-3 py-2 text-[13px] font-semibold text-v2-azul ring-1 ring-inset ring-v2-linha-forte"
            >
              Copiar
            </button>
          </div>
          {ficha && (
            <button
              data-ripple
              disabled={ocupado}
              onClick={() =>
                pedir("POST", { desfazer: !!ficha.copiado_em }, () =>
                  setFicha((f: any) => ({ ...(f ?? {}), copiado_em: f?.copiado_em ? null : new Date().toISOString() })),
                )
              }
              className="mt-2 w-full rounded-full px-3 py-1.5 text-[12.5px] font-medium text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha"
            >
              {ficha.copiado_em ? "Desmarcar — ainda não cadastrei" : "Já cadastrei no WinThor"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// "É A MESMA PESSOA" (0117) — paridade, lacuna 6.
//
// O número não está no WinThor, mas o NOME está, com outro telefone: pode ser
// a cliente que trocou de número, ou um homônimo. O sistema não decide isso
// sozinho — a consultora decide, e o rótulo do botão diz o que ela AFIRMA, não
// o que ele executa. Dizer "sem cadastro" aqui seria falso (reclamação de
// 28/08/2026).
// ---------------------------------------------------------------------------
export type CandidatoErp = {
  codcli: number;
  nome: string;
  telefone: string | null;
  cidade: string | null;
  rca_num: number | null;
  rca_nome: string | null;
};

export function MesmaPessoa({
  clienteId,
  candidatos,
  aoAviso,
  aoVinculado,
}: {
  clienteId: string;
  candidatos: CandidatoErp[];
  aoAviso?: (texto: string, ok: boolean) => void;
  aoVinculado: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  if (!candidatos.length) return null;
  return (
    <section className="mt-3 rounded-2xl bg-v2-vinho-claro p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-v2-vinho-texto">
        Este número não está no cadastro
      </h3>
      <p className="mt-1 text-[12.5px] leading-[18px] text-v2-tinta">
        O nome já existe no WinThor{candidatos.length > 1 ? ` (${candidatos.length} cadastros)` : ""}, com{" "}
        <b>outro telefone</b>. Pode ser a mesma pessoa que <b>trocou de número</b> — ou um <b>homônimo</b>. Confira
        antes de decidir.
      </p>
      {candidatos.map((k) => (
        <div key={k.codcli} className="mt-2 rounded-xl bg-v2-superficie p-2.5 text-[12.5px]">
          <p className="font-semibold">{k.nome}</p>
          <p className="text-v2-tinta-fraca">
            cód. {k.codcli}
            {k.rca_num != null && ` · RCA ${k.rca_num}${k.rca_nome ? ` (${k.rca_nome})` : ""}`}
            {k.cidade && ` · ${k.cidade}`}
          </p>
          {k.telefone && <p className="text-v2-tinta-fraca">telefone no cadastro: {k.telefone}</p>}
          <button
            data-ripple
            disabled={ocupado}
            onClick={() => {
              if (!confirm(`Confirmar que este contato é ${k.nome} (cód. ${k.codcli})?`)) return;
              setOcupado(true);
              fetch("/api/chat/vincular", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ cliente_id: clienteId, codcli: k.codcli }),
              })
                .then(async (r) => {
                  const j = await r.json().catch(() => ({}));
                  if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
                  return j;
                })
                .then((j) => {
                  aoAviso?.(j?.aviso ?? "Vinculado ao cadastro do WinThor.", true);
                  aoVinculado();
                })
                .catch((e) => aoAviso?.(String(e?.message ?? e), false))
                .finally(() => setOcupado(false));
            }}
            className="mt-2 rounded-full bg-v2-vinho px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-60"
          >
            É a mesma pessoa
          </button>
        </div>
      ))}
    </section>
  );
}
