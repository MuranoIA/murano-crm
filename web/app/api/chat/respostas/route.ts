import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe, veTudo } from "../../../../lib/papel";
import { usuarioDaSessao } from "../../../../lib/chatUsuario";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Respostas rápidas do chat — os textos que o vendedor repete o dia inteiro,
// colados na caixa de envio pelo atalho `/`. Ver migration 0080.
//
// NÃO é o mesmo que /api/templates (crm_templates): aquilo é template aprovado
// da Meta/RD, que reabre a janela de 24h. Isto é texto nosso, editável antes de
// enviar, sem aprovação de ninguém.
//
// Alcance:
//   carteira = null  -> resposta DA CASA (todo mundo vê; só admin/home cria)
//   carteira = slug  -> resposta PESSOAL do vendedor (só ele vê e edita)
// Admin e home enxergam e editam tudo.
// ---------------------------------------------------------------------------
const COLS = "id,atalho,titulo,corpo,carteira,ativo,criado_por,criado_em";

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

function sessaoAtual() {
  const sessao = cookies().get("crm_sessao")?.value ?? null;
  return { sessao, carteira: carteiraDe(sessao), tudo: veTudo(sessao), usuario: usuarioDaSessao() };
}

// atalho normalizado: sem a barra, minúsculo, só letra/número (o `/` do editor já
// serve de prefixo). Evita atalho com espaço, que não casaria com o que é digitado.
const normalizaAtalho = (s: string) =>
  String(s ?? "").trim().replace(/^\/+/, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);

export async function GET() {
  const { sessao, carteira, tudo } = sessaoAtual();
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let q = sb().from("chat_resposta_rapida").select(COLS).eq("ativo", true);
  // vendedor: só as da casa + as dele. admin/home: todas.
  if (!tudo && carteira) q = q.or(`carteira.is.null,carteira.eq.${carteira}`);

  const { data, error } = await q.order("atalho");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ respostas: data ?? [] });
}

export async function POST(req: Request) {
  const { sessao, carteira, tudo, usuario } = sessaoAtual();
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }

  const atalho = normalizaAtalho(b?.atalho);
  const corpo = String(b?.corpo ?? "").trim();
  const titulo = String(b?.titulo ?? "").trim() || corpo.slice(0, 40);
  if (!atalho) return Response.json({ error: "atalho obrigatório (letras e números)" }, { status: 400 });
  if (!corpo) return Response.json({ error: "corpo obrigatório" }, { status: 400 });

  // vendedor só cria resposta pessoal; admin/home criam da casa (ou de uma carteira).
  const alcance = tudo ? (b?.carteira ? String(b.carteira) : null) : carteira;

  const { data, error } = await sb()
    .from("chat_resposta_rapida")
    .insert({ atalho, titulo, corpo, carteira: alcance, criado_por: usuario })
    .select(COLS).single();

  // 23505 = já existe esse atalho nesse alcance. Mensagem em vez de erro cru.
  if (error) {
    const dup = (error as any)?.code === "23505";
    return Response.json(
      { error: dup ? `já existe uma resposta com o atalho /${atalho}` : error.message },
      { status: dup ? 409 : 500 },
    );
  }
  return Response.json({ ok: true, resposta: data });
}

// PATCH e DELETE compartilham a mesma regra de alcance: vendedor só mexe no que é
// dele (carteira = slug); admin/home mexem em tudo, inclusive nas da casa.
async function alvoPermitido(id: number, tudo: boolean, carteira: string | null) {
  const { data } = await sb().from("chat_resposta_rapida").select("id,carteira").eq("id", id).maybeSingle();
  if (!data) return { ok: false, status: 404, error: "resposta não encontrada" };
  if (!tudo && data.carteira !== carteira) {
    return { ok: false, status: 403, error: "só o admin edita respostas da casa ou de outra carteira" };
  }
  return { ok: true as const };
}

export async function PATCH(req: Request) {
  const { sessao, carteira, tudo } = sessaoAtual();
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const id = Number(b?.id);
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  const permissao = await alvoPermitido(id, tudo, carteira);
  if (!permissao.ok) return Response.json({ error: permissao.error }, { status: permissao.status });

  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (typeof b.atalho === "string") {
    const a = normalizaAtalho(b.atalho);
    if (!a) return Response.json({ error: "atalho inválido" }, { status: 400 });
    patch.atalho = a;
  }
  if (typeof b.titulo === "string" && b.titulo.trim()) patch.titulo = b.titulo.trim();
  if (typeof b.corpo === "string" && b.corpo.trim()) patch.corpo = b.corpo.trim();
  if (typeof b.ativo === "boolean") patch.ativo = b.ativo;

  const { data, error } = await sb()
    .from("chat_resposta_rapida").update(patch).eq("id", id).select(COLS).single();
  if (error) {
    const dup = (error as any)?.code === "23505";
    return Response.json(
      { error: dup ? "já existe uma resposta com esse atalho" : error.message },
      { status: dup ? 409 : 500 },
    );
  }
  return Response.json({ ok: true, resposta: data });
}

export async function DELETE(req: Request) {
  const { sessao, carteira, tudo } = sessaoAtual();
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const id = Number(b?.id);
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  const permissao = await alvoPermitido(id, tudo, carteira);
  if (!permissao.ok) return Response.json({ error: permissao.error }, { status: permissao.status });

  const { error } = await sb().from("chat_resposta_rapida").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
