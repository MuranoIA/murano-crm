import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { veTudo } from "../../../lib/papel";
import { COOKIE_VER_COMO, verComo } from "../../../lib/verComo";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Define (ou limpa) o "ver como <vendedor>" — o escopo único que admin e home
// usam para enxergar a operação de uma carteira por vez, em TODAS as telas.
//
// Esta é a única rota que escreve o cookie, e é por isso que ele é `httpOnly`:
// aqui se confere que a sessão realmente vê tudo e que o slug existe e está
// ativo em `carteira_config`. Fosse escrito pelo navegador, um slug inventado
// escaparia da lista de carteiras — não daria acesso a mais nada (o cookie só
// estreita, §regras em lib/verComo.ts), mas deixaria a tela vazia sem motivo.
// ---------------------------------------------------------------------------

const sb = () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
};

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const pode = veTudo(sessao);
  if (!pode) return NextResponse.json({ pode: false, carteira: null, vendedores: [] });

  const s = sb();
  if (!s) return NextResponse.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const { data } = await s.from("carteira_config").select("slug,cor").eq("ativo", true).order("slug");
  return NextResponse.json({ pode: true, carteira: verComo(), vendedores: data ?? [] });
}

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  // vendedor não simula ninguém: o escopo dele já é o dele. Recusar aqui é o que
  // impede o cookie de ser um caminho para ver outra carteira.
  if (!veTudo(sessao)) return NextResponse.json({ error: "não autorizado" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const pedida: unknown = (body as any)?.carteira;
  const alvo = typeof pedida === "string" && pedida.trim() ? pedida.trim() : null;

  if (alvo) {
    const s = sb();
    if (!s) return NextResponse.json({ error: "Supabase envs ausentes" }, { status: 500 });
    const { data } = await s.from("carteira_config").select("slug").eq("slug", alvo).eq("ativo", true).maybeSingle();
    if (!data) return NextResponse.json({ error: "carteira desconhecida" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, carteira: alvo });
  // Dentro do hub (§17) o documento de topo é outro site, e cookie `Lax` é
  // descartado como cookie de terceiro — a escolha não colaria justamente onde
  // o time trabalha. Fora de https o par None/Secure é inválido e seria
  // recusado; ali vale `Lax`, que basta porque não há iframe de outro site.
  const https = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
  const opts = {
    httpOnly: true,
    secure: https,
    sameSite: (https ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: alvo ? 60 * 60 * 8 : 0,   // mesma validade da sessão; 0 apaga
  };
  res.cookies.set(COOKIE_VER_COMO, alvo ?? "", opts);
  return res;
}
