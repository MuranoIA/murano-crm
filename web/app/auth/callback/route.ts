import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { tokenDePapel, type Papel } from "../../../lib/papel";

export const dynamic = "force-dynamic";

// Callback do login Google (Supabase Auth). Fluxo:
//  1) troca o `code` por sessão -> pega o e-mail Google verificado;
//  2) busca na tabela `acesso` (service_role) o papel/carteira desse e-mail;
//  3) seta o cookie `crm_sessao` = 'admin' ou o slug da carteira (o resto do app
//     já autoriza por esse cookie). Não persistimos a sessão do Supabase Auth —
//     só usamos o Google pra confirmar a identidade.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/?erro=oauth`);

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supaUrl || !anon) return NextResponse.redirect(`${origin}/?erro=config`);

  const cookieStore = cookies();
  const supabase = createServerClient(supaUrl, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* redirect response */ }
      },
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return NextResponse.redirect(`${origin}/?erro=oauth`);

  // e-mail Google -> papel/carteira (service_role ignora RLS)
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: ac } = await sb.from("acesso").select("papel,papeis,carteira,ativo").eq("email", email).maybeSingle();
  if (!ac || ac.ativo === false) return NextResponse.redirect(`${origin}/?erro=nao_autorizado`);

  // papel PADRÃO ao logar = `papel` (o "mais alto" p/ quem é multi-papel; ex. Romulo/Joas
  // entram como admin e podem trocar depois via seletor). token: admin->"admin",
  // home->"home", vendedor->slug da carteira.
  const papel = (ac.papel ?? "vendedor") as Papel;
  const valor = tokenDePapel(papel, ac.carteira ?? null);
  if (!valor) return NextResponse.redirect(`${origin}/?erro=sem_carteira`);

  const res = NextResponse.redirect(`${origin}/`);
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 8, // 8h
  };
  res.cookies.set("crm_sessao", valor, opts);
  // guarda o e-mail p/ o seletor de papel (quais papéis o usuário pode assumir) e a troca.
  res.cookies.set("crm_email", email, opts);
  return res;
}
