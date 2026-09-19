import { sbAdmin, guardaAdmin, corpo } from "../../../../lib/adminApi";
import { variaveisDe } from "../../../../lib/templateVars";
import { lerCrmConfig, linhasVisiveis } from "../../../../lib/crmConfig";
import { montarPublico, lerFiltros, LIMITE_MAX } from "../../../../lib/publicoDisparo";
import { resolverListaManual, LIMITE_LISTA, LOTE_RESOLVER, type CardManual } from "../../../../lib/publicoManual";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // a prévia varre a vw_funil inteira (paginada)

// Disparo em massa — a "campanha" do CRM, no lugar onde configuração mora.
//
// Antes isto era um botão no board, e o público saía dos filtros que estivessem
// ligados na tela naquele momento. Funcionava, mas amarrava uma ação cara e
// irreversível ao estado de uma tela de trabalho: quem disparava montava o
// público mexendo em filtro de card, e não sobrava registro legível do que foi
// feito. Aqui o público é DECLARADO — carteira, etapa, tempo parado — e a rota
// devolve exatamente quem seria atingido ANTES de qualquer envio, como faz a
// tela de campanhas do RD Conversas.
//
// ⚠️ A PENEIRA NÃO MORA MAIS AQUI. Foi para `lib/publicoDisparo.ts`, porque o
// chat do Claude (`./chat`) monta o mesmo público conversando — e duas peneiras
// para a mesma pergunta divergiriam sem ninguém notar até depois do envio.
//
// O ENVIO continua sendo do navegador, um POST /api/send-template por cliente,
// com pausa do ETL e espera entre um e outro. Não foi trazido para cá de
// propósito: a cota é compartilhada com o ETL (§14.5) — um laço de centenas de
// envios não cabe no tempo de uma rota da Vercel. Esta rota escolhe e explica o
// público; quem manda é a tela, um a um, mostrando a falha de cada cliente.
//
// ⚠️ NADA AQUI OLHA MAIS O RD CONVERSAS quando ele está escondido (§44). O
// discriminador de canal em `disparos_template` é o próprio **id**: o ramo
// Cloud grava o `wamid` da Meta, o do RD grava o id do painel deles.

