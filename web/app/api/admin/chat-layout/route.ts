import { sbAdmin, guardaAdmin, corpo, texto } from "../../../../lib/adminApi";
import { LAYOUTS, LAYOUT_PADRAO, acharLayout, podeAtivar, layoutEfetivo } from "../../../../lib/chatLayout";

export const dynamic = "force-dynamic";

// Qual desenho do /chat está em vigor (`chat_layout`, linha única id=1,
// migration 0095) e quem está em piloto (`acesso.chat_layout`).
//
// A tela que consome isto mostra as quatro opções com a tese e o sacrifício de
// cada uma, para o admin decidir com o laudo à mão em vez de por preferência
// visual. O texto vem do catálogo em `lib/chatLayout.ts` — não é duplicado aqui.
//
// Três escritas, deliberadamente separadas:
//   PUT   → estabelece o desenho para TODOS
//   PATCH → liga/desliga o piloto de um e-mail (testar antes de impor)
// A separação existe porque a primeira afeta sete pessoas e a segunda, uma. Um
// endpoint só, decidindo pelo formato do corpo, tornaria fácil escrever global
// achando que escrevia piloto.

const PADRAO_GLOBAL = { layout: LAYOUT_PADRAO, atualizado_por: null, atualizado_em: null };

/** Recusa comum às duas escritas, com o motivo que o admin precisa ler. */
function recusa(valor: unknown): Response | null {
  const l = acharLayout(valor);
  if (!l) return Response.json({ error: "desenho desconhecido" }, { status: 400 });
  if (!l.implementado) {
    return Response.json({
      error:
        `"${l.rotulo}" existe como protótipo, mas a tela ainda não foi construída — ` +
        `por isso não pode ser ativada. Enquanto isso, avalie pelo arquivo ${l.prototipo}.`,
    }, { status: 409 });
  }
  return null;
}

export async function GET() {
  const g = guardaAdmin("ver o desenho do chat");
  if (g.erro) return g.erro;
  const sb = sbAdmin();

  const [cfg, pessoas, hist] = await Promise.all([
    sb.from("chat_layout").select("layout,atualizado_por,atualizado_em").eq("id", 1).maybeSingle(),
    // todos os que entram no sistema: a tela precisa da lista para oferecer o
    // piloto, e do valor atual de cada um para mostrar quem já está nele
    sb.from("acesso").select("email,papel,carteira,ativo,chat_layout").order("email"),
    sb.from("chat_layout_historico").select("escopo,alvo,de,para,por,criada_em")
      .order("criada_em", { ascending: false }).limit(25),
  ]);

  if (cfg.error) return Response.json({ error: cfg.error.message }, { status: 500 });
  if (pessoas.error) return Response.json({ error: pessoas.error.message }, { status: 500 });

  const global = cfg.data ?? PADRAO_GLOBAL;

  return Response.json({
    "chat-layout": {
      // o catálogo inteiro, para a tela não repetir texto de produto
      opcoes: LAYOUTS,
      global,
      // `efetivo` já resolvido pela MESMA função que o /chat usa: se a tela do
      // admin calculasse por conta própria, poderia anunciar um desenho
      // diferente do que a equipe está vendo
      efetivo: layoutEfetivo(global.layout, null),
      pessoas: pessoas.data ?? [],
      pilotos: (pessoas.data ?? []).filter((p: any) => p.chat_layout),
      // se a tabela de histórico falhar, a decisão vigente ainda deve aparecer
      historico: hist.error ? [] : hist.data ?? [],
      historico_erro: hist.error?.message ?? null,
    },
  });
}

/** Estabelece o desenho para TODOS os usuários. */
export async function PUT(req: Request) {
  const g = guardaAdmin("estabelecer o desenho do chat para todos");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  const alvo = texto(b.layout);
  const nao = recusa(alvo);
  if (nao) return nao;

  const sb = sbAdmin();
  const atual = await sb.from("chat_layout").select("layout").eq("id", 1).maybeSingle();
  const de = atual.data?.layout ?? LAYOUT_PADRAO;

  if (de === alvo) {
    return Response.json({ ok: true, aviso: "já era o desenho em vigor — nada mudou.", global: atual.data });
  }

  const { data, error } = await sb.from("chat_layout").upsert({
    id: 1,
    layout: alvo,
    atualizado_por: g.email,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "id" }).select("layout,atualizado_por,atualizado_em").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // histórico é append-only e NÃO derruba a troca se falhar: a decisão já está
  // valendo neste ponto, e devolver erro faria o admin repetir uma ação que já
  // aconteceu (§0095)
  const h = await sb.from("chat_layout_historico")
    .insert({ escopo: "global", alvo: null, de, para: alvo, por: g.email });

  const qtdPiloto = (await sb.from("acesso").select("email", { count: "exact", head: true })
    .not("chat_layout", "is", null)).count ?? 0;

  return Response.json({
    ok: true,
    global: data,
    aviso: [
      h.error ? "(o histórico não foi gravado)" : "",
      qtdPiloto > 0
        ? `${qtdPiloto} ${qtdPiloto === 1 ? "pessoa está" : "pessoas estão"} em piloto e continua${qtdPiloto === 1 ? "" : "m"} vendo o desenho do piloto.`
        : "",
    ].filter(Boolean).join(" ") || undefined,
  });
}

/** Liga ou desliga o piloto de UM e-mail. `layout: null` volta a seguir o global. */
export async function PATCH(req: Request) {
  const g = guardaAdmin("definir o piloto do desenho do chat");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  const email = texto(b.email).toLowerCase();
  if (!email) return Response.json({ error: "informe o e-mail" }, { status: 400 });

  // string vazia e null significam a mesma coisa aqui — "volte a seguir o
  // global" — porque um <select> vazio manda "" e não null
  const bruto = b.layout === null || texto(b.layout) === "" ? null : texto(b.layout);
  if (bruto !== null) {
    const nao = recusa(bruto);
    if (nao) return nao;
  }

  const sb = sbAdmin();
  const atual = await sb.from("acesso").select("email,chat_layout").eq("email", email).maybeSingle();
  if (atual.error) return Response.json({ error: atual.error.message }, { status: 500 });
  if (!atual.data) {
    return Response.json({ error: "este e-mail não está na lista de acesso" }, { status: 404 });
  }

  const { error } = await sb.from("acesso").update({ chat_layout: bruto }).eq("email", email);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await sb.from("chat_layout_historico").insert({
    escopo: "piloto",
    alvo: email,
    de: atual.data.chat_layout ?? null,
    // 'para' é NOT NULL: sair do piloto é registrado como voltar ao global,
    // que é o que de fato passa a valer para essa pessoa
    para: bruto ?? "original",
    por: g.email,
  });

  return Response.json({
    ok: true,
    aviso: bruto
      ? `${email} passa a ver "${acharLayout(bruto)!.rotulo}". Os demais seguem no desenho em vigor.`
      : `${email} volta a seguir o desenho em vigor.`,
  });
}
