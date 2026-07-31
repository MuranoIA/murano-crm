import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { nomeDeEmailCarteira, nomeDoUsuario } from "../../../lib/tickets";

export const dynamic = "force-dynamic";

// Tickets = "cards" estilo e-mail, iguais para todos (vendedor/home/admin). Cada card tem
// autor (remetente) e destinatário (por e-mail). GET devolve os cards em que sou remetente
// OU destinatário. POST cria um card endereçado. Escrita SÓ no murano-conversas.
function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}
export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  const email = cookies().get("crm_email")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!email) return Response.json({ tickets: [], meEmail: null });

  const { data, error } = await sb().from("tickets")
    .select("*")
    .or(`autor_email.eq.${email},destinatario_email.eq.${email}`)
    .order("criado_em", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ tickets: data ?? [], meEmail: email });
}

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  const email = cookies().get("crm_email")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!email) return Response.json({ error: "sessão sem e-mail" }, { status: 400 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const destinatario = String(b?.destinatario_email ?? "").trim().toLowerCase();
  const titulo = String(b?.titulo ?? "").trim();
  const texto = String(b?.texto ?? "").trim();
  if (!destinatario) return Response.json({ error: "Escolha o destinatário." }, { status: 400 });
  if (titulo.length < 3) return Response.json({ error: "Dê um título ao card (mín. 3 letras)." }, { status: 400 });

  const c = sb();
  // valida destinatário (usuário ativo) e pega o nome
  const { data: dest } = await c.from("acesso").select("email,carteira,ativo").eq("email", destinatario).maybeSingle();
  if (!dest || dest.ativo === false) return Response.json({ error: "Destinatário inválido." }, { status: 400 });
  const destNome = nomeDeEmailCarteira(destinatario, dest.carteira);
  const autorNome = await nomeDoUsuario(email, sessao, c);

  const { data, error } = await c.from("tickets").insert({
    titulo: titulo.slice(0, 160), texto: texto.slice(0, 5000),
    autor_email: email, autor_nome: autorNome,
    destinatario_email: destinatario, destinatario_nome: destNome,
    status: "aberto",
  }).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, ticket: data });
}
