import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { tokenDePapel, type Papel } from "../../../lib/papel";

export const dynamic = "force-dynamic";

// Ponte de SSO com o hub interno (murano-app, crm.muranoprofessional.com.br
// embutido em <iframe> em /crm-externo). O hub gera um token curto assinado
// (HMAC-SHA256, segredo CRM_HUB_SSO_SECRET compartilhado pelas duas Vercel)
// pra um usuario ja logado la; esta rota verifica a assinatura e faz
// exatamente o que /auth/callback faz depois do OAuth do Google — busca
// papel/carteira em `acesso` e seta `crm_sessao`. O login Google continua
// existindo do jeito que esta hoje (acesso direto ao dominio); esta rota e
// so um caminho a mais de entrar, nao substitui nem altera o fluxo atual.
//
// Cookie com SameSite=None (nao Lax como o /auth/callback): o /auth/callback
// so precisa do cookie em navegacao normal do proprio dominio; esta rota
// carrega dentro de um iframe cujo documento de topo e outro site
// (app.muranoprofessional.com.br) — sem None;Secure o navegador descarta o
// Set-Cookie por ser contexto de terceiro. Depende do navegador permitir
// cookie de terceiro pro dominio; se o time usar um navegador que bloqueia
// (Safari com "Impedir rastreamento entre sites", Chrome com bloqueio total
// de cookies de terceiro ligado), a sessao nao pega e o iframe cai na tela
// de login normal do CRM — nunca quebra, so deixa de logar sozinho.
function verificarToken(token: string, segredo: string): string | null {
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  const esperado = createHmac("sha256", segredo).update(payloadB64).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (typeof payload.email !== "string" || typeof payload.exp !== "number") return null;
    if (Date.now() / 1000 > payload.exp) return null;
    return payload.email.toLowerCase();
  } catch {
    return null;
  }
}

// Destino do redirect depois do SSO. Sem isto a rota mandava SEMPRE para `/`:
// dentro do hub o CRM e um <iframe> cujo `src` e esta rota, entao recarregar a
// pagina do hub joga quem estava atendendo no /chat de volta no board, que
// refaz a consulta de milhares de cards. O `?destino=` deixa o hub apontar
// direto para uma tela; sem ele vale o cookie `crm_tela`, escrito pelo proprio
// CRM a cada navegacao (app/lembrarTela.tsx).
//
// A validacao e o ponto sensivel: isto e um redirect controlado por dado que
// vem de fora, ou seja, um open redirect se aceitar qualquer coisa. So passa
// caminho relativo da propria origem — `//host` e `/\host` sao absolutos
// disfarcados e o navegador os trata como outro site.
function telaSegura(valor: string | null | undefined): string | null {
  if (!valor) return null;
  let d = valor.trim();
  try { d = decodeURIComponent(d); } catch { return null; }
  if (d.length > 300) return null;
  if (!d.startsWith("/")) return null;
  if (d.startsWith("//") || d.includes("\\")) return null;
  if (/[\r\n\t]/.test(d)) return null;
  // rotas que nao sao tela de trabalho (a de SSO, entao, seria um laco)
  if (/^\/(auth|api|privacidade|termos)(\/|$|\?)/.test(d)) return null;
  return d;
}

function cookieDaRequisicao(req: Request, nome: string): string | null {
  const bruto = req.headers.get("cookie");
  if (!bruto) return null;
  for (const parte of bruto.split(";")) {
    const i = parte.indexOf("=");
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const token = url.searchParams.get("token");
  const segredo = process.env.CRM_HUB_SSO_SECRET;

  if (!token || !segredo) return NextResponse.redirect(`${origin}/?erro=oauth`);

  const email = verificarToken(token, segredo);
  if (!email) return NextResponse.redirect(`${origin}/?erro=oauth`);

  // e-mail confirmado pelo hub -> papel/carteira (service_role ignora RLS, mesma
  // consulta que /auth/callback ja faz apos o OAuth do Google).
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: ac } = await sb
    .from("acesso")
    .select("papel,papeis,carteira,ativo")
    .eq("email", email)
    .maybeSingle();
  if (!ac || ac.ativo === false) return NextResponse.redirect(`${origin}/?erro=nao_autorizado`);

  const papel = (ac.papel ?? "vendedor") as Papel;
  const valor = tokenDePapel(papel, ac.carteira ?? null);
  if (!valor) return NextResponse.redirect(`${origin}/?erro=sem_carteira`);

  // volta para onde a pessoa estava: destino explicito > ultima tela > board
  const destino =
    telaSegura(url.searchParams.get("destino")) ??
    telaSegura(cookieDaRequisicao(req, "crm_tela")) ??
    "/";

  const res = NextResponse.redirect(`${origin}${destino}`);
  const opts = {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    path: "/",
    maxAge: 60 * 60 * 8, // 8h, igual ao /auth/callback
  };
  res.cookies.set("crm_sessao", valor, opts);
  res.cookies.set("crm_email", email, opts);
  return res;
}
