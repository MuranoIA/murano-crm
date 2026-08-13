import { createClient } from "@supabase/supabase-js";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";

export const dynamic = "force-dynamic";

// Marca a conversa como lida ATÉ agora, para o usuário logado. Chamada quando ele
// abre a thread. A marca é por usuário (não global): dois vendedores — ou o admin
// e o dono da carteira — têm filas independentes, como no RD.
export async function POST(req: Request) {
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

  const { error } = await sb.from("chat_leitura").upsert(
    { usuario, cliente_id, lida_ate: new Date().toISOString() },
    { onConflict: "usuario,cliente_id" },
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
