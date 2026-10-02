"use client";

import { useEffect, useMemo, useState } from "react";
import { aplicarVariaveis, conferirVariaveis, variaveisDe } from "../../../lib/templateVars";

// Escolher um template e ver O QUE A CLIENTE VAI LER antes de mandar.
//
// Carregado por `next/dynamic`: quem não manda template não baixa este código.
//
// ⚠️ TODOS os campos aparecem, o `{{1}}` inclusive, já preenchido com o
// primeiro nome e editável — como no chat de hoje. A primeira versão escondia o
// `{{1}}` e mandava só os outros; a rota exige o valor de CADA campo e recusava
// com "este template tem 2 campos para preencher" (bug do piloto, 22/09).
//
// A régua de campos é a de `lib/templateVars`, a MESMA do servidor e do chat de
// hoje. Uma cópia local divergiria dela na primeira mudança — e o sintoma seria
// exatamente este erro de novo.

type Template = {
  id: number;
  nome: string;
  canal: string | null;
  meta_nome: string | null;
  corpo: string | null;
  usa_nome: boolean | null;
  padrao: boolean | null;
  status: string | null;
};

/** Os campos do template. Sem corpo (cadastro antigo) é o `{{1}}` do nome,
 *  quando o template o usa — a mesma conta da rota de envio. */
const camposDe = (t: Template | null): number[] =>
  !t ? [] : t.corpo ? variaveisDe(t.corpo) : t.usa_nome ? [1] : [];

