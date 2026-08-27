import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { lerCampos, faltando } from "../../../../lib/cadastroCampos";
import { donoEfetivo, carregarAtribuicoes } from "../../../../lib/chatEscopo";
import { carteiraDe } from "../../../../lib/papel";
import { VIEW_FUNIL_TELA } from "../../../../lib/crmConfig";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ficha de cadastro do cliente novo (0109).
//
// A cliente dita os dados no chat, o consultor cola aqui, e a ficha fica
// esperando alguém digitar no WinThor. NÃO é cadastro oficial: o oficial nasce
// no ERP e volta pelo espelho `wth_carteira` — por isso `copiado_em` existe, e
// por isso a ficha some da tela assim que o vínculo aparece.
//
// GET  -> campos configurados + a ficha que já existe (se existir)
// PUT  -> grava/atualiza a ficha
// POST -> marca como copiada no WinThor
// ---------------------------------------------------------------------------

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Mesma régua do resto do chat: o dono efetivo (transferência vigente, senão a
 * carteira) ou admin/home. Dono NULO **não** bloqueia — a fila de espera é de
 * todos, e é justamente lá que mora o contato novo que precisa de cadastro.
 */
async function podeMexer(db: any, sessao: string, cliente_id: string): Promise<boolean> {
  const minha = carteiraDe(sessao);
  if (!minha) return true;                       // admin/home veem tudo
  const [{ data: f }, atrib] = await Promise.all([
    db.from(VIEW_FUNIL_TELA).select("vendedor").eq("cliente_id", cliente_id).maybeSingle(),
    carregarAtribuicoes(db),
  ]);
  const dono = donoEfetivo(cliente_id, (f as any)?.vendedor ?? null, atrib);
  return !dono || dono === minha;                // dono NULO = fila, e a fila e de todos
}

async function campos(db: any) {
  const { data } = await db.from("crm_config").select("cadastro_campos").eq("id", 1).maybeSingle();
  return lerCampos(data?.cadastro_campos);
}

export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  const cliente_id = new URL(req.url).searchParams.get("cliente_id") ?? "";
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const db = sb();
  const [cs, ficha] = await Promise.all([
    campos(db),
    db.from("cadastro_cliente").select("dados,observacao,copiado_em,copiado_por,atualizado_em").eq("cliente_id", cliente_id).maybeSingle(),
  ]);

  return Response.json({
    campos: cs,
    ficha: ficha.data ?? null,
  });
}

export async function PUT(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const cliente_id = String(b?.cliente_id ?? "");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  // Card sintético do ERP não é contato: não há conversa, não há o que ditar, e
  // a FK apontaria para uma linha que não existe.
  if (/^(winthor|venda):/.test(cliente_id)) {
    return Response.json({ error: "este card vem do ERP, não é um contato do chat" }, { status: 422 });
  }

  const db = sb();
  if (!(await podeMexer(db, sessao, cliente_id))) {
    return Response.json({ error: "esta conversa é de outra carteira" }, { status: 403 });
  }

  const cs = await campos(db);
  // Só as chaves configuradas entram. Sem isso, um cliente desatualizado (ou
  // alguém curioso) gravaria campo que a tela nunca mostra e ninguém revisa.
  const dados: Record<string, string> = {};
  for (const c of cs) {
    const v = String(b?.dados?.[c.k] ?? "").trim();
    if (v) dados[c.k] = v.slice(0, 300);
  }

  const falta = faltando(cs, dados);
  if (falta.length) {
    return Response.json({ error: `falta preencher: ${falta.join(", ")}` }, { status: 400 });
  }

  const { error } = await db.from("cadastro_cliente").upsert({
    cliente_id,
    dados,
    observacao: b?.observacao ? String(b.observacao).slice(0, 1000) : null,
    criado_por: sessao,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "cliente_id" });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // O nome também vai para `clientes`: é ele que o board e a lista do chat
  // mostram enquanto não houver vínculo com o ERP. Depois do vínculo o WinThor
  // passa a mandar sozinho (0108), então isto não briga com nada.
  const nome = dados["nome"];
  if (nome && nome.length >= 2) {
    await db.from("clientes").update({ nome_completo: nome }).eq("id", cliente_id);
  }
  // CPF/CNPJ é o que faz `wth_reconciliar_vinculos()` casar em até 10 min e o
  // histórico de compra aparecer sozinho (§43.3).
  const doc = String(dados["cpf_cnpj"] ?? "").replace(/\D/g, "");
  if (doc.length === 11 || doc.length === 14) {
    await db.from("clientes").update({ cpf: doc }).eq("id", cliente_id);
  }

  return Response.json({
    ok: true,
    aviso: doc
      ? "Ficha salva. Com o CPF/CNPJ preenchido, o vínculo com o WinThor aparece em até 10 minutos."
      : "Ficha salva.",
  });
}

/** Marca que alguém já digitou esta ficha no WinThor. */
export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const cliente_id = String(b?.cliente_id ?? "");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const db = sb();
  if (!(await podeMexer(db, sessao, cliente_id))) {
    return Response.json({ error: "esta conversa é de outra carteira" }, { status: 403 });
  }

  // `desfazer` porque marcar por engano é fácil e a ficha sumiria da lista de
  // pendentes sem ninguém ter digitado nada.
  const desfazer = b?.desfazer === true;
  const { error } = await db.from("cadastro_cliente").update({
    copiado_em: desfazer ? null : new Date().toISOString(),
    copiado_por: desfazer ? null : sessao,
  }).eq("cliente_id", cliente_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, aviso: desfazer ? "Ficha voltou para pendente." : "Ficha marcada como cadastrada no WinThor." });
}
