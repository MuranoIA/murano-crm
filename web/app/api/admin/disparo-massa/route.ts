import { sbAdmin, guardaAdmin, corpo } from "../../../../lib/adminApi";
import { variaveisDe } from "../../../../lib/templateVars";
import { lerCrmConfig, linhasVisiveis } from "../../../../lib/crmConfig";
import { montarPublico, lerFiltros, LIMITE_MAX } from "../../../../lib/publicoDisparo";

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

  // A opção que o modal do board oferecia como "template padrão do sistema": não
  // manda `template_id` nenhum e deixa o /api/send-template resolver. É a ÚNICA
  // que alcança a base do RD, já que nenhum template do RD está cadastrado em
  // crm_templates. Sem ela, esta tela nasceria incapaz de fazer o que o board fazia.
  const padraoRd = !!process.env.TEMPLATE_RECONTATO_ID
    || templates.some((t: any) => t.canal !== "cloud" && t.envio_id);
  const lista = padraoRd
    ? [{
        id: 0, nome: "Padrão do sistema", canal: "rd", padrao: false,
        envio_id: null, corpo: null, campos: [], tem_imagem: false, status: null,
        nota: "o template de recontato configurado no painel do RD Conversas — é o que alcança a base que ainda atende por lá",
      }, ...templates]
    : templates;

  return Response.json({
    "disparo-massa": {
      templates: lista,
      carteiras: cartRes.data ?? [],
      historico,
      limiteMax: LIMITE_MAX,
      // a tela do chat precisa saber se o assistente está configurado para não
      // oferecer uma caixa de conversa que responde 501 no primeiro envio
      temAssistente: !!process.env.ANTHROPIC_API_KEY,
      // interruptor ligado = TODA conversa sai pela Cloud, sem olhar o canal
      envioPadraoCloud: process.env.WHATSAPP_ENVIO_PADRAO === "true",
    },
  });
}

// --- POST: prévia do público ------------------------------------------------
export async function POST(req: Request) {
  const g = guardaAdmin("montar o público do disparo");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });
  if (b.acao !== "previa") return Response.json({ error: "ação desconhecida" }, { status: 400 });

  try {
    const publico = await montarPublico(sbAdmin(), lerFiltros(b.filtros ?? {}));
    return Response.json(publico);
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
