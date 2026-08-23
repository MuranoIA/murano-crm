import { sbAdmin, guardaAdmin, corpo } from "../../../../lib/adminApi";
import { variaveisDe } from "../../../../lib/templateVars";

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
// O ENVIO continua sendo do navegador, um POST /api/send-template por cliente,
// com pausa do ETL e espera entre um e outro. Não foi trazido para cá de
// propósito: a cota do RD é de ~48 chamadas/min e é COMPARTILHADA com o ETL
// (§14.5) — um laço de centenas de envios não cabe no tempo de uma rota da
// Vercel. Esta rota escolhe e explica o público; quem manda é a tela, um a um,
// mostrando a falha de cada cliente.

const PAGE = 1000;
const COLS = "cliente_id,cliente,vendedor,etapa,ultima_atividade,telefone,venda_valor,rd_cliente_id,codcli";

/** Dias desde uma data ISO. Sem data = nunca teve atividade. */
const diasDesde = (iso: string | null | undefined): number => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return isNaN(t) ? Infinity : (Date.now() - t) / 86_400_000;
};

const tel8 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-8);

/**
 * O id que o /api/send-template entende. A linha do funil pode ser um card
 * sintético (`winthor:<codcli>`, da fila de prospecção) que não existe em
 * `clientes` — esse contato só é alcançável se já tiver par no RD.
 */
function idDeEnvio(c: any): string | null {
  if (c.rd_cliente_id) return String(c.rd_cliente_id);
  const id = c.cliente_id;
  return typeof id === "string" && !id.includes(":") ? id : null;
}

const codDeId = (id: any): number | null => {
  if (typeof id === "string" && (id.startsWith("winthor:") || id.startsWith("venda:"))) {
    const n = Number(id.slice(id.indexOf(":") + 1));
    return isNaN(n) ? null : n;
  }
  return null;
};

