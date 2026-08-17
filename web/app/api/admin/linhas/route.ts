import { sbAdmin, guardaAdmin, corpo, texto } from "../../../../lib/adminApi";

export const dynamic = "force-dynamic";

// Linhas telefônicas do WhatsApp (`chat_linha`, migration 0080) — o rótulo que
// o chat mostra no cabeçalho da conversa para dizer POR QUAL número aquele
// diálogo está acontecendo. Hoje são duas (número de teste da Meta e a linha
// piloto); na Fase C entra o número oficial.
//
// O que esta tela NÃO faz, e é importante não confundir: ela não cria número na
// Meta, não registra linha e não escolhe por onde a mensagem sai. O envio usa
// WHATSAPP_PHONE_NUMBER_ID, uma variável de ambiente na Vercel (ver linhaDeEnvio
// em lib/whatsapp.ts). Aqui é só o cadastro do que já existe lá — mudar o
// rótulo não muda o roteamento.

const COLS = "phone_number_id,numero,rotulo,carteira,ativo,criado_em";

export async function GET() {
  const g = guardaAdmin("ver as linhas");
  if (g.erro) return g.erro;

  const db = sbAdmin();
  const { data, error } = await db.from("chat_linha").select(COLS).order("ativo", { ascending: false }).order("rotulo");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    linhas: data ?? [],
    // qual delas é a que realmente envia hoje — sem isso a tela lista duas
    // linhas iguais e ninguém sabe qual está no ar
    linhaDeEnvio: (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").replace(/[^\x21-\x7E]/g, "") || null,
  });
}

export async function POST(req: Request) {
  const g = guardaAdmin("cadastrar linha");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  const phone_number_id = texto(b.phone_number_id).replace(/\D/g, "");
  const rotulo = texto(b.rotulo);
  if (!phone_number_id) return Response.json({ error: "phone_number_id ausente (só números)" }, { status: 400 });
  if (!rotulo) return Response.json({ error: "dê um rótulo à linha" }, { status: 400 });

  const db = sbAdmin();
  const { data: jaTem } = await db.from("chat_linha").select("phone_number_id").eq("phone_number_id", phone_number_id).maybeSingle();
  if (jaTem) return Response.json({ error: "essa linha já está cadastrada" }, { status: 409 });

  const { data, error } = await db.from("chat_linha").insert({
    phone_number_id,
    numero: texto(b.numero) || null,
    rotulo,
    carteira: texto(b.carteira) || null,
    ativo: true,
  }).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, linha: data });
}

export async function PATCH(req: Request) {
  const g = guardaAdmin("alterar linha");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });
  const phone_number_id = texto(b.phone_number_id);
  if (!phone_number_id) return Response.json({ error: "phone_number_id ausente" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (b.rotulo !== undefined) {
    const rotulo = texto(b.rotulo);
    if (!rotulo) return Response.json({ error: "o rótulo não pode ficar vazio" }, { status: 400 });
    patch.rotulo = rotulo;
  }
  if (b.numero !== undefined) patch.numero = texto(b.numero) || null;
  if (b.carteira !== undefined) patch.carteira = texto(b.carteira) || null;
  if (typeof b.ativo === "boolean") patch.ativo = b.ativo;
  if (!Object.keys(patch).length) return Response.json({ error: "nada pra atualizar" }, { status: 400 });

  // desativar a linha que está enviando esconderia o rótulo das conversas em
  // curso, que continuariam saindo por ela — inconsistência silenciosa
  if (patch.ativo === false) {
    const emUso = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").replace(/[^\x21-\x7E]/g, "");
    if (emUso && emUso === phone_number_id) {
      return Response.json({
        error: "esta é a linha que envia hoje (WHATSAPP_PHONE_NUMBER_ID na Vercel) — troque a variável antes de desativar",
      }, { status: 409 });
    }
  }

  const { data, error } = await sbAdmin().from("chat_linha").update(patch).eq("phone_number_id", phone_number_id).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, linha: data });
}