// --- GET: o que a tela precisa para montar uma campanha ---------------------
export async function GET() {
  const g = guardaAdmin("ver o disparo em massa");
  if (g.erro) return g.erro;

  const db = sbAdmin();

  const cfgG = await lerCrmConfig(db);
  const soCloud = !linhasVisiveis(cfgG).includes("rd");

  const [tplRes, cartRes, histRes] = await Promise.all([
    db.from("crm_templates")
      .select("id,nome,canal,rd_template_id,meta_nome,corpo,cabecalho_tipo,status,padrao")
      .eq("ativo", true).order("id"),
    db.from("carteira_config").select('slug,cor,"time"').eq("ativo", true).order("slug"),
    (() => {
      let q = db.from("disparos_template")
        .select("criada_em,template_id,vendedor")
        .gte("criada_em", new Date(Date.now() - 30 * 86_400_000).toISOString());
      if (soCloud) q = q.like("id", "wamid.%");   // ver a nota do topo
      return q.order("criada_em", { ascending: false }).limit(5000);
    })(),
  ]);

  if (tplRes.error) return Response.json({ error: tplRes.error.message }, { status: 500 });
  if (cartRes.error) return Response.json({ error: cartRes.error.message }, { status: 500 });

  // Template da Cloud que a Meta ainda não aprovou fica FORA da escolha —
  // oferecê-lo seria oferecer um botão que falha depois do clique. Mesma régua
  // de /api/templates.
  const templates = (tplRes.data ?? [])
    .filter((t: any) => t.canal !== "cloud" || String(t.status ?? "").toUpperCase() === "APPROVED")
    .map((t: any) => ({
      id: t.id,
      nome: t.nome,
      canal: t.canal ?? "rd",
      padrao: !!t.padrao,
      // o id que o envio manda difere por canal: na Cloud é o nome aprovado na
      // Meta, no RD é o id do painel deles (o chat faz a mesma escolha)
      envio_id: t.canal === "cloud" ? t.meta_nome : t.rd_template_id,
      corpo: t.corpo ?? null,
      campos: t.canal === "cloud" ? variaveisDe(t.corpo) : [],
      tem_imagem: t.cabecalho_tipo === "imagem",
      status: t.status ?? null,
    }));

  // Extrato por dia+template: é o histórico de campanha que o board nunca teve
  // — dava para disparar 500 templates e não sobrar nada legível depois.
  const porDia = new Map<string, { dia: string; template_id: string; enviados: number; vendedores: Set<string> }>();
  for (const d of histRes.data ?? []) {
    const dia = new Date(new Date(d.criada_em as string).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
    const chave = `${dia}|${d.template_id ?? "—"}`;
    const linha = porDia.get(chave)
      ?? { dia, template_id: String(d.template_id ?? "—"), enviados: 0, vendedores: new Set<string>() };
    linha.enviados++;
    if (d.vendedor) linha.vendedores.add(String(d.vendedor));
    porDia.set(chave, linha);
  }
  const historico = [...porDia.values()]
    .sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : b.enviados - a.enviados))
    .slice(0, 40)
    .map((l) => ({ dia: l.dia, template_id: l.template_id, enviados: l.enviados, vendedores: [...l.vendedores].sort() }));

  // Aqui existia a entrada sintética "Padrão do sistema", que não mandava
  // `template_id` nenhum e deixava o /api/send-template resolver com o
  // ponteiro do painel do RD. Era a única opção capaz de alcançar a base que
  // ainda atendia por lá. Com o RD encerrado (0131) ela não alcança ninguém:
  // a lista é só o que está cadastrado e aprovado na Meta.
  const lista = templates;

  return Response.json({
    "disparo-massa": {
      templates: lista,
      carteiras: cartRes.data ?? [],
      historico,
      limiteMax: LIMITE_MAX,
      // teto e tamanho de lote da lista digitada / planilha: a tela lê daqui, para
      // não carregar uma segunda cópia do número que o servidor vai cobrar
      limiteLista: LIMITE_LISTA,
      loteResolver: LOTE_RESOLVER,
      // a tela do chat precisa saber se o assistente está configurado para não
      // oferecer uma caixa de conversa que responde 501 no primeiro envio
      temAssistente: !!process.env.ANTHROPIC_API_KEY,
      // interruptor ligado = TODA conversa sai pela Cloud, sem olhar o canal
      envioPadraoCloud: process.env.WHATSAPP_ENVIO_PADRAO === "true",
    },
  });
}

/**
 * Valida os cards que a tela devolve depois de conferir a lista em lotes.
 *
 * A tela junta os cards das chamadas de `resolver` e os manda de volta numa
 * só, para a prévia. Não dá para confiar no formato cegamente — mas também não
 * há por que reconferir cada um no banco (seria refazer o trabalho que levou
 * minutos): só entra o que tem a forma de um card, campo a campo, e o que sobra
 * é descartado. Falta de campo é ERRO, e não "pula": pular calado tiraria
 * clientes da campanha sem ninguém saber.
 */
function lerCards(x: any): { cards: CardManual[] } | { erro: string } {
  if (!Array.isArray(x)) return { erro: "cards inválido" };
  if (x.length > LIMITE_LISTA) {
    return { erro: `A lista tem ${x.length} clientes — o teto de uma lista digitada/planilha é ${LIMITE_LISTA}.` };
  }
  const cards: CardManual[] = [];
  for (const c of x) {
    const cliente_id = String(c?.cliente_id ?? "").trim();
    const telefone = String(c?.telefone ?? "").trim();
    const codcli = Number(c?.codcli);
    if (!cliente_id || !telefone || !Number.isFinite(codcli) || codcli <= 0) {
      return { erro: "a lista conferida veio com um cliente incompleto — refaça a conferência." };
    }
    cards.push({
      cliente_id, telefone, codcli,
      cliente: String(c?.cliente ?? ""),
      vendedor: c?.vendedor == null ? null : String(c.vendedor),
      etapa: null, ultima_atividade: null, venda_valor: null, rd_cliente_id: null,
    });
  }
  return { cards };
}

