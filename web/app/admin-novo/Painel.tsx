"use client";

import { useEffect, useState } from "react";
import { Ripple } from "../chat-v2/_componentes/Ripple";
import { Campanhas } from "./Campanhas";
import { Vazio } from "./Vazio";
import type { PainelInicial, PessoaTransferencia } from "./_dados/painel";

type Pessoa = PessoaTransferencia;
type Aba = "transferencia" | "campanhas";

const PAPEL: Record<string, string> = {
  "pos-venda": "Pós-venda",
  home: "Home",
  admin: "Administração",
  supervisao: "Supervisão",
  vendedor: "Consultor",
};

// ---------------------------------------------------------------------------
// O PAINEL: lista de transferência + campanhas de distribuição.
//
// O LAYOUT segue o do Café Code (demanda #92, 29/09/2026 — "utilize as mesmas
// diretrizes... organize lá o layout"): barra fina só com o caminho de volta,
// título grande no conteúdo com uma linha que diz o que a página é, seções em
// abas quadradas (`rounded-lg`, nunca pílula), cada bloco num cartão
// `rounded-2xl` com hairline e elevação leve, número sempre `tabular-nums`.
// As cores continuam as do Pulse (tokens `v2-*`): do Café Code veio a
// organização, não a paleta.
//
// ⚠️ A TELA PRECISA DIZER O QUE O BOTÃO **NÃO** FAZ. Desmarcar aqui encurta uma
// lista; não tira conversa de ninguém, não impede de atender, não muda carteira.
// O interruptor que TIRA do atendimento é outro, mora em Administração ›
// Usuários, e confirma com o número de conversas que voltariam para a fila.
// Dois botões parecidos com consequências diferentes é como se perde uma tarde
// — e uma conversa.
// ---------------------------------------------------------------------------
export function Painel({ inicial }: { inicial: PainelInicial }) {
  // ⚠️ A 1ª CARGA VEM DO SERVIDOR (spec §2.3): o estado NASCE com os dados, e
  // não com `null` esperando um `fetch` na montagem. O `useState` só guarda o
  // que muda daqui para a frente.
  const [pessoas, setPessoas] = useState<Pessoa[]>(inicial.pessoas);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // A aba mora no `#` da URL: recarregar ou mandar o link abre na mesma seção.
  // Lida só depois de montar — o servidor não vê o `#`, e ler na 1ª pintura
  // faria o HTML do servidor e o do navegador divergirem.
  const [aba, setAba] = useState<Aba>("transferencia");
  useEffect(() => {
    if (window.location.hash === "#campanhas") setAba("campanhas");
  }, []);
  function escolher(a: Aba) {
    setAba(a);
    history.replaceState(null, "", a === "campanhas" ? "#campanhas" : window.location.pathname + window.location.search);
  }

  async function alternar(p: Pessoa, visivel: boolean) {
    setOcupado(p.email);
    // otimista: a lista é curta e a troca é reversível num clique — esperar o
    // servidor para pintar uma caixa de seleção só faria a tela parecer lenta
    setPessoas((ps) => ps.map((x) => (x.email === p.email ? { ...x, visivel } : x)));
    try {
      const r = await fetch("/api/admin/transferencia", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: p.email, visivel }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `erro ${r.status}`);
    } catch (e) {
      // desfaz o otimismo: melhor a caixa voltar do que a tela mentir
      setPessoas((ps) => ps.map((x) => (x.email === p.email ? { ...x, visivel: !visivel } : x)));
      setErro(String((e as any)?.message ?? e));
    } finally {
      setOcupado(null);
    }
  }

  const consultores = pessoas.filter((p) => p.carteira);
  const atendimento = pessoas.filter((p) => !p.carteira);
  const naLista = pessoas.filter((p) => p.visivel).length;

  // a aba de campanhas vai sem número de propósito: a lista dela muda dentro do
  // componente (criar, encerrar) e um número lido daqui ficaria velho
  const ABAS: { k: Aba; rotulo: string; n?: number }[] = [
    { k: "transferencia", rotulo: "Lista de transferência", n: naLista },
    { k: "campanhas", rotulo: "Campanhas" },
  ];

  return (
    <div className="v2 min-h-dvh bg-v2-fundo text-v2-tinta">
      <Ripple />
      {/* A BARRA: moldura da marca, fina e fixa. O título grande mora no
          conteúdo, como no Café Code; aqui só o caminho de volta e onde estou. */}
      <header className="sticky top-0 z-10 bg-v2-vinho pt-[env(safe-area-inset-top)] text-white shadow-e2">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <a
            href="/admin"
            data-ripple
            aria-label="Voltar para Administração"
            className="flex h-9 shrink-0 items-center rounded-lg px-3 text-[13px] font-semibold text-white/90 ring-1 ring-inset ring-white/20 hover:bg-white/10"
          >
            <span aria-hidden>←</span>
            <span className="ml-1.5 hidden sm:inline">Administração</span>
          </a>
          <span className="min-w-0 truncate text-[15px] font-extrabold tracking-[-0.01em]">Admin (novo)</span>
          <span className="ml-auto shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]">
            em construção
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-5 sm:px-6 sm:pt-8">
        <h1 className="text-[28px] font-black leading-tight tracking-[-0.03em] sm:text-[34px]">Administração</h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-5 text-v2-tinta-fraca">
          Quem aparece na transferência de conversa e as campanhas que distribuem, em rodízio, quem responde a um
          disparo.
        </p>

        {/* ⚠️ O ERRO FICA ACIMA DAS ABAS: ele vem das duas seções (a de
            campanhas também avisa por aqui). Dentro de uma aba, o erro da outra
            ficaria escondido. */}
        {erro && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-2xl bg-v2-erro-claro px-4 py-3 text-[13px] leading-5 text-v2-erro ring-1 ring-inset ring-v2-erro/20"
          >
            <span className="min-w-0 flex-1 break-words">{erro}</span>
            <button
              onClick={() => setErro(null)}
              className="shrink-0 rounded-lg px-2 py-0.5 text-[12px] font-semibold hover:bg-v2-erro/10"
            >
              Fechar
            </button>
          </div>
        )}

        <div role="tablist" aria-label="Seções do painel" className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {ABAS.map((a) => (
            <button
              key={a.k}
              role="tab"
              id={`aba-${a.k}`}
              aria-selected={aba === a.k}
              aria-controls={`secao-${a.k}`}
              data-ripple
              onClick={() => escolher(a.k)}
              className={[
                "flex h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-[13.5px] font-semibold transition-colors",
                aba === a.k
                  ? "bg-v2-vinho text-white shadow-e1"
                  : "bg-v2-superficie text-v2-tinta ring-1 ring-inset ring-v2-linha-forte hover:bg-v2-vinho-claro",
              ].join(" ")}
            >
              {a.rotulo}
              {a.n !== undefined && <span className="tabular-nums opacity-75">{a.n}</span>}
            </button>
          ))}
        </div>

        {/* ⚠️ AS DUAS SEÇÕES FICAM MONTADAS; a aba só esconde. Um disparo em
            andamento roda NESTA página (o laço é do navegador): desmontar a
            seção de campanhas ao trocar de aba perderia o progresso e a
            campanha pela metade. */}
        <section
          id="secao-transferencia"
          role="tabpanel"
          aria-labelledby="aba-transferencia"
          hidden={aba !== "transferencia"}
          className="mt-4 rounded-2xl bg-v2-superficie p-4 shadow-e1 ring-1 ring-v2-linha sm:p-5"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[18px] font-bold tracking-[-0.01em]">Lista de transferência</h2>
            <span className="text-[12.5px] tabular-nums text-v2-tinta-fraca">
              {naLista} de {pessoas.length} na lista
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-v2-tinta-fraca">
            Quem aparece no seletor <b className="text-v2-tinta">Para quem</b> quando alguém transfere uma conversa
            no chat.
          </p>
          <p className="mt-3 max-w-2xl rounded-xl bg-v2-superficie-2 px-3 py-2.5 text-[12.5px] leading-[18px] text-v2-tinta-fraca ring-1 ring-inset ring-v2-linha">
            Desmarcar aqui <b className="text-v2-tinta">só encurta a lista</b>. Não tira conversa de ninguém, não
            impede de atender e não muda carteira. Para tirar alguém do atendimento, use{" "}
            <a href="/admin" className="font-semibold text-v2-azul underline">Administração › Usuários</a>.
          </p>

          {pessoas.length ? (
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <Grupo
                titulo="Consultores"
                dica="Aparecem pelo nome da carteira, como hoje."
                pessoas={consultores}
                ocupado={ocupado}
                aoAlternar={alternar}
              />
              <Grupo
                titulo="Atendimento sem carteira"
                dica="Pós-venda, Home e administração — quem atende sem ter carteira comercial."
                pessoas={atendimento}
                ocupado={ocupado}
                aoAlternar={alternar}
              />
            </div>
          ) : (
            <Vazio texto="Nenhum usuário para listar." />
          )}
        </section>

        <div
          id="secao-campanhas"
          role="tabpanel"
          aria-labelledby="aba-campanhas"
          hidden={aba !== "campanhas"}
          className="mt-4"
        >
          <Campanhas inicial={inicial} aoErro={setErro} />
        </div>
      </main>
    </div>
  );
}

