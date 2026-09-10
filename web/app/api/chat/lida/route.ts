import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";
import { souDonoDaConversa } from "../../../../lib/chatEscopo";

export const dynamic = "force-dynamic";

// Marca a conversa como lida ATÉ agora, para o usuário logado. Chamada quando ele
// abre a thread. A marca é por usuário (não global): dois vendedores — ou o admin
// e o dono da carteira — têm filas independentes, como no RD.
//
// SÓ QUEM ATENDE MARCA. Quem abre a conversa de outra pessoa está conferindo, e
// conferir não é atender: marcar ali apagaria o próprio número de "esperando
// resposta" no gesto de olhar — o supervisor abriria as duas que estão na fila
// e passaria a ver zero, sem ninguém ter respondido nada.
//
// Para quem observa, "não lida" passa a significar *o cliente falou e ninguém
// respondeu*, e sai da fila quando ALGUÉM responde. Isso não precisou de código
// novo em /api/chat: sem marca de leitura, o cálculo de lá já é exatamente esse
// (`ultima_enviada_por === "customer"`), e a primeira resposta o desliga sozinho.
//
// A trava mora no SERVIDOR, não só na tela. A aba pode estar aberta desde antes
// de uma troca de papel (/api/trocar-papel reescreve o cookie sem recarregar a
// página), e a marca é gravada por e-mail — o mesmo e-mail nos dois papéis, de
// modo que a tela sozinha não separaria o Romulo-admin do Romulo-vendedor.
export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value ?? null;
  const usuario = usuarioDaSessao();
  if (!usuario) return Response.json({ error: "não autenticado" }, { status: 401 });

  let cliente_id: string;
  try {
    ({ cliente_id } = await req.json());
  } catch {
    return Response.json({ error: "body inválido" }, { status: 400 });
  }
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 200 e não 403: observar a conversa de outro é uso legítimo e corriqueiro, não
  // tentativa de fazer algo proibido. A tela precisa saber que não marcou (para
  // não tirar o negrito por conta própria), não precisa de um erro.
  if (!(await souDonoDaConversa(sb, cliente_id, sessao, usuario))) {
    return Response.json({ ok: true, marcou: false, motivo: "só quem atende a conversa marca leitura" });
  }

  const { error } = await sb.from("chat_leitura").upsert(
    { usuario, cliente_id, lida_ate: new Date().toISOString() },
    { onConflict: "usuario,cliente_id" },
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, marcou: true });
}
