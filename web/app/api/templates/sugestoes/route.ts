import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { podeAdmin, carteiraDe } from "../../../../lib/papel";
import { variaveisDe } from "../../../../lib/templateVars";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Templates SUGERIDOS pelo consultor (0110).
//
// A experiência de escrever é a mesma de criar um template de verdade; o que
// muda é o destino da análise: em vez da Meta, o administrador. Por isso esta
// rota NÃO fala com a Graph API em nenhum caminho — aprovar aqui é o veredito
// de que o texto presta, e publicar continua sendo um gesto do admin na tela
// de Templates, com o formulário preenchido.
//
// GET    -> o consultor vê as próprias; admin/home veem todas
// POST   -> consultor cria uma sugestão
// PATCH  -> admin aprova ou recusa (recusar exige motivo)
// DELETE -> o autor apaga a própria, enquanto ainda está pendente
// ---------------------------------------------------------------------------

const LIM = { nome: 60, corpo: 1024, cabecalho: 60, rodape: 60, justificativa: 500 };

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

const COLS =
  "id,carteira,autor_email,nome,corpo,cabecalho_tipo,cabecalho_texto,rodape," +
  "justificativa,status,motivo,avaliado_por,avaliado_em,publicado_id,criado_em";

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const db = sb();
  const minha = carteiraDe(sessao);

  let q = db.from("template_sugestao").select(COLS).order("criado_em", { ascending: false }).limit(200);
  // Vendedor vê só as próprias. Não é sigilo — é que a lista dele existe para
  // acompanhar o que ELE mandou; encher com as dos colegas transformaria uma
  // tela de acompanhamento numa de fofoca.
  if (minha) q = q.eq("carteira", minha);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // ---- OS CINCO ESTADOS, derivados AQUI e em lugar nenhum mais ------------
  // "Aprovada" NAO quer dizer "posso usar": sao dois vereditos em sequencia --
  // o admin diz que o texto presta, e so DEPOIS a Meta analisa o template. Um
  // selo "Aprovada" logo apos o admin faz a consultora procurar o template no
  // chat e nao achar, porque /api/templates so entrega o que a Meta marcou
  // APPROVED. Os dois estados do meio saem de `publicado_id` + o status da
  // Meta, entao precisam deste join -- e precisam ser calculados no SERVIDOR,
  // senao a tela do consultor e a do admin nomeariam o mesmo caso diferente.
  const ids = (data ?? []).map((x: any) => x.publicado_id).filter(Boolean);
  const metas = new Map<number, string>();
  if (ids.length) {
    const { data: pubs } = await db.from("crm_templates").select("id,status").in("id", ids);
    for (const t of pubs ?? []) metas.set((t as any).id, String((t as any).status ?? "").toUpperCase());
  }
  const estadoDe = (x: any): { chave: string; rotulo: string } => {
    if (x.status === "recusado") return { chave: "recusada", rotulo: "Recusada" };
    if (x.status === "pendente") return { chave: "analise_admin", rotulo: "Em análise com o administrador" };
    // aprovado daqui para baixo
    if (!x.publicado_id) return { chave: "aprovada_nao_criada", rotulo: "Aprovada — o administrador ainda vai criar na Meta" };
    const m = metas.get(x.publicado_id);
    if (m === "APPROVED") return { chave: "pronta", rotulo: "Pronta para usar" };
    if (m === "REJECTED") return { chave: "recusada_meta", rotulo: "A Meta recusou este template" };
    return { chave: "analise_meta", rotulo: "Criada na Meta, esperando a análise deles" };
  };
  const agora = Date.now();
  const sugestoes = (data ?? []).map((x: any) => ({
    ...x,
    estado: estadoDe(x),
    // Nao ha prazo para a analise do admin, entao a tela nao promete nenhum --
    // mostra ha quanto tempo espera, que e verdade verificavel.
    espera_dias: Math.max(0, Math.floor((agora - new Date(x.criado_em).getTime()) / 86400000)),
  }));

  // Os templates que já existem e que ele pode usar HOJE. Sem isto, a primeira
  // coisa que o consultor faz é sugerir algo que já está no ar.
  const { data: prontos } = await db
    .from("crm_templates")
    .select("id,nome,corpo,status,canal,padrao")
    .eq("ativo", true)
    .order("id");

  return Response.json({
    sugestoes,
    prontos: (prontos ?? []).filter((t: any) =>
      t.canal !== "cloud" || String(t.status ?? "").toUpperCase() === "APPROVED"),
    sou_admin: podeAdmin(sessao),
    limites: LIM,
  });
}

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }

  const nome = String(b?.nome ?? "").trim();
  const corpo = String(b?.corpo ?? "").trim();
  if (nome.length < 3) return Response.json({ error: "dê um nome ao template" }, { status: 400 });
  if (corpo.length < 10) return Response.json({ error: "escreva o texto da mensagem" }, { status: 400 });
  if (nome.length > LIM.nome) return Response.json({ error: `o nome passa de ${LIM.nome} caracteres` }, { status: 400 });
  if (corpo.length > LIM.corpo) return Response.json({ error: `o texto passa de ${LIM.corpo} caracteres` }, { status: 400 });

  // Mesma regra do envio (§24.3): só `{{1}}` é preenchido automaticamente (o
  // primeiro nome). Aceitar {{2}} aqui produziria uma sugestão que, aprovada,
  // vira um template aprovado e INENVIÁVEL pelo botão do card — a falha
  // apareceria semanas depois, longe de quem escreveu.
  const vars = variaveisDe(corpo);
  const fora = vars.filter((n) => n !== 1);
  if (fora.length) {
    return Response.json({
      error: `só {{1}} é preenchido automaticamente (o primeiro nome da cliente). Tire ${fora.map((n) => `{{${n}}}`).join(", ")}.`,
    }, { status: 400 });
  }

  const cab = b?.cabecalho_tipo === "texto" ? "texto" : null;   // imagem entra depois, pelo admin
  const cabTxt = cab === "texto" ? String(b?.cabecalho_texto ?? "").trim().slice(0, LIM.cabecalho) : null;
  if (cab === "texto" && !cabTxt) {
    return Response.json({ error: "o cabeçalho está vazio — escreva ou remova" }, { status: 400 });
  }

  const { data, error } = await sb().from("template_sugestao").insert({
    carteira: carteiraDe(sessao),
    autor_email: cookies().get("crm_email")?.value ?? null,
    nome, corpo,
    cabecalho_tipo: cab,
    cabecalho_texto: cabTxt,
    rodape: b?.rodape ? String(b.rodape).trim().slice(0, LIM.rodape) : null,
    justificativa: b?.justificativa ? String(b.justificativa).trim().slice(0, LIM.justificativa) : null,
  }).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    ok: true, sugestao: data,
    aviso: "Enviado para análise do administrador. Você vê aqui quando ele responder.",
  });
}

