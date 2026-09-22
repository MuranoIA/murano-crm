import { sessaoDoChat } from "../../../chat-v2/_dados/servidor";
import { contarFilas } from "../../../chat-v2/_dados/lista";

export const dynamic = "force-dynamic";

// Os cinco números dos chips, sobre a lista INTEIRA.
//
// Rota própria, e não parte da carga da página, porque contar exige varrer as
// ~4 mil conversas: dentro da página isso levou a primeira pintura de 994 ms
// para 3.816 ms (medido em 19/09/2026). Aqui a tela já apareceu com as 60
// primeiras conversas, e os contadores entram meio segundo depois.
//
// Devolve CINCO NÚMEROS, não a lista — é a diferença entre 1 kB e 2,7 MB.
export async function GET() {
  const s = sessaoDoChat();
  if (!s) return Response.json({ error: "não autenticado" }, { status: 401 });
  try {
    return Response.json(await contarFilas(s));
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