// --- GET: o que a tela precisa para montar uma campanha ---------------------
export async function GET() {
  const g = guardaAdmin("ver o disparo em massa");
  if (g.erro) return g.erro;

  const db = sbAdmin();

  const [tplRes, cartRes, histRes] = await Promise.all([
    db.from("crm_templates")
      .select("id,nome,canal,rd_template_id,meta_nome,corpo,cabecalho_tipo,status,padrao")
      .eq("ativo", true).order("id"),
    db.from("carteira_config").select('slug,cor,"time"').eq("ativo", true).order("slug"),
    db.from("disparos_template")
      .select("criada_em,template_id,vendedor")
      .gte("criada_em", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("criada_em", { ascending: false }).limit(5000),
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
  // manda `template_id` nenhum e deixa o /api/send-template resolver — o que hoje
  // significa cair em TEMPLATE_RECONTATO_ID, o template do painel do RD. É a ÚNICA
  // que alcança a base do RD, onde está praticamente toda a conversa (§16.3), já
  // que nenhum template do RD está cadastrado em crm_templates. Sem ela, esta tela
  // nasceria incapaz de fazer o que o board fazia.
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

  const f = b.filtros ?? {};
  const carteiras: string[] = Array.isArray(f.carteiras) ? f.carteiras.map(String) : [];
  const etapas: string[] = Array.isArray(f.etapas) ? f.etapas.map(String) : [];
  const diasMin = Number.isFinite(Number(f.diasMin)) ? Math.max(0, Number(f.diasMin)) : 0;
  const diasRecontato = Math.min(60, Math.max(0, Number(f.diasRecontato ?? 4) || 0));
  const limite = Math.min(500, Math.max(1, Number(f.limite ?? 20) || 20));
  // canal do template escolhido: "cloud" | "rd" | null (nenhum escolhido ainda)
  const canalTpl: string | null = f.canal === "cloud" || f.canal === "rd" ? f.canal : null;

  const db = sbAdmin();

  // 1) cards do funil (paginado — o PostgREST corta em 1000 e a view passa de 4 mil)
  const cards: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from("vw_funil").select(COLS)
      .order("ultima_atividade", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (carteiras.length) q = q.in("vendedor", carteiras);
    if (etapas.length) q = q.in("etapa", etapas);
    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    cards.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // 2) contexto: último disparo, lixeira, ciclo de compra e quem já conversa
  //    pela Cloud. Nenhum depende do outro, então vão em paralelo.
  const desdeDisparo = new Date(Date.now() - Math.max(diasRecontato, 1) * 86_400_000).toISOString();
  const [dispRes, descRes, cicloRes, linhaRes] = await Promise.all([
    db.from("disparos_template").select("cliente_id,criada_em").gte("criada_em", desdeDisparo),
    db.from("wth_descartados").select("cliente_id,codcli,tel8"),
    db.from("vw_ciclo_card").select("cliente_id,codcli,telefone,score_urgencia,tipo_oportunidade"),
    db.from("vw_chat_linha_cliente").select("cliente_id"),
  ]);

  const ultimoDisparo = new Map<string, string>();
  for (const d of dispRes.data ?? []) {
    const id = String(d.cliente_id ?? "");
    const atual = ultimoDisparo.get(id);
    if (!atual || String(d.criada_em) > atual) ultimoDisparo.set(id, String(d.criada_em));
  }

  const descCli = new Set((descRes.data ?? []).map((d: any) => d.cliente_id).filter(Boolean));
  const descCod = new Set((descRes.data ?? []).map((d: any) => d.codcli).filter((x: any) => x != null).map(Number));
  const descTel = new Set((descRes.data ?? []).map((d: any) => d.tel8).filter(Boolean));

  const cicloCli = new Map<string, any>(), cicloCod = new Map<number, any>(), cicloTel = new Map<string, any>();
  for (const r of cicloRes.data ?? []) {
    if (r.cliente_id) cicloCli.set(String(r.cliente_id), r);
    if (r.codcli != null) cicloCod.set(Number(r.codcli), r);
    const t = tel8(r.telefone);
    if (t.length === 8) cicloTel.set(t, r);
  }

  // Canal do contato. Conversa que já trafegou pela Cloud carrega `linha_id` e
  // aparece na view; quem NÃO aparece não tem mensagem `wamid` nenhuma, então o
  // roteamento de /api/send-template dá "rd" com certeza. O erro possível é só
  // para o lado conservador (contar como Cloud quem voltou a falar pelo RD).
  const envioPadraoCloud = process.env.WHATSAPP_ENVIO_PADRAO === "true";
  const naCloud = new Set((linhaRes.data ?? []).map((r: any) => String(r.cliente_id)));
  const canalDe = (id: string): "whatsapp" | "rd" =>
    envioPadraoCloud || id.startsWith("wa:") || naCloud.has(id) ? "whatsapp" : "rd";

  // 3) peneira, contando o motivo de CADA corte — número sem motivo vira
  //    discussão ("por que só 12?") que ninguém resolve olhando a tela.
  const cortes = { sem_contato: 0, sem_telefone: 0, descartado: 0, disparo_recente: 0, ativo_demais: 0, canal: 0 };
  const elegiveis: any[] = [];
  const vistos = new Set<string>();

  for (const c of cards) {
    const envio = idDeEnvio(c);
    if (!envio) { cortes.sem_contato++; continue; }
    if (!c.telefone) { cortes.sem_telefone++; continue; }

    const cod = c.codcli ?? codDeId(c.cliente_id);
    const t = tel8(c.telefone);
    if (descCli.has(c.cliente_id) || descCli.has(envio)
      || (cod != null && descCod.has(Number(cod)))
      || (t.length === 8 && descTel.has(t))) { cortes.descartado++; continue; }

    const ud = ultimoDisparo.get(envio) ?? ultimoDisparo.get(String(c.cliente_id));
    if (diasRecontato > 0 && ud && diasDesde(ud) < diasRecontato) { cortes.disparo_recente++; continue; }

    const dias = diasDesde(c.ultima_atividade);
    if (dias < diasMin) { cortes.ativo_demais++; continue; }

    const canal = canalDe(envio);
    // Template da Cloud só chega em conversa que já corre na Cloud: numa do RD o
    // envio cai no ramo do RD com um nome que o painel deles não conhece —
    // falha certa, uma por cliente. Recortar aqui é mais honesto do que deixar
    // falhar trezentas vezes e chamar de "erro".
    if (canalTpl === "cloud" && canal !== "whatsapp") { cortes.canal++; continue; }

    // dedup: prospecção e conversa podem apontar para o mesmo contato do RD
    if (vistos.has(envio)) continue;
    vistos.add(envio);

    const ci = (cod != null && cicloCod.get(Number(cod)))
      || cicloCli.get(String(c.cliente_id))
      || (t.length === 8 ? cicloTel.get(t) : null);

    // mesmo score do board: urgência do ciclo + tempo parado + ticket
    const parado = dias === Infinity ? 40 : Math.min(dias, 60);
    const score = Number(ci?.score_urgencia ?? 0) + parado * 0.6 + Math.min(Number(c.venda_valor ?? 0) / 100, 30);

    elegiveis.push({
      envio_id: envio,
      cliente_id: String(c.cliente_id),
      cliente: c.cliente ?? "",
      primeiro_nome: String(c.cliente ?? "").trim().split(/\s+/)[0] || "cliente",
      vendedor: c.vendedor ?? null,
      etapa: c.etapa ?? null,
      dias: dias === Infinity ? null : Math.floor(dias),
      canal,
      ciclo: ci?.tipo_oportunidade ?? null,
      score: Math.round(score * 10) / 10,
    });
  }

  elegiveis.sort((a, b) => b.score - a.score);
  const selecionados = elegiveis.slice(0, limite);

  return Response.json({
    total: elegiveis.length,
    selecionados,
    cortes,
    porCanal: {
      whatsapp: selecionados.filter((c) => c.canal === "whatsapp").length,
      rd: selecionados.filter((c) => c.canal === "rd").length,
    },
  });
}
