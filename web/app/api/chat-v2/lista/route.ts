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
export async function GET() {
  const s = sessaoDoChat();
  if (!s) return Response.json({ error: "não autenticado" }, { status: 401 });
  try {
    return Response.json(await lerLista(s, null));
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
