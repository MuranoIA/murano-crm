import { redirect } from "next/navigation";
import { sessaoDoChat } from "./_dados/servidor";
import { lerLista } from "./_dados/lista";
import { lerThread } from "./_dados/thread";
import { Casca } from "./_componentes/Casca";

// A tela é dinâmica por construção: depende do cookie de sessão e do que
// aconteceu no banco há dois segundos. Cache aqui serviria conversa de outra
// pessoa.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// A PRIMEIRA CARGA ACONTECE AQUI, NO SERVIDOR.
//
// No chat de hoje o navegador carrega o JS, hidrata, pede `/api/chat` e espera
// 3 MB — 7,4 s até a lista aparecer (fase 0). Aqui a lista já vai no documento:
// o que o vendedor vê no primeiro instante é conversa, não casca vazia.
//
// As duas leituras vão em paralelo. Com `?cliente=`, a conversa também chega
// pronta — é o caminho do link do board, do push e do F5 dentro de um
// atendimento.
// ---------------------------------------------------------------------------
export default async function PaginaChatV2({
  searchParams,
}: {
  // escrito como Promise-compatível de propósito (spec §6): no Next 15+
  // `searchParams` vira assíncrono, e aqui a mudança será só tirar o await de
  // cima de um objeto que já é aguardado.
  searchParams?: { cliente?: string; embed?: string };
}) {
  const s = sessaoDoChat();
  if (!s) redirect("/?erro=sessao");

  const cliente = typeof searchParams?.cliente === "string" ? searchParams.cliente : null;
  // A lupa do board embute ESTA tela num iframe estreito (§41). Lido no
  // servidor, e não de `location.search`, para o cabeçalho do produto nunca
  // piscar dentro do quadro antes de o JS decidir escondê-lo.
  const embutido = searchParams?.embed === "1";

  // No embutido a lista não é usada (a lupa mostra UMA conversa), então ela
  // vem no tamanho mínimo: o que aquela tela precisa é da thread.
  const [lista, thread] = await Promise.all([
    lerLista(s, embutido ? 1 : 60),
    cliente ? lerThread(cliente, 40) : Promise.resolve(null),
  ]);

  return <Casca inicial={lista} threadInicial={thread} embutido={embutido} />;
}