const numerosUnicos = (x: any): number[] =>
  Array.from(new Set(
    (Array.isArray(x) ? x : []).map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0),
  ));

// --- POST: conferir um lote / prévia do público ------------------------------
//
// ⚠️ POR QUE SÃO DUAS AÇÕES (18/09/2026). Conferir um código é uma ida ao banco
// POR código — achar o contato, ou criá-lo — e a rota tem 60 s. 56 códigos já
// custaram ~49 s; o teto de 500 nasceu daí. Em vez de fazer o total caber numa
// chamada, a tela confere em lotes de `LOTE_RESOLVER` (`acao: "resolver"`) e
// depois pede a prévia UMA vez com todos os cards (`acao: "previa"` + `cards`).
// O tempo de cada chamada deixa de depender do tamanho da lista, e o único teto
// que sobra é o de negócio (`LIMITE_LISTA`).
export async function POST(req: Request) {
  const g = guardaAdmin("montar o público do disparo");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });
  if (b.acao !== "previa" && b.acao !== "resolver") {
    return Response.json({ error: "ação desconhecida" }, { status: 400 });
  }

  try {
    // ---- um lote de códigos -> cards ----
    if (b.acao === "resolver") {
      const unicos = numerosUnicos(b.codclis);
      if (!unicos.length) return Response.json({ cards: [], semAlcance: [] });
      if (unicos.length > LOTE_RESOLVER) {
        return Response.json({
          error: `Um lote aceita até ${LOTE_RESOLVER} códigos e vieram ${unicos.length}. `
            + "Recarregue a página — a tela deve mandar a lista em lotes.",
        }, { status: 400 });
      }
      const { cards, semAlcance } = await resolverListaManual(sbAdmin(), unicos);
      return Response.json({ cards, semAlcance });
    }

    // ---- prévia ----
    // Público DECLARADO (lista digitada ou planilha) — pula a segmentação por
    // filtro e usa exatamente esses clientes.
    //
    // Lista digitada: as proteções de custo (número morto, lixeira,
    // anti-repetição, conversa aberta) continuam valendo.
    //
    // Planilha (`pularProtecoes`, 16/09/2026, a pedido do usuário): "a planilha
    // já é resultado de um filtro externo" — nem essas proteções rodam. É
    // upload + envio, sem peneira nenhuma no meio.
    if (b.cards !== undefined || Array.isArray(b.codclis)) {
      let cards: CardManual[];
      let semAlcanceInline: any[] = [];
      if (b.cards !== undefined) {
        const lido = lerCards(b.cards);
        if ("erro" in lido) return Response.json({ error: lido.erro }, { status: 400 });
        cards = lido.cards;
      } else {
        // Caminho antigo (uma aba aberta antes desta mudança ainda manda
        // `codclis`): só vale para uma lista pequena, que cabe numa chamada.
        const unicos = numerosUnicos(b.codclis);
        if (unicos.length > LOTE_RESOLVER) {
          return Response.json({
            error: `A lista tem ${unicos.length} códigos e esta versão da tela não a confere de uma vez. `
              + "Recarregue a página e confira de novo — o teto agora é " + LIMITE_LISTA + ".",
          }, { status: 400 });
        }
        const r = await resolverListaManual(sbAdmin(), unicos);
        cards = r.cards;
        semAlcanceInline = r.semAlcance;
      }

      const pularProtecoes = !!b.pularProtecoes;
      const publico = await montarPublico(
        sbAdmin(),
        lerFiltros(pularProtecoes
          ? { limite: LIMITE_LISTA }
          : { diasRecontato: b.filtros?.diasRecontato, semConversaAberta: b.filtros?.semConversaAberta, limite: LIMITE_LISTA },
          LIMITE_LISTA),
        {},
        cards,
        pularProtecoes,
      );
      return Response.json({ ...publico, semAlcance: semAlcanceInline });
    }

    const publico = await montarPublico(sbAdmin(), lerFiltros(b.filtros ?? {}));
    return Response.json(publico);
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