export async function PATCH(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  if (!podeAdmin(sessao)) {
    return Response.json({ error: "só o administrador avalia sugestões" }, { status: 403 });
  }

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const id = Number(b?.id);
  const acao = String(b?.acao ?? "");
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });
  if (acao !== "aprovar" && acao !== "recusar" && acao !== "reabrir") {
    return Response.json({ error: "ação inválida" }, { status: 400 });
  }

  const motivo = String(b?.motivo ?? "").trim();
  // Recusa SEM motivo é o pior resultado possível: o consultor não sabe o que
  // corrigir e ou desiste, ou manda a mesma coisa de novo.
  if (acao === "recusar" && motivo.length < 5) {
    return Response.json({ error: "diga o motivo da recusa — é o que permite corrigir" }, { status: 400 });
  }

  const { error } = await sb().from("template_sugestao").update({
    status: acao === "aprovar" ? "aprovado" : acao === "recusar" ? "recusado" : "pendente",
    motivo: acao === "reabrir" ? null : (motivo || null),
    avaliado_por: acao === "reabrir" ? null : sessao,
    avaliado_em: acao === "reabrir" ? null : new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    ok: true,
    aviso: acao === "aprovar"
      // Aprovar NÃO publica. Ver o comentário da 0110: separar a decisão da
      // ação irreversível na Meta é deliberado.
      ? "Aprovada. Ela ainda não existe na Meta — use “Publicar” para criar o template com este texto."
      : acao === "recusar" ? "Recusada. O consultor vê o motivo na tela dele."
      : "Voltou para análise.",
  });
}

export async function DELETE(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "id ausente" }, { status: 400 });

  const db = sb();
  const { data: s } = await db.from("template_sugestao").select("carteira,status").eq("id", id).maybeSingle();
  if (!s) return Response.json({ error: "sugestão não encontrada" }, { status: 404 });

  const minha = carteiraDe(sessao);
  if (minha && s.carteira !== minha) {
    return Response.json({ error: "esta sugestão é de outro consultor" }, { status: 403 });
  }
  // Já avaliada vira histórico: apagar apagaria também o motivo da recusa, que
  // é o que ensina a próxima tentativa.
  if (s.status !== "pendente" && minha) {
    return Response.json({ error: "esta sugestão já foi avaliada e não pode ser apagada" }, { status: 422 });
  }

  const { error } = await db.from("template_sugestao").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, aviso: "Sugestão apagada." });
}