export default function Templates({
  primeiroNome,
  enviando,
  aoFechar,
  aoEnviar,
}: {
  primeiroNome: string;
  enviando: boolean;
  aoFechar: () => void;
  aoEnviar: (t: { template_id: string; nome: string; variaveis: string[]; texto: string }) => void;
}) {
  const [lista, setLista] = useState<Template[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState<Template | null>(null);
  const [valores, setValores] = useState<Record<number, string>>({});
  // "Retirar da lista" (#59, rotulo ajustado na #61) em dois tempos: o primeiro clique pergunta,
  // o segundo faz. Não é `confirm()` porque isto já é um diálogo — um alerta do
  // navegador por cima de um modal é o tipo de empilhamento que faz a pessoa
  // clicar em OK sem ler. E não é um clique só porque a ação vale para TODA a
  // equipe: o freio é o mesmo do /admin (§29.4).
  const [perguntando, setPerguntando] = useState(false);
  const [escondendo, setEscondendo] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j?.error ?? String(r.status))))))
      .then((j) => {
        const ts: Template[] = j.templates ?? [];
        setLista(ts);
        setEscolhido(ts.find((t) => t.padrao) ?? ts[0] ?? null);
      })
      .catch((e) => setErro(String(e.message ?? e)));
  }, []);

  const campos = useMemo(() => camposDe(escolhido), [escolhido]);

  // o `{{1}}` chega com o primeiro nome da cliente — o ponto de partida, não
  // um valor fixo: dá para trocar (um apelido, o nome do salão)
  useEffect(() => {
    setValores(campos.includes(1) && primeiroNome ? { 1: primeiroNome } : {});
  }, [campos, primeiroNome]);

  // na ordem dos campos: é o formato que a rota espera, um valor por `{{n}}`
  const lista_ = campos.map((n) => String(valores[n] ?? ""));
  const previa = useMemo(
    () => aplicarVariaveis(String(escolhido?.corpo ?? ""), campos.map((n) => valores[n] || `⟨campo ${n}⟩`)),
    [escolhido, valores, campos],
  );

  const faltando = campos.filter((n) => !String(valores[n] ?? "").trim());
  // a mesma conferência do servidor (vazio, contagem, limite de 1024 da Meta),
  // dita ANTES do clique
  const problema = !escolhido || faltando.length ? null : conferirVariaveis(escolhido.corpo, lista_);

  // Some da lista para todo mundo; voltar é no /admin. O template continua
  // existindo na Meta — nada é apagado lá, que é o que o dono pediu.
  async function esconder() {
    if (!escolhido || escondendo) return;
    setEscondendo(true);
    setRecado(null);
    try {
      const r = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: escolhido.id, ativo: false }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
      const restante = (lista ?? []).filter((t) => t.id !== escolhido.id);
      setLista(restante);
      // ir para o padrão, e não para o vizinho de índice: o item some debaixo do
      // cursor, e cair num template qualquer convida a mandar o errado
      setEscolhido(restante.find((t) => t.padrao) ?? restante[0] ?? null);
      setRecado(`"${escolhido.nome}" saiu da lista.`);
      setPerguntando(false);
    } catch (e: any) {
      setRecado(String(e?.message ?? e));
    } finally {
      setEscondendo(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" onClick={aoFechar}>
      <div
        className="entrar flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-v2-superficie shadow-e3 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-v2-linha px-4 py-3">
          <h2 className="flex-1 text-[15px] font-semibold">Enviar template</h2>
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

        <div className="rolagem min-h-0 flex-1 overflow-y-auto p-4">
          {erro && <p className="rounded-lg bg-v2-erro-claro px-3 py-2 text-[13px] text-v2-erro">{erro}</p>}
          {!lista && !erro && <div className="esqueleto h-24 w-full" />}

          {lista && lista.length === 0 && (
            <p className="text-[13px] text-v2-tinta-fraca">
              Nenhum template aprovado. O administrador cadastra em Administração → Templates.
            </p>
          )}

          {lista && lista.length > 0 && (
            <>
              <label className="block text-[12px] font-medium uppercase tracking-wide text-v2-tinta-fraca">
                Template
              </label>
              <select
                value={escolhido?.id ?? ""}
                onChange={(e) => {
                  setEscolhido(lista.find((t) => String(t.id) === e.target.value) ?? null);
                  // trocar de template zera a pergunta E o recado: sem isto, o "saiu da
                  // lista" do anterior continuaria no lugar do botão, e o próximo
                  // template pareceria não ter como sair
                  setPerguntando(false);
                  setRecado(null);
                }}
                className="mt-1 h-11 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-3"
              >
                {lista.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                    {t.padrao ? " ★" : ""}
                  </option>
                ))}
              </select>

              {/* Retirar da lista (demandas #59 e #61). Fica colado no seletor de
                  propósito: a ação é sobre o item escolhido ali em cima, e não sobre
                  a tela. */}
              {/* o recado fica POR CIMA do botão, não no lugar dele: depois de tirar um
                  template a pessoa costuma querer tirar o seguinte, e uma falha precisa
                  poder ser repetida sem trocar de template para o botão voltar */}
              <div className="mt-2 flex min-h-[28px] flex-col gap-2">
                {recado && (
                  <p className="rounded-lg bg-v2-superficie-2 px-2.5 py-1.5 text-[12.5px] text-v2-tinta-fraca">{recado}</p>
                )}

                {escolhido?.padrao && (
                  <p className="text-[12px] text-v2-tinta-fraca">
                    ★ é o template padrão — o botão do card e o disparo em massa usam ele, então não sai da lista.
                  </p>
                )}

                {/* o nome do template sai do rótulo (ele está no seletor logo acima,
                    e com 46 caracteres o botão quebrava em duas linhas) e vai para o
                    `title`; quem confirma o lê por extenso no aviso */}
                {escolhido && !escolhido.padrao && !perguntando && (
                  <button
                    data-ripple
                    type="button"
                    onClick={() => setPerguntando(true)}
                    title={`Retirar “${escolhido.nome}” da lista de templates`}
                    className="self-start rounded-full border border-v2-linha-forte px-3 py-1.5 text-[13px] font-semibold text-v2-tinta-fraca hover:border-v2-erro hover:text-v2-erro"
                  >
                    Retirar da lista
                  </button>
                )}

                {escolhido && perguntando && (
                  <div className="rounded-xl border border-v2-linha-forte bg-v2-superficie-2 p-2.5">
                    {/* ⚠️ UMA informação só, e é a que muda a decisão: o template sai
                        para todo mundo. O que o dono cortou aqui (que não apaga na Meta,
                        que o administrador devolve) é verdade, mas é tranquilizador e
                        não acionável — e num aviso de confirmação cada linha a mais
                        disputa a atenção com a única que precisa ser lida. */}
                    <p className="text-[12.5px] leading-[1.45] text-v2-tinta">
                      Retirar <b>{escolhido.nome}</b> da lista? Ele sai da lista de
                      <b> todos os consultores</b>.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        data-ripple
                        type="button"
                        disabled={escondendo}
                        onClick={esconder}
                        className="rounded-full bg-v2-erro px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-60"
                      >
                        {escondendo ? "retirando…" : "Retirar da lista"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPerguntando(false)}
                        className="rounded-full px-3 py-1.5 text-[13px] font-medium text-v2-tinta-fraca hover:bg-v2-superficie"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {campos.map((n) => (
                <label key={n} className="mt-3 block">
                  <span className="text-[12px] font-medium uppercase tracking-wide text-v2-tinta-fraca">
                    Campo {n}
                    {n === 1 && <span className="font-normal normal-case"> · o nome da cliente</span>}
                  </span>
                  <input
                    value={valores[n] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [n]: e.target.value }))}
                    className="mt-1 h-11 w-full rounded-xl border border-v2-linha-forte bg-v2-superficie px-3 focus:border-v2-azul focus:outline-none"
                  />
                </label>
              ))}

              <div className="mt-4">
                <p className="text-[12px] font-medium uppercase tracking-wide text-v2-tinta-fraca">
                  O que ela vai ler
                </p>
                <p className="mt-1 whitespace-pre-wrap rounded-2xl bg-v2-azul-claro px-3 py-2 text-[14px] leading-5">
                  {previa || "—"}
                </p>
                {problema && <p className="mt-2 text-[12.5px] text-v2-erro">{problema}</p>}
              </div>
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-v2-linha px-4 py-3">
          <p className="min-w-0 flex-1 text-[11.5px] text-v2-tinta-fraca">
            Template reabre a janela de 24h e é cobrado.
          </p>
          <button
            data-ripple
            disabled={!escolhido || faltando.length > 0 || !!problema || enviando}
            onClick={() =>
              escolhido &&
              aoEnviar({
                template_id: escolhido.meta_nome || escolhido.nome,
                nome: escolhido.nome,
                variaveis: lista_,
                texto: previa,
              })
            }
            className="shrink-0 rounded-full bg-v2-azul px-4 py-2 text-[14px] font-semibold text-white disabled:bg-v2-linha-forte"
          >
            {enviando ? "enviando…" : "Enviar"}
          </button>
        </footer>
      </div>
    </div>
  );
}
