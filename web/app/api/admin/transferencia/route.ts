import { createClient } from "@supabase/supabase-js";
import { guardaAdmin } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// QUEM APARECE NA LISTA DE TRANSFERÊNCIA (demanda #51, 29/09/2026)
//
// Pedido do dono: um lugar onde o admin escolha quem entra no seletor "Para
// quem" da transferência de conversa.
//
// ⚠️ ESCONDER AQUI NÃO TIRA NINGUÉM DO ATENDIMENTO. É a distinção que a 0146
// registra e que esta rota preserva:
//
//     atende_chat            = tem caixa de entrada própria; recebe conversas
//     transferencia_visivel  = pode ser ESCOLHIDO como destino
//
// Por isso a rota mexe SÓ na segunda. Tirar alguém do atendimento continua
// sendo o interruptor da tela antiga, que confirma com o número de conversas
// que voltariam para a fila — um estrago que este botão não pode causar por
// engano.
//
// ⚠️ E a rota de transferir NÃO passou a recusar quem está escondido. A
// configuração encurta a LISTA, não é permissão: uma aba aberta há uma hora
// ainda mostra o nome antigo, e recusar ali seria o anti-padrão da §56 — a tela
// oferece, a pessoa clica, o servidor diz não.
// ---------------------------------------------------------------------------
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

const COLS = "email,nome,papel,carteira,ativo,atende_chat,transferencia_visivel";

export async function GET() {
  const g = guardaAdmin("ler a lista de transferência");
  if (g.erro) return g.erro;
  const { data, error } = await sb().from("acesso").select(COLS)
    .eq("ativo", true).order("carteira", { nullsFirst: false }).order("email");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // quem tem carteira aparece pelo SLUG; quem não tem, por `u:<email>` — e só
  // entra na lista se atender pelo chat. A tela precisa saber disso para
  // explicar por que alguém não aparece mesmo estando marcado.
  const pessoas = (data ?? []).map((p: any) => ({
    email: p.email,
    nome: (p.nome && String(p.nome).trim()) || String(p.email).split("@")[0],
    papel: p.papel ?? null,
    carteira: p.carteira ?? null,
    atende_chat: p.atende_chat === true,
    visivel: p.transferencia_visivel !== false,
    // o que impede de aparecer, mesmo marcado
    impedimento: !p.carteira && p.atende_chat !== true
      ? "não atende no chat — ligue em Administração › Usuários"
      : null,
  }));
  return Response.json({ pessoas });
}

export async function PATCH(req: Request) {
  const g = guardaAdmin("mudar a lista de transferência");
  if (g.erro) return g.erro;

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const email = String(b?.email ?? "").trim().toLowerCase();
  if (!email) return Response.json({ error: "email ausente" }, { status: 400 });
  // `=== true` e não a veracidade solta: um `visivel` ausente viraria "esconder"
  // por omissão, e esta rota não deve decidir nada por omissão.
  const visivel = b?.visivel === true;

  const { error } = await sb().from("acesso")
    .update({ transferencia_visivel: visivel }).eq("email", email);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, email, visivel });
}