function Grupo({
  titulo, dica, pessoas, ocupado, aoAlternar,
}: {
  titulo: string;
  dica: string;
  pessoas: Pessoa[];
  ocupado: string | null;
  aoAlternar: (p: Pessoa, v: boolean) => void;
}) {
  if (!pessoas.length) return null;
  const marcados = pessoas.filter((p) => p.visivel).length;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <h3 className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-v2-tinta-fraca">{titulo}</h3>
        <span className="text-[12px] font-semibold tabular-nums text-v2-tinta-fraca">
          {marcados}/{pessoas.length}
        </span>
      </div>
      <p className="mt-0.5 text-[12px] leading-4 text-v2-tinta-fraca">{dica}</p>
      {/* ⚠️ `list-none`: a folha do v2 vem SEM o preflight do Tailwind (de
          propósito — ver v2.css), então `<ul>` mantém o marcador padrão do
          navegador e a lista aparece com bolinhas. */}
      <ul className="m-0 mt-2.5 list-none space-y-1.5 p-0">
        {pessoas.map((p) => (
          <li key={p.email}>
            <label
              className={[
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-inset transition-colors",
                p.visivel ? "bg-v2-azul-claro ring-v2-azul/30" : "bg-v2-superficie-2 ring-v2-linha hover:ring-v2-linha-forte",
              ].join(" ")}
            >
              <input
                type="checkbox"
                checked={p.visivel}
                disabled={ocupado === p.email}
                onChange={(e) => aoAlternar(p, e.target.checked)}
                className="size-4 shrink-0 accent-[var(--color-v2-azul)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">
                  {p.carteira ?? p.nome}
                  {p.papel && (
                    <span className="ml-1.5 text-[12px] font-normal text-v2-tinta-fraca">
                      {PAPEL[p.papel] ?? p.papel}
                    </span>
                  )}
                </span>
                {/* ⚠️ MARCADO E MESMO ASSIM FORA DA LISTA acontece: quem não tem
                    carteira precisa também de "atende no chat". Dizer o motivo
                    aqui evita a pergunta "marquei e não aparece". */}
                {p.impedimento && (
                  <span className="mt-0.5 block text-[11.5px] leading-4 text-v2-laranja">
                    não aparece: {p.impedimento}
                  </span>
                )}
              </span>
              <span
                className={[
                  "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                  p.visivel ? "bg-v2-superficie text-v2-azul" : "text-v2-tinta-fraca",
                ].join(" ")}
              >
                {p.visivel ? "na lista" : "fora"}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
