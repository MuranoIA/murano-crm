import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Favoritar conversa (0137) — pedido da Anne Karoline em 14/09/2026: marcar uma
// conversa para retomar mais tarde, e ter a lista delas ao lado das outras.
//
//   POST   -> favorita
//   DELETE -> desfavorita
//
// ⚠️ NÃO EXIGE SER DONO DA CONVERSA, e isso é o contrário da marca de leitura
// (`/api/chat/lida`), que só grava para quem atende. Os dois gestos parecem
// irmãos e não são:
//
//   ler     é um FATO SOBRE A CONVERSA — se o admin marcasse ao conferir,
//           apagaria o "esperando resposta" do vendedor sem ninguém ter
//           respondido nada;
//   favoritar é um LEMBRETE DE QUEM MARCOU — não muda nada para os outros, e a
//           supervisora acompanhar um caso que não é dela é justamente o uso.
//
// Por isso a chave é (usuario, cliente_id): duas pessoas favoritam a mesma
// cliente, e uma desmarcando não apaga a marca da outra.
//
// A identidade é `usuarioDaSessao()`, a mesma de `chat_leitura` — e não a
// carteira. Quem atende sem carteira (admin, home, pós-venda) também favorita,
// e uma marca por carteira juntaria as duas pessoas do ISR numa lista só.
// ---------------------------------------------------------------------------

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function clienteDoCorpo(req: Request): Promise<string | null> {
  try {
    const b = await req.json();
    const id = String(b?.cliente_id ?? "").trim();
    return id || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const usuario = usuarioDaSessao();
  if (!usuario) return Response.json({ error: "não autenticado" }, { status: 401 });

  const cliente_id = await clienteDoCorpo(req);
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  // Card sintético do ERP não é conversa: não tem thread para retomar, e um
  // favorito ali viraria uma linha na lista que não abre nada.
  if (cliente_id.startsWith("winthor:") || cliente_id.startsWith("venda:")) {
    return Response.json({ error: "esse card não é uma conversa" }, { status: 422 });
  }

  const c = sb();
  if (!c) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });

  // `upsert` e não `insert`: favoritar duas vezes (dois cliques, duas abas) é
  // o mesmo resultado, e não um erro a explicar na tela.
  const { error } = await c.from("chat_favorito").upsert(
    { usuario, cliente_id },
    { onConflict: "usuario,cliente_id" },
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, favorita: true });
}

export async function DELETE(req: Request) {
  const usuario = usuarioDaSessao();
  if (!usuario) return Response.json({ error: "não autenticado" }, { status: 401 });

  const cliente_id = await clienteDoCorpo(req);
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const c = sb();
  if (!c) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });

  // Apaga SÓ a marca desta pessoa. Sem o `eq("usuario")` uma consultora
  // desfavoritando apagaria o lembrete de todo mundo — que é exatamente o
  // defeito que a chave composta existe para impedir.
  const { error } = await c.from("chat_favorito")
    .delete()
    .eq("usuario", usuario)
    .eq("cliente_id", cliente_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, favorita: false });
}
