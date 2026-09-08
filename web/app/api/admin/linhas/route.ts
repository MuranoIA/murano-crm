import { sbAdmin, guardaAdmin, corpo, texto } from "../../../../lib/adminApi";
import { lerCrmConfig, linhaPadraoCloud, linhasVisiveis } from "../../../../lib/crmConfig";
import { listarNumerosMeta, normalizarNumero } from "../../../../lib/whatsappLinhas";

export const dynamic = "force-dynamic";

// Linhas telefônicas do WhatsApp (`chat_linha`, migration 0080) — o rótulo que
// o chat mostra no cabeçalho da conversa para dizer POR QUAL número aquele
// diálogo está acontecendo.
//
// Duas coisas diferentes vivem aqui, e a tela precisa separar:
//   · o CADASTRO (rótulo, número, ativo/inativo) — sempre foi só isto;
//   · desde a 0123, também QUAL linha Cloud é a PADRÃO de mensagem (o antigo
//     "WHATSAPP_PHONE_NUMBER_ID resolve sozinho" deixou de bastar quando
//     existe mais de uma linha Cloud ativa ao mesmo tempo).
// O que isto NÃO decide: por qual número CADA CONVERSA sai — isso é
// `linhaDaConversa()` (lib/whatsapp.ts), que segue o número em que o CLIENTE
// falou por último. A escolha daqui só vale de fallback (conversa nova, ou
// sem linha própria ainda). E não decide NADA de calling, que fica preso à
// env de propósito (ver o comentário em lib/whatsapp.ts sobre `linhaDeEnvio`).

const COLS = "phone_number_id,numero,rotulo,carteira,ativo,criado_em";

