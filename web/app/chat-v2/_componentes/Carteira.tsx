"use client";

import { memo, useMemo, useRef } from "react";
import { JanelaVirtual } from "../../../lib/virtualizacao";
import { nomeComCodigo } from "../../../lib/nomeCliente";
import { iniciais, telefoneBonito, tomDoAvatar } from "./formato";
import type { ItemCarteira } from "./tipos";

// ---------------------------------------------------------------------------
// MINHA CARTEIRA — a agenda, não uma fila de conversas (§38).
//
// Todo cliente do RCA, com ou sem conversa, em ordem ALFABÉTICA: é uma agenda,
// e com ~900 nomes procurar é o caminho principal. A busca da sidebar filtra.
//
// A chave é o `codcli`, não o `cliente_id` (§38.1): quem nunca conversou não
// tem contato ainda. As duas listas NÃO se misturam — a carteira troca de lugar
// com as conversas em vez de ser fundida nelas, e é isso que impede a mesma
// pessoa de aparecer duas vezes.
//
// Quem não tem contato aparece, nunca some (§36.1). Dois desfechos no clique,
// e nenhum é beco sem saída:
//   · o telefone do cadastro serve  -> cria o contato e abre a conversa;
//   · não serve                     -> abre o "Novo contato" com o nome do ERP.
// ---------------------------------------------------------------------------

function Linha({
  k,
  selecionada,
  temConversa,
  aoAbrir,
}: {
  k: ItemCarteira;
  selecionada: boolean;
  temConversa: boolean;
  aoAbrir: (k: ItemCarteira) => void;
}) {
  // "inerte" é só quem depende de alguém digitar o número. Quem tem telefone
  // bom no cadastro abre no clique mesmo sem contato — não há por que parecer
  // desligado.
  const inerte = !!k.precisa_telefone;
  return (
    <button
      data-ripple
      onClick={() => aoAbrir(k)}
      title={k.impedimento ?? undefined}
      aria-current={selecionada ? "true" : undefined}
      className={[
        "relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150",
        "hover:bg-v2-superficie-2",
        selecionada ? "bg-v2-azul-claro" : "bg-transparent",
      ].join(" ")}
    >
      {selecionada && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-v2-azul" />}
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-v2-tinta-fraca"
        style={{ background: tomDoAvatar(String(k.codcli)), opacity: inerte ? 0.6 : 1 }}
      >
        {iniciais(k.cliente)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-5 text-v2-tinta">
          {nomeComCodigo(k.cliente, k.codcli)}
        </span>
        <span
          className={[
            "mt-0.5 block truncate text-[13px] leading-[18px]",
            inerte ? "text-v2-laranja" : "text-v2-tinta-fraca",
          ].join(" ")}
        >
          {inerte
            ? k.impedimento ?? "sem telefone no cadastro"
            : [telefoneBonito(k.telefone), k.cidade].filter(Boolean).join(" · ")}
        </span>
      </span>
      {/* laranja só para o que PEDE ação; "sem conversa" é informação, cinza */}
      {inerte ? (
        <span className="shrink-0 rounded-full bg-v2-laranja-claro px-2 py-0.5 text-[10.5px] font-medium text-v2-laranja">
          informar número
        </span>
      ) : (
        !temConversa && (
          <span className="shrink-0 rounded-full bg-v2-superficie-2 px-2 py-0.5 text-[10.5px] font-medium text-v2-tinta-fraca">
            sem conversa
          </span>
        )
      )}
    </button>
  );
}

const ItemDaCarteira = memo(Linha);

export function ListaCarteira({
  carteira,
  busca,
  selecionada,
  comConversa,
  aoAbrir,
  raizRef,
}: {
  /** null = ainda carregando */
  carteira: ItemCarteira[] | null;
  busca: string;
  selecionada: string | null;
  /** cliente_ids com conversa; null = não sabemos (a lista inteira não veio) */
  comConversa: Set<string> | null;
  aoAbrir: (k: ItemCarteira) => void;
  raizRef: React.RefObject<HTMLDivElement>;
}) {
  const visiveis = useMemo(() => {
    if (!carteira) return [];
    const t = busca.trim().toLowerCase();
    if (!t) return carteira;
    const so = t.replace(/\D/g, "");
    return carteira.filter((k) => {
      if (String(k.cliente ?? "").toLowerCase().includes(t)) return true;
      if (so.length >= 3 && String(k.telefone ?? "").replace(/\D/g, "").includes(so)) return true;
      // o código do WinThor é como o time chama o cliente ao telefone
      return so.length >= 2 && String(k.codcli).startsWith(so);
    });
  }, [carteira, busca]);

  const chave = useRef((k: ItemCarteira) => String(k.codcli)).current;

  if (carteira === null) {
    return <p className="px-4 py-10 text-center text-[13px] text-v2-tinta-fraca">Carregando sua carteira…</p>;
  }
  if (!visiveis.length) {
    return (
      <p className="px-4 py-10 text-center text-[13px] text-v2-tinta-fraca">
        {busca.trim() ? `Nenhum cliente da carteira para “${busca.trim()}”.` : "Nenhum cliente na carteira."}
      </p>
    );
  }

  const semTelefone = carteira.filter((k) => k.precisa_telefone).length;
  return (
    <>
      <p className="sticky top-0 z-[1] border-b border-v2-linha bg-v2-superficie-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-v2-tinta-fraca">
        {visiveis.length} cliente{visiveis.length === 1 ? "" : "s"}
        {semTelefone > 0 && (
          <span className="font-normal normal-case"> · {semTelefone} sem telefone no cadastro</span>
        )}
      </p>
      <JanelaVirtual
        itens={visiveis}
        chave={chave}
        raizRef={raizRef}
        alturaEstimada={64}
        ativo={visiveis.length > 40}
        renderItem={(k) => (
          <ItemDaCarteira
            k={k}
            selecionada={!!k.cliente_id && k.cliente_id === selecionada}
            temConversa={comConversa === null || (!!k.cliente_id && comConversa.has(k.cliente_id))}
            aoAbrir={aoAbrir}
          />
        )}
      />
    </>
  );
}
