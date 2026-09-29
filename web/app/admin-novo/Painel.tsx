"use client";

import { useState } from "react";
import { Campanhas } from "./Campanhas";
import type { PainelInicial, PessoaTransferencia } from "./_dados/painel";

type Pessoa = PessoaTransferencia;

const PAPEL: Record<string, string> = {
  "pos-venda": "Pós-venda",
  home: "Home",
  admin: "Administração",
  supervisao: "Supervisão",
  vendedor: "Consultor",
};

// ---------------------------------------------------------------------------
// A ÚNICA COISA QUE ESTE PAINEL FAZ HOJE: quem aparece na lista "Para quem" da
// transferência de conversa.
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

  return (
    <div className="v2 min-h-dvh bg-v2-fundo text-v2-tinta">
      <header className="sticky top-0 z-10 bg-v2-vinho px-4 py-2.5 text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <a
            href="/admin"
            className="rounded-lg bg-white/10 px-2.5 py-1 text-[12.5px] font-medium text-white/90 ring-1 ring-inset ring-white/15 hover:bg-white/20"
          >
            ← Administração
          </a>
          <h1 className="min-w-0 truncate text-[15px] font-semibold">Admin (novo)</h1>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium">em construção</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        <section className="rounded-2xl bg-v2-superficie p-4 shadow-e1 ring-1 ring-v2-linha">
          <h2 className="text-[15px] font-semibold">Lista de transferência</h2>
          <p className="mt-1 text-[13px] leading-5 text-v2-tinta-fraca">
            Quem aparece no seletor <b className="text-v2-tinta">Para quem</b> quando alguém transfere uma conversa
            no chat.
          </p>
          <p className="mt-2 rounded-xl bg-v2-superficie-2 px-3 py-2 text-[12.5px] leading-[18px] text-v2-tinta-fraca">
            Desmarcar aqui <b className="text-v2-tinta">só encurta a lista</b>. Não tira conversa de ninguém, não
            impede de atender e não muda carteira. Para tirar alguém do atendimento, use{" "}
            <a href="/admin" className="text-v2-azul underline">Administração › Usuários</a>.
          </p>

          {erro && (
            <p className="mt-3 rounded-lg bg-v2-erro-claro px-3 py-2 text-[12.5px] text-v2-erro">{erro}</p>
          )}
          <>
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
          </>
        </section>

        <Campanhas inicial={inicial} aoErro={setErro} />
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
  return (
    <div className="mt-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">{titulo}</h3>
      <p className="mt-0.5 text-[12px] text-v2-tinta-fraca">{dica}</p>
      {/* ⚠️ `list-none`: a folha do v2 vem SEM o preflight do Tailwind (de
          propósito — ver v2.css), então `<ul>` mantém o marcador padrão do
          navegador e a lista aparece com bolinhas. */}
      <ul className="mt-2 list-none space-y-1 p-0">
        {pessoas.map((p) => (
          <li key={p.email}>
            <label
              className={[
                "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset",
                p.visivel ? "bg-v2-azul-claro ring-v2-azul/30" : "bg-v2-superficie-2 ring-v2-linha",
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
              <span className="shrink-0 text-[11.5px] text-v2-tinta-fraca">
                {p.visivel ? "na lista" : "fora"}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
