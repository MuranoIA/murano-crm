import { sessaoDoChat } from "../../../chat-v2/_dados/servidor";
import { lerLista } from "../../../chat-v2/_dados/lista";

export const dynamic = "force-dynamic";

// O RESTO da lista, buscado depois que a tela já apareceu.
//
// A primeira página vem no HTML (`app/chat-v2/page.tsx`). Esta rota completa o
// que falta, para a busca e os contadores valerem para a lista inteira — e é a
// MESMA função do servidor, não uma segunda implementação da régua de escopo.
// Duas fontes para a mesma pergunta foi o que a §71.1 do CLAUDE.md pagou caro.
//
// ⚠️ Não substitui o `/api/chat`: aquele continua servindo o chat antigo,
// intocado (regra 4 da spec).
export async function GET(req: Request) {
  const s = sessaoDoChat();
  if (!s) return Response.json({ error: "não autenticado" }, { status: 401 });
  // `?limite=60` = a mesma primeira página que a carga do servidor manda. É o
  // que a tela pede para se atualizar sem baixar as 4 mil conversas de novo.
  const p = new URL(req.url).searchParams;
  const cru = p.get("limite");
  const limite = cru && Number.isFinite(Number(cru)) ? Math.min(Math.max(Number(cru), 1), 1000) : null;
  // ---- os recortes da fase 4, sob demanda ---------------------------------
  // `etapas=1` e `linhas=1` só chegam quando a pessoa abre os filtros. Fora
  // disso a lista não paga por eles — ver a nota no cabeçalho de `_dados/lista`.
  const extras = { etapas: p.get("etapas") === "1", linhas: p.get("linhas") === "1" };
  try {
    return Response.json(await lerLista(s, limite, extras));
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
