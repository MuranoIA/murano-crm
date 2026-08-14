import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../../lib/papel";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Notas internas da conversa — recado da equipe que o cliente NUNCA vê.
// Ver migration 0080 para o porquê de tabela separada de `mensagens`.
//
// Não há GET aqui: a leitura vem junto da thread (/api/chat/thread), já
// intercalada com as mensagens em ordem cronológica — é assim que ela é útil,
// no ponto da conversa em que foi escrita.
// ---------------------------------------------------------------------------
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

const LIMITE = 2000;

export async function POST(req: Request) {
  const usuario = usuarioDaSessao();
  if (!usuario) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const cliente_id = String(b?.cliente_id ?? "").trim();
  const texto = String(b?.texto ?? "").trim().slice(0, LIMITE);
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  if (!texto) return Response.json({ error: "texto vazio" }, { status: 400 });

  const { data, error } = await sb()
    .from("chat_nota")
    .insert({ cliente_id, autor: usuario, texto })
    .select("id,cliente_id,autor,texto,criada_em").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, nota: data });
}

// Apagar: só quem escreveu, ou o admin. Nota é registro de atendimento —
// um vendedor não apaga a observação do outro.
export async function DELETE(req: Request) {
  const usuario = usuarioDaSessao();
  if (!usuario) return Response.json({ error: "não autenticado" }, { status: 401 });
  const admin = podeAdmin(cookies().get("crm_sessao")?.value);

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const id = Number(b?.id);
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  const db = sb();
  const { data: nota } = await db.from("chat_nota").select("id,autor").eq("id", id).maybeSingle();
  if (!nota) return Response.json({ error: "nota não encontrada" }, { status: 404 });
  if (!admin && nota.autor !== usuario) {
    return Response.json({ error: "só o autor (ou o admin) apaga a nota" }, { status: 403 });
  }

  const { error } = await db.from("chat_nota").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
