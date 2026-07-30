import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../../lib/papel";

export const dynamic = "force-dynamic";

// Preview da tela "BATEU A META" de um vendedor nas TVs (botão no CRM). Recebe
// { slug, nome, meta }, monta o payload (foto/elogio/total/posição do ranking ao vivo)
// e grava bi_config.metabatida_comando. Os painéis pegam via ?comando=1 (~6s). Só admin.
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}
const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const slugDe = (nome: any) => (norm(nome).split(" ")[0] || "");
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const slug = slugDe(b?.slug || b?.nome);
  const metaVal = Math.max(0, Math.round(Number(b?.meta) || 0));
  if (!slug) return Response.json({ error: "vendedor inválido" }, { status: 400 });
  if (metaVal <= 0) return Response.json({ error: "Defina uma meta maior que zero para prever." }, { status: 400 });

  // dados do vendedor no ranking ao vivo (foto, elogio, total, posição)
  let entry: any = null;
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/functions/v1/bi-ranking-vendas`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const rk: any[] = Array.isArray(j?.ranking) ? j.ranking : [];
      const idx = rk.findIndex((e) => slugDe(e.nome) === slug);
      if (idx >= 0) entry = { ...rk[idx], posicao: idx + 1 };
    }
  } catch { /* segue com o mínimo */ }

  let nome: string, foto: string | null, elogio: any, total: number, pedidos: number, posicao: number | null;
  if (entry) {
    nome = entry.nome; foto = entry.foto ?? null; elogio = entry.elogio ?? null;
    total = Number(entry.liquido) || 0; pedidos = Number(entry.pedidos) || 0; posicao = entry.posicao ?? null;
  } else {
    const { data: f } = await sb().from("bi_fotos_ranking").select("url").eq("slug", slug).maybeSingle();
    nome = b?.nome ? String(b.nome) : cap(slug); foto = f?.url ?? null; elogio = null; total = 0; pedidos = 0; posicao = null;
  }

  const cmd = { id: String(Date.now()), venda: { nome, foto, elogio, meta: metaVal, total, pedidos, posicao } };
  const { error } = await sb().from("bi_config")
    .upsert({ chave: "metabatida_comando", valor: JSON.stringify(cmd), atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, nome, meta: metaVal });
}
