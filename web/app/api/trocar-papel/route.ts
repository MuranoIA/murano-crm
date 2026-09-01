import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { tokenDePapel, type Papel } from "../../../lib/papel";

export const dynamic = "force-dynamic";

// Troca o papel ATIVO de quem tem mais de um (Romulo: admin|vendedor; Joas: admin|home).
// Valida o papel pedido contra os `papeis` do e-mail logado (cookie crm_email, setado no
// login Google) — impede assumir um papel que o usuário não tem. Reescreve crm_sessao.
export async function POST(req: Request) {
  const email = cookies().get("crm_email")?.value;
  if (!email) return NextResponse.json({ error: "sem e-mail de sessão (entre novamente com Google)" }, { status: 401 });

  const papel = (await req.json().then((b: any) => b?.papel).catch(() => undefined)) as Papel | undefined;
  if (!papel || !["admin", "home", "vendedor"].includes(papel)) {
    return NextResponse.json({ error: "papel inválido" }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: ac } = await sb.from("acesso").select("papel,papeis,carteira,ativo").eq("email", email).maybeSingle();
  if (!ac || ac.ativo === false) return NextResponse.json({ error: "não autorizado" }, { status: 403 });
  const papeis: string[] = (ac.papeis && ac.papeis.length ? ac.papeis : [ac.papel]).filter(Boolean);
  if (!papeis.includes(papel)) return NextResponse.json({ error: "você não tem esse papel" }, { status: 403 });

  const token = tokenDePapel(papel, ac.carteira ?? null);
  if (!token) return NextResponse.json({ error: "papel de vendedor sem carteira definida" }, { status: 400 });

  const res = NextResponse.json({ ok: true, role: papel });
  // Trocar de papel zera a simulacao: assumir "vendedor" enquanto se ve como
  // outra carteira seriam dois escopos disputando a mesma tela.
  res.cookies.set("crm_ver_como", "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set("crm_sessao", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}
