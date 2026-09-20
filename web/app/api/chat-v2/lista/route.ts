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
  const cru = new URL(req.url).searchParams.get("limite");
  const limite = cru && Number.isFinite(Number(cru)) ? Math.min(Math.max(Number(cru), 1), 1000) : null;
  try {
    return Response.json(await lerLista(s, limite));
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
