import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin } from "../../../../lib/papel";

export const dynamic = "force-dynamic";

// Parabéns por cliente: recebe { nome }, procura uma venda de HOJE cujo cliente bata com o
// nome (via edge fn ?vendas=1) e grava bi_config.parabens_comando com a venda + id único.
// Os painéis conferem via ?comando=1 (~6s) e mostram a tela de parabéns dessa venda.
// Só admin. Escrita SÓ no murano-conversas (bi_config).
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}
const norm = (s: any) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) return Response.json({ error: "apenas admin pode disparar os parabéns" }, { status: 403 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const q = norm(b?.nome);
  if (q.length < 2) return Response.json({ error: "Digite ao menos 2 letras do nome da cliente." }, { status: 400 });

  const base = process.env.SUPABASE_URL;
  let vendas: any[] = [];
  try {
    const r = await fetch(`${base}/functions/v1/bi-ranking-vendas?vendas=1`, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    vendas = Array.isArray(j?.vendas) ? j.vendas : [];
  } catch (e: any) {
    return Response.json({ error: "Não foi possível ler as vendas de hoje: " + (e?.message ?? e) }, { status: 502 });
  }

  const contem = vendas.filter((v) => norm(v.cliente).includes(q));
  if (!contem.length) return Response.json({ error: "Nenhuma venda de hoje para esse cliente." }, { status: 404 });

  // prefere quem bate exatamente; senão usa os que contêm o texto
  const exatos = contem.filter((v) => norm(v.cliente) === q);
  const cand = exatos.length ? exatos : contem;
  const distintos = [...new Set(cand.map((v) => v.cliente))];
  if (distintos.length > 1) {
    return Response.json({ error: "Vários clientes correspondem: " + distintos.slice(0, 6).join(" · ") + ". Seja mais específico." }, { status: 409 });
  }
  // venda mais recente do cliente (maior nº de pedido)
  const venda = cand.reduce((a, v) => (v.pedido > a.pedido ? v : a));

  const cmd = { id: String(Date.now()), venda };
  const { error } = await sb().from("bi_config")
    .upsert({ chave: "parabens_comando", valor: JSON.stringify(cmd), atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, cliente: venda.cliente, vendedor: venda.vendedor, valor: venda.valor });
}
