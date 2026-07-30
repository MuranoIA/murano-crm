import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../../lib/papel";

export const dynamic = "force-dynamic";

// Metas individuais do dia por vendedor (bi_meta_vendedor, slug=1º nome). Só admin.
// GET: roster (vendedores de hoje + com foto + com meta) e a meta atual de cada.
// POST { metas:[{slug,nome,meta}] }: grava. Escrita SÓ no murano-conversas.
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}
const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const slugDe = (nome: any) => (norm(nome).split(" ")[0] || "");
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const primeiroNome = (nome: any) => cap((String(nome ?? "").trim().split(/\s+/)[0] || "").toLowerCase());

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin" }, { status: 403 });

  const c = sb();
  const [{ data: metas }, { data: fotos }, { data: peds }] = await Promise.all([
    c.from("bi_meta_vendedor").select("slug,nome,meta"),
    c.from("bi_fotos_ranking").select("slug"),
    c.from("bi_pedidos_dia").select("vendedor"),
  ]);

  const roster = new Map<string, { slug: string; nome: string; meta: number }>();
  for (const p of (peds ?? [])) { const s = slugDe(p.vendedor); if (s && !roster.has(s)) roster.set(s, { slug: s, nome: primeiroNome(p.vendedor), meta: 0 }); }
  for (const f of (fotos ?? [])) { const s = f.slug; if (s && !roster.has(s)) roster.set(s, { slug: s, nome: cap(s), meta: 0 }); }
  for (const m of (metas ?? [])) { const cur = roster.get(m.slug) ?? { slug: m.slug, nome: m.nome || cap(m.slug), meta: 0 }; cur.meta = Number(m.meta) || 0; if (m.nome) cur.nome = m.nome; roster.set(m.slug, cur); }

  const lista = [...roster.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return Response.json({ metas: lista });
}

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const metas = Array.isArray(b?.metas) ? b.metas : null;
  if (!metas) return Response.json({ error: "metas inválidas" }, { status: 400 });

  const rows = metas
    .map((m: any) => ({ slug: slugDe(m.slug || m.nome), nome: m.nome ? String(m.nome) : null, meta: Math.max(0, Math.round(Number(m.meta) || 0)), atualizado_em: new Date().toISOString() }))
    .filter((r: any) => r.slug);
  if (rows.length) {
    const { error } = await sb().from("bi_meta_vendedor").upsert(rows, { onConflict: "slug" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true, count: rows.length });
}