export async function GET() {
  const g = guardaAdmin("ver as linhas");
  if (g.erro) return g.erro;

  const db = sbAdmin();
  const [{ data, error }, cfg] = await Promise.all([
    db.from("chat_linha").select(COLS).order("ativo", { ascending: false }).order("rotulo"),
    lerCrmConfig(db),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const envAtual = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").replace(/[^\x21-\x7E]/g, "") || null;
  const escolhaAdmin = linhaPadraoCloud(cfg);   // já validada contra linha ativa
  const visiveis = linhasVisiveis(cfg);

  return Response.json({
    linhas: data ?? [],
    // a env crua — só para a tela poder dizer "é o padrão de fábrica"
    linhaDeEnvio: envAtual,
    // a escolha salva em /admin (pode ser null = "segue a env")
    linhaPadraoCloud: cfg.linha_padrao_cloud,
    // a resolvida de fato: o que `linhaDaConversa()` usa hoje para conversa
    // sem linha própria — é isto que a tela deve destacar como "em uso"
    linhaEmUso: escolhaAdmin ?? envAtual,
    // quais linhas o board/chat mostram hoje — para a tela avisar quando uma
    // linha recém-cadastrada não vai aparecer sozinha (§32.1: só some da
    // congelada se alguém marcar; a lista congelada não pega linha nova)
    linhasVisiveis: visiveis,
    todasVisiveis: cfg.linhas_visiveis === null,
  });
}

export async function POST(req: Request) {
  const g = guardaAdmin("cadastrar linha");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  // ---- sincronizar com a Meta: descobre número sem digitar phone_number_id --
  if (b.acao === "sincronizar") {
    let encontrados;
    try {
      encontrados = await listarNumerosMeta(texto(b.waba_id) || undefined);
    } catch (e: any) {
      return Response.json({ error: `Meta: ${e?.message ?? e}` }, { status: 502 });
    }
    if (!encontrados.length) {
      return Response.json({ ok: true, novas: [], atualizadas: [], aviso: "A Meta não devolveu nenhum número para esta conta." });
    }

    const db = sbAdmin();
    const { data: existentes } = await db.from("chat_linha").select("phone_number_id,numero");
    const porId = new Map((existentes ?? []).map((l: any) => [l.phone_number_id, l]));

    const novas: string[] = [];
    const atualizadas: string[] = [];
    for (const n of encontrados) {
      const ja = porId.get(n.phone_number_id);
      const numeroNorm = normalizarNumero(n.numero);
      if (!ja) {
        // nasce ATIVA (mesmo padrão do cadastro manual) — some da tela só se
        // `linhas_visiveis` estiver com uma lista congelada, e a tela avisa disso
        const { error } = await db.from("chat_linha").insert({
          phone_number_id: n.phone_number_id,
          numero: numeroNorm,
          rotulo: n.nome || numeroNorm || n.phone_number_id,
          carteira: null,
          ativo: true,
        });
        if (!error) novas.push(n.phone_number_id);
        continue;
      }
      // já cadastrada: só corrige o número se mudou. Rótulo, carteira e
      // ativo/inativo são decisão do admin — sincronizar não pode sobrescrever
      // um rótulo que alguém já personalizou.
      if (numeroNorm && numeroNorm !== ja.numero) {
        const { error } = await db.from("chat_linha").update({ numero: numeroNorm }).eq("phone_number_id", n.phone_number_id);
        if (!error) atualizadas.push(n.phone_number_id);
      }
    }

    return Response.json({
      ok: true, novas, atualizadas, total_na_meta: encontrados.length,
      aviso: novas.length
        ? `${novas.length} linha(s) nova(s) encontrada(s) e cadastrada(s).`
        : "Nenhuma linha nova — a Meta não tem número que já não estivesse aqui.",
    });
  }

  // ---- cadastro manual (o de sempre) ----------------------------------------
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

  // ---- escolher a linha Cloud padrão de mensagem (0123) ---------------------
  // Campo próprio (`padrao`), não mais um `phone_number_id`-keyed edit: aqui
  // não se está editando UMA linha, se está escolhendo QUAL delas é a
  // referência. Ignora o resto do corpo se vier junto.
  if ("padrao" in b) {
    const v = b.padrao === null ? null : texto(b.padrao);
    if (v !== null) {
      if (v === "rd") return Response.json({ error: "o RD não é uma linha Cloud — não recebe mensagem por aqui" }, { status: 400 });
      const { data: linha } = await sbAdmin().from("chat_linha").select("ativo").eq("phone_number_id", v).maybeSingle();
      if (!linha) return Response.json({ error: "linha desconhecida — cadastre ou sincronize primeiro" }, { status: 404 });
      if (!linha.ativo) return Response.json({ error: "essa linha está inativa — reative antes de marcar como padrão" }, { status: 409 });
    }
    const { error } = await sbAdmin().from("crm_config").upsert({
      id: 1, linha_padrao_cloud: v,
      atualizado_por: g.email, atualizado_em: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({
      ok: true,
      aviso: v === null
        ? "Voltou ao padrão de fábrica: quem decide agora é WHATSAPP_PHONE_NUMBER_ID, na Vercel."
        : "Linha padrão de mensagem atualizada. Vale para conversa nova ou sem linha própria ainda — quem já tem histórico continua saindo por onde já saía.",
    });
  }

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
    const db = sbAdmin();
    const emUsoEnv = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").replace(/[^\x21-\x7E]/g, "");
    const cfg = await lerCrmConfig(db);
    const emUso = linhaPadraoCloud(cfg) ?? emUsoEnv;
    if (emUso && emUso === phone_number_id) {
      return Response.json({
        error: cfg.linha_padrao_cloud === phone_number_id
          ? "esta é a linha padrão de mensagem hoje — escolha outra em \"linha padrão\" antes de desativar"
          : "esta é a linha que envia hoje (WHATSAPP_PHONE_NUMBER_ID na Vercel) — troque a variável antes de desativar",
      }, { status: 409 });
    }
  }

  const { data, error } = await sbAdmin().from("chat_linha").update(patch).eq("phone_number_id", phone_number_id).select(COLS).single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, linha: data });
}
