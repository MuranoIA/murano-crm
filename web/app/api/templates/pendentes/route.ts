import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../../lib/papel";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Quantas sugestões de template esperam o administrador — e há quanto tempo.
//
// Pedido do usuário: "quando consultor criar template (que aparece em sugestão
// de template), deve aparecer uma notificação aviso na tela do administrador,
// para que ele possa aprovar o template. para que o template não fique
// esquecido lá."
//
// ⚠️ ROTA PRÓPRIA, E NÃO UM CAMPO NO /api/funil OU NO /api/chat.
// Aquelas duas são as rotas mais quentes do sistema e já carregam vários passes
// paginados; pendurar mais uma pergunta nelas encareceria TODA abertura de tela
// por um número que muda duas vezes por semana. Aqui é uma contagem e um
// `min()` sobre uma tabela de 12 linhas, chamada UMA vez por carregamento de
// página — não num laço, que é o vício que a §15.1 corrigiu no board.
//
// Só admin. Para o consultor o número seria ruído: a fila não é dele, e ele já
// acompanha as próprias sugestões em /templates.
// ---------------------------------------------------------------------------
export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  // Silêncio, e não 403: quem não é admin simplesmente não tem fila. Um erro
  // aqui faria a tela do consultor logar falha a cada carregamento por uma
  // pergunta que ela nem devia ter feito.
  if (!podeAdmin(sessao)) return Response.json({ n: 0, mais_antiga: null });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ n: 0, mais_antiga: null });
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Uma consulta só: as pendentes são poucas (12 linhas na tabela inteira em
  // 15/09/2026), então trazer os `criado_em` e pegar o menor no JS é mais
  // barato que uma segunda ida ao banco para o `min()`.
  const { data, error } = await db
    .from("template_sugestao")
    .select("criado_em")
    .eq("status", "pendente")
    .order("criado_em", { ascending: true })
    .limit(200);

  // Falha de leitura vira "nenhuma pendente", não erro na tela: este é um
  // aviso, e um aviso que quebra a página que ele decora é pior que o aviso
  // ausente. O número volta sozinho na próxima abertura.
  if (error || !data) return Response.json({ n: 0, mais_antiga: null });

  return Response.json({
    n: data.length,
    mais_antiga: data[0]?.criado_em ?? null,
  });
}
