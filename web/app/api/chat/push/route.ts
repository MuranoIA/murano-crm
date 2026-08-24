import { createClient } from "@supabase/supabase-js";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";
import { chavePublica, configurar } from "../../../../lib/chatPush";

export const dynamic = "force-dynamic";

// Inscrição de Web Push do chat (migration 0096).
//
//   GET    → a chave pública VAPID, que o navegador precisa para se inscrever
//   POST   → grava (ou atualiza) a inscrição deste aparelho
//   DELETE → remove a inscrição deste aparelho
//
// A inscrição é por APARELHO, não por pessoa: alguém que atende no PC e no
// celular quer o aviso nos dois. `endpoint` é a identidade do aparelho e é
// único na tabela, então re-inscrever atualiza em vez de duplicar.

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const usuario = usuarioDaSessao();
  if (!usuario) return Response.json({ error: "não autenticado" }, { status: 401 });

  // `disponivel: false` não é erro: sem as chaves no ambiente o recurso não
  // existe, e a tela some com o botão em vez de oferecer algo que vai falhar.
  if (!configurar()) return Response.json({ disponivel: false });

  const c = sb();
  const { count } = c
    ? await c.from("chat_push_inscricao").select("id", { count: "exact", head: true }).eq("usuario", usuario)
    : { count: 0 };

  return Response.json({ disponivel: true, chave: chavePublica(), aparelhos: count ?? 0 });
}

export async function POST(req: Request) {
  const usuario = usuarioDaSessao();
  if (!usuario) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!configurar()) return Response.json({ error: "push não configurado no servidor" }, { status: 503 });

  const b = await req.json().catch(() => null);
  const endpoint = String(b?.endpoint ?? "").trim();
  const p256dh = String(b?.keys?.p256dh ?? "").trim();
  const auth = String(b?.keys?.auth ?? "").trim();
  // As três juntas ou nenhuma: sem p256dh/auth a carga não pode ser cifrada, e
  // a inscrição gravada seria lixo que só falha na hora de entregar.
  if (!endpoint || !p256dh || !auth) {
    return Response.json({ error: "inscrição incompleta" }, { status: 400 });
  }

  const c = sb();
  if (!c) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });

  const { error } = await c.from("chat_push_inscricao").upsert({
    usuario,
    endpoint,
    p256dh,
    auth,
    aparelho: String(b?.aparelho ?? "").slice(0, 120) || null,
  }, { onConflict: "endpoint" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const usuario = usuarioDaSessao();
  if (!usuario) return Response.json({ error: "não autenticado" }, { status: 401 });

  const b = await req.json().catch(() => null);
  const endpoint = String(b?.endpoint ?? "").trim();
  if (!endpoint) return Response.json({ error: "informe o endpoint" }, { status: 400 });

  const c = sb();
  if (!c) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });

  // Filtra por usuário TAMBÉM, não só pelo endpoint: o endpoint chega do
  // navegador e não é segredo — sem esta linha, um endpoint conhecido
  // desinscreveria o aparelho de outra pessoa.
  const { error } = await c.from("chat_push_inscricao").delete()
    .eq("endpoint", endpoint).eq("usuario", usuario);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
