import { sbAdmin, guardaAdmin, corpo, texto } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

// Gestão de quem entra no sistema (tabela `acesso`). Até aqui isso só existia
// no SQL Editor do Supabase: liberar um vendedor novo dependia de alguém com
// acesso ao banco. É a tela que faltava para a equipe operar sozinha.
//
// DOIS CAMPOS PARECIDOS, COM PAPÉIS DIFERENTES — não fundir:
//   `papel`  = com o que a pessoa ENTRA (vira o cookie no login)
//   `papeis` = o que ela PODE assumir (o /api/trocar-papel valida contra isto)
// Romulo é admin|home|vendedor: entra como admin e troca de chapéu sem relogar.
// Por isso `papel` tem de estar dentro de `papeis`, garantido no servidor.
//
// NÃO HÁ EXCLUSÃO, de propósito: desativar preserva o histórico e é reversível;
// apagar a linha de quem já atendeu não desfaz nada e só perde a trilha.

const PAPEIS = ["admin", "home", "vendedor"] as const;
type Papel = (typeof PAPEIS)[number];
const COLS = "email,papel,papeis,carteira,ativo,criado_em";

const ehPapel = (v: unknown): v is Papel => PAPEIS.includes(v as Papel);
const ehEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Quem, hoje, consegue entrar como admin. Base da trava anti-lockout. */
const admins = (linhas: any[]) =>
  linhas.filter((l) => l.ativo && (l.papel === "admin" || (l.papeis ?? []).includes("admin")));

export async function GET() {
  const g = guardaAdmin("ver os acessos");
  if (g.erro) return g.erro;

  const db = sbAdmin();
  const [{ data: usuarios, error }, { data: carteiras }] = await Promise.all([
    db.from("acesso").select(COLS).order("ativo", { ascending: false }).order("email"),
    db.from("carteira_config").select("slug,ativo").order("slug"),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    usuarios: usuarios ?? [],
    carteiras: (carteiras ?? []).filter((c: any) => c.ativo).map((c: any) => c.slug),
    // o front destaca a própria linha e esconde os botões que se autodestruiriam
    eu: g.email,
  });
}

/**
 * Valida papel + papeis + carteira em conjunto. A regra que mais importa:
 * vendedor SEM carteira gera um cookie de sessão vazio (ver tokenDePapel em
 * lib/papel.ts) — a pessoa loga e não enxerga nada, sem nenhum erro visível.
 */
function validar(papel: Papel, papeis: string[], carteira: string | null): string | null {
  if (!papeis.length) return "escolha ao menos um papel";
  if (papeis.some((p) => !ehPapel(p))) return "papel inválido";
  if (!papeis.includes(papel)) return "o papel de entrada precisa estar entre os papéis disponíveis";
  if (papeis.includes("vendedor") && !carteira) return "vendedor precisa de uma carteira";
  return null;
}

export async function POST(req: Request) {
  const g = guardaAdmin("cadastrar acesso");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  const email = texto(b.email).toLowerCase();
  const papel = texto(b.papel) as Papel;
  const papeis: string[] = Array.isArray(b.papeis) && b.papeis.length ? b.papeis.map(texto) : [papel];
  const carteira = texto(b.carteira) || null;

  if (!ehEmail(email)) return Response.json({ error: "e-mail inválido" }, { status: 400 });
  if (!ehPapel(papel)) return Response.json({ error: "papel inválido" }, { status: 400 });
  const problema = validar(papel, papeis, carteira);
  if (problema) return Response.json({ error: problema }, { status: 400 });

  const db = sbAdmin();
  if (carteira) {
    const { data: existe } = await db.from("carteira_config").select("slug").eq("slug", carteira).maybeSingle();
    if (!existe) return Response.json({ error: `carteira "${carteira}" não existe — cadastre em Vendedores primeiro` }, { status: 400 });
  }
  const { data: jaTem } = await db.from("acesso").select("email").eq("email", email).maybeSingle();
  if (jaTem) return Response.json({ error: "esse e-mail já tem acesso — edite a linha existente" }, { status: 409 });

  const { data, error } = await db
    .from("acesso").insert({ email, papel, papeis, carteira, ativo: true }).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, usuario: data });
}

export async function PATCH(req: Request) {
  const g = guardaAdmin("alterar acesso");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });
  const email = texto(b.email).toLowerCase();
  if (!email) return Response.json({ error: "e-mail ausente" }, { status: 400 });

  const db = sbAdmin();
  const { data: todos, error: erroLista } = await db.from("acesso").select(COLS);
  if (erroLista) return Response.json({ error: erroLista.message }, { status: 500 });
  const atual = (todos ?? []).find((l: any) => l.email === email);
  if (!atual) return Response.json({ error: "acesso não encontrado" }, { status: 404 });

  const papel = b.papel !== undefined ? (texto(b.papel) as Papel) : (atual.papel as Papel);
  const papeis: string[] = Array.isArray(b.papeis) ? b.papeis.map(texto) : (atual.papeis ?? [atual.papel]);
  const carteira = b.carteira !== undefined ? texto(b.carteira) || null : (atual.carteira ?? null);
  const ativo = typeof b.ativo === "boolean" ? b.ativo : atual.ativo;

  if (!ehPapel(papel)) return Response.json({ error: "papel inválido" }, { status: 400 });
  const problema = validar(papel, papeis, carteira);
  if (problema) return Response.json({ error: problema }, { status: 400 });

  if (carteira) {
    const { data: existe } = await db.from("carteira_config").select("slug").eq("slug", carteira).maybeSingle();
    if (!existe) return Response.json({ error: `carteira "${carteira}" não existe` }, { status: 400 });
  }

  // TRAVA ANTI-LOCKOUT: ninguém tira o último admin do ar. Sem isto, um clique
  // distraído em "desativar" na própria linha tranca todo mundo para fora da
  // administração, e a saída seria voltar ao SQL Editor — exatamente o que esta
  // tela existe para evitar.
  const viraAdmin = ativo && (papel === "admin" || papeis.includes("admin"));
  const eraAdmin = admins(todos ?? []).some((l: any) => l.email === email);
  if (eraAdmin && !viraAdmin) {
    const restantes = admins(todos ?? []).filter((l: any) => l.email !== email);
    if (!restantes.length) {
      return Response.json({
        error: "este é o único admin ativo — promova outra pessoa a admin antes de tirar este acesso",
      }, { status: 409 });
    }
    if (g.email && g.email.toLowerCase() === email) {
      return Response.json({
        error: "você não pode remover o próprio acesso de admin — peça a outro admin",
      }, { status: 409 });
    }
  }

  const { data, error } = await db
    .from("acesso").update({ papel, papeis, carteira, ativo }).eq("email", email).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, usuario: data });
}
