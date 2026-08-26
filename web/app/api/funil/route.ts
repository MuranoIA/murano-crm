import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe } from "../../../lib/papel";
import { lerCrmConfig, VIEW_FUNIL_TELA, tudoVisivel } from "../../../lib/crmConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  // autorização: admin e home veem tudo; vendedor vê só a própria carteira (filtro no SERVIDOR)
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const carteira = carteiraDe(sessao);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes" }, { status: 500 });
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Interruptores do CRM (migration 0097). Disparado JÁ, sem await: é uma linha
  // só, e assim a leitura corre em paralelo com os blocos pesados lá embaixo em
  // vez de somar latência a uma rota que já leva segundos (§12.6).
  const cfgP = lerCrmConfig(sb);

  // vendedores do funil (fonte única: carteira_config) — slugs p/ filtrar vendas + cores p/ o board
  // rca_num e time entram junto: o card precisa deles para classificar a divergência
  // entre quem ATENDE (carteira do RD) e quem FATURA (RCA do WinThor) — migration 0093.
  const { data: vendCfg } = await sb.from("carteira_config").select('slug,cor,rca_num,"time"').eq("ativo", true);
  const slugs = (vendCfg ?? []).map((v: any) => v.slug);
  const vendedores = vendCfg ?? [];

  // cards do funil (escopo por carteira quando não-admin).
  // Pagina de mil em mil: o PostgREST/Supabase corta a resposta em 1000 linhas
  // por padrão, e a vw_funil hoje tem ~2.5k (incluindo a fila de prospecção sem
  // atividade, que ficaria de fora se pegássemos só a 1a página).
  const PAGE = 1000;
  // Degraus de colunas: tenta o mais completo; se uma coluna nova ainda não existe
  // (migration pendente), cai pro degrau anterior sem quebrar o board (o front tem
  // fallback). FULL = com nota fiscal (0006); MSGS = com 3 mensagens (0005); BASE = mínimo.
  const COLS_FULL = "cliente_id,cliente,vendedor,etapa,ultima_atividade,ultima_mensagem,ultima_enviada_por,telefone,ultimas_mensagens,venda_valor,venda_data,sem_cadastro,rd_cliente_id,codcli,rca_num,carteira_rd";
  const COLS_MSGS = "cliente_id,cliente,vendedor,etapa,ultima_atividade,ultima_mensagem,ultima_enviada_por,telefone,ultimas_mensagens";
  const COLS_BASE = "cliente_id,cliente,vendedor,etapa,ultima_atividade,ultima_mensagem,ultima_enviada_por,telefone";

  const diaBRT = (offset = 0) => new Date(Date.now() - 3 * 3600 * 1000 - offset * 86400000).toISOString().slice(0, 10);
  const hojeBRT = diaBRT(0), ontemBRT = diaBRT(1);
  const d7 = diaBRT(6), d15 = diaBRT(14);
  const mesIni = hojeBRT.slice(0, 8) + "01";
  const desde = diaBRT(31);
  type TplTot = { hoje: number; ontem: number; semana: number; quinzena: number; mes: number };
  const zero = (): TplTot => ({ hoje: 0, ontem: 0, semana: 0, quinzena: 0, mes: 0 });
  const bucket = (acc: Record<string, TplTot>, vend: string, dia: string, n: number) => {
    const a = (acc[vend] = acc[vend] ?? zero());
    if (dia === hojeBRT) a.hoje += n;
    if (dia === ontemBRT) a.ontem += n;
    if (dia >= d7) a.semana += n;
    if (dia >= d15) a.quinzena += n;
    if (dia >= mesIni) a.mes += n;
  };

  // -- helpers: cada bloco é independente dos demais, então rodam em PARALELO.
  // Localmente (notebook → Supabase na nuvem) cada round-trip custa caro; em série
  // isso somava ~15-20s. Em paralelo o wall-clock cai pro maior bloco. Em produção
  // (Vercel colado no Supabase) também reduz a chance de estourar o timeout.

  // Paginação SEQUENCIAL dentro de cada bloco. O Supabase capa cada resposta em
  // 1000 linhas (max-rows), então precisa paginar. NÃO disparar as páginas em
  // paralelo: cada página re-executa a agregação inteira e a instância satura com
  // scans concorrentes (medido: 8 scans simultâneos -> 38s vs 10s sequencial).
  // O paralelismo fica no nível de BLOCO (Promise.all lá embaixo): no máximo ~2
  // queries pesadas concorrentes (card + funil), que a instância aguenta bem.

  // cards do funil (paginado, com fallback de colunas se migration pendente).
  const carregarCards = async (): Promise<any[]> => {
    // Com as conversas do RD escondidas, lê a view irmã (0098): MESMA régua de
    // 5 colunas, enxergando só mensagem da Cloud. Sem gatilho de conversa, o
    // card cai em prospecção (cliente do ERP) ou ociosos (contato que o ERP não
    // alcança) — que é o desfecho pedido.
    await cfgP;   // garante a config lida antes de montar a consulta
    let cols = COLS_FULL;
    const out: any[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from(VIEW_FUNIL_TELA).select(cols)
        .order("ultima_atividade", { ascending: false, nullsFirst: false })
        .range(from, from + PAGE - 1);
      if (carteira) q = q.eq("vendedor", carteira);
      const { data, error } = await q;
      if (error) {
        if (cols === COLS_FULL && /venda_valor|venda_data|sem_cadastro|rd_cliente_id|codcli|rca_num|carteira_rd/.test(error.message)) { cols = COLS_MSGS; from -= PAGE; continue; }
        if (cols !== COLS_BASE && /ultimas_mensagens/.test(error.message)) { cols = COLS_BASE; from -= PAGE; continue; }
        throw new Error(error.message);
      }
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  };

  // pedido emitido (paginado): 1 linha por cliente por período
  // As DUAS colunas de venda vêm da mesma máquina de estados (0105):
  //    0-2 dias -> pedido_emitido · 3-18 -> vender_novamente · >18 -> sai
  // Uma linha por cliente, com a etapa já decidida no banco. Nova venda zera o
  // contador e traz o card de volta sozinho, sem estado guardado.
  const carregarPedidoCards = async (): Promise<any[]> => {
    const out: any[] = [];
    for (let from = 0; ; from += PAGE) {
      let pcQ = sb.from("vw_venda_card")
        .select("etapa,dias,vendedor_slug,codcli,cliente,cliente_id,telefone,pedidos,valor,ultima_compra,conversa_aberta")
        .range(from, from + PAGE - 1);
      pcQ = carteira ? pcQ.eq("vendedor_slug", carteira) : pcQ.in("vendedor_slug", slugs);
      const { data, error } = await pcQ;
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  };

  const carregarTemplates = async () => {
    let q = sb.from("vw_templates_diario").select("vendedor,dia,templates_enviados").gte("dia", desde);
    if (carteira) q = q.eq("vendedor", carteira);
    return (await q).data ?? [];
  };
  const carregarAuto = async () => {
    let q = sb.from("vw_templates_auto_diario").select("vendedor,dia,templates_automaticos").gte("dia", desde);
    if (carteira) q = q.eq("vendedor", carteira);
    return (await q).data ?? [];
  };
  const carregarDisparos = async () => {
    let q = sb.from("disparos_template").select("cliente_id,criada_em").order("criada_em", { ascending: false });
    if (carteira) q = q.eq("vendedor", carteira);
    return (await q).data ?? [];
  };
  // total de VENDAS = fonte oficial do ranking (vw_vendas_bi_total: data_emissao,
  // estados ativos, dedup por pedido, menos cancelados). Bate 100% com o ranking.
  const carregarTotais = async () => {
    let q = sb.from("vw_vendas_bi_total").select("vendedor_slug,periodo,clientes,vendas,total");
    q = carteira ? q.eq("vendedor_slug", carteira) : q.in("vendedor_slug", slugs);
    return (await q).data ?? [];
  };
  // ciclo de compra / oportunidades (motor preditivo espelhado da v2). ~1116 linhas.
  // Com o motor desligado no /admin, nem a consulta acontece: o mecanismo sai do
  // ar de verdade, não fica escondido pelo CSS — e a rota economiza uma consulta
  // paginada por chamada.
  const carregarCiclo = async (): Promise<any[]> => {
    if (!(await cfgP).ciclo_ativo) return [];
    const out: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from("vw_ciclo_card")
        .select("codcli,cliente_id,telefone,tipo_oportunidade,pct_ciclo,score_urgencia,ciclo_medio,dias_ausente,tendencia,acao_recomendada")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  };

  // lixeira: clientes descartados (cliente final) — somem do board por qualquer identificador
  const carregarDescartados = async (): Promise<any[]> =>
    (await sb.from("wth_descartados").select("cliente_id,codcli,tel8")).data ?? [];

  // dispara os blocos independentes de uma vez
  let cards: any[], pcRows: any[], tpls: any[], autos: any[], disp: any[], tot: any[], ciclos: any[], descRows: any[];
  try {
    [cards, pcRows, tpls, autos, disp, tot, ciclos, descRows] = await Promise.all([
      carregarCards(), carregarPedidoCards(), carregarTemplates(),
      carregarAuto(), carregarDisparos(), carregarTotais(), carregarCiclo(), carregarDescartados(),
    ]);
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
  // sets de descartados + teste por qualquer identificador (cliente_id RD, codcli, tel8)
  const descCli = new Set((descRows ?? []).map((d: any) => d.cliente_id).filter(Boolean));
  const descCod = new Set((descRows ?? []).map((d: any) => d.codcli).filter((x: any) => x != null).map(Number));
  const descTel = new Set((descRows ?? []).map((d: any) => d.tel8).filter(Boolean));
  const codDeId = (id: any): number | null => {
    if (typeof id === "string" && (id.startsWith("winthor:") || id.startsWith("venda:"))) {
      const n = Number(id.slice(id.indexOf(":") + 1)); return isNaN(n) ? null : n;
    }
    return null;
  };
  const ehDescartado = (c: any): boolean => {
    if (c.cliente_id && descCli.has(c.cliente_id)) return true;
    if (c.rd_cliente_id && descCli.has(c.rd_cliente_id)) return true;
    const cod = c.codcli ?? codDeId(c.cliente_id);
    if (cod != null && descCod.has(Number(cod))) return true;
    const t = String(c.telefone ?? "").replace(/\D/g, "").slice(-8);
    return t.length === 8 && descTel.has(t);
  };

  // mapas de ciclo por identificador (cliente_id / codcli / telefone8)
  const cicloByCli = new Map<string, any>();
  const cicloByCod = new Map<number, any>();
  const cicloByTel = new Map<string, any>();
  const tel8c = (t: any) => String(t ?? "").replace(/\D/g, "").slice(-8);
  for (const r of ciclos) {
    const info = {
      tipo: r.tipo_oportunidade, pct_ciclo: r.pct_ciclo, score: r.score_urgencia,
      ciclo_medio: r.ciclo_medio, dias_ausente: r.dias_ausente, tendencia: r.tendencia, acao: r.acao_recomendada,
    };
    if (r.codcli != null) cicloByCod.set(Number(r.codcli), info);
    if (r.cliente_id) cicloByCli.set(r.cliente_id, info);
    const t = tel8c(r.telefone);
    if (t.length === 8) cicloByTel.set(t, info);
  }
  const cicloDe = (c: any): any => {
    const id = c.cliente_id;
    if (typeof id === "string") {
      if (id.startsWith("winthor:") || id.startsWith("venda:")) {
        const cc = Number(id.slice(id.indexOf(":") + 1));
        if (cicloByCod.has(cc)) return cicloByCod.get(cc);
      } else if (cicloByCli.has(id)) return cicloByCli.get(id);
    }
    const t = tel8c(c.telefone);
    if (t.length === 8 && cicloByTel.has(t)) return cicloByTel.get(t);
    return null;
  };

  const templatesTotais: Record<string, TplTot> = {};
  for (const t of tpls) bucket(templatesTotais, t.vendedor, t.dia, t.templates_enviados ?? 0);

  const templatesAutoTotais: Record<string, TplTot> = {};
  for (const t of autos) bucket(templatesAutoTotais, t.vendedor, t.dia, t.templates_automaticos ?? 0);

  // clientes que já receberam disparo de template (último por cliente) — p/ marcar "aguardando resposta"
  const disparos: Record<string, string> = {};
  for (const d of disp) {
    if (d.cliente_id && !disparos[d.cliente_id]) disparos[d.cliente_id] = d.criada_em;
  }

  // mapas por cliente_id e por TELEFONE (últimos 8) da vw_funil — pra religar a venda ao
  // contato quando o vínculo por CPF falha (contato sem CPF), e enriquecer o card.
  const funilByCliente: Record<string, any> = {};
  const funilByTel: Record<string, any> = {};
  const tel8 = (t: any) => String(t ?? "").replace(/\D/g, "").slice(-8);
  const ehReal = (id: any) => typeof id === "string" && !id.startsWith("winthor:") && !id.startsWith("venda:");
  for (const c of cards) {
    if (c.cliente_id) funilByCliente[c.cliente_id] = c;
    const t = tel8(c.telefone);
    if (t.length === 8 && ehReal(c.cliente_id)) funilByTel[t] = c; // só contato real de conversa
  }

  // telefone do WinThor por codcli das vendas (o card view vem sem telefone p/ não-vinculado)
  const saleCodclis = [...new Set(pcRows.map((r: any) => Number(r.codcli)).filter((x) => !isNaN(x)))];
  const telByCodcli: Record<number, string> = {};
  const lotes: number[][] = [];
  for (let i = 0; i < saleCodclis.length; i += 300) lotes.push(saleCodclis.slice(i, i + 300));
  const wcResults = await Promise.all(
    lotes.map((lote) => sb.from("wth_carteira").select("codcli,telefone").in("codcli", lote).then((r) => r.data ?? []))
  );
  for (const wc of wcResults) for (const w of wc) telByCodcli[Number(w.codcli)] = w.telefone;
  // cliente_id efetivo de uma linha de venda: vínculo CPF, senão contato com mesmo telefone
  const effCliId = (r: any): string | null =>
    r.cliente_id ?? (funilByTel[tel8(telByCodcli[Number(r.codcli)])]?.cliente_id ?? null);

  // === valor do MÊS por cliente (fonte bi/ranking) — pro selo no card e no card de pedido.
  // O `valor` de cada linha do vw_pedido_bi_card é o total do mês do cliente (igual em
  // qualquer período). Indexa por cliente_id / codcli / telefone8.
  const valMesCli = new Map<string, number>();
  const valMesCod = new Map<number, number>();
  const valMesTel = new Map<string, number>();
  for (const r of pcRows ?? []) {
    const v = +(r.valor ?? 0);
    if (r.cliente_id) valMesCli.set(r.cliente_id, v);
    if (r.codcli != null) valMesCod.set(Number(r.codcli), v);
    const t = tel8(r.telefone ?? telByCodcli[Number(r.codcli)]);
    if (t.length === 8) valMesTel.set(t, v);
  }
  const valorMesDe = (c: any): number | null => {
    const id = c.cliente_id;
    if (typeof id === "string") {
      if (id.startsWith("winthor:") || id.startsWith("venda:")) {
        const cc = Number(id.slice(id.indexOf(":") + 1));
        if (valMesCod.has(cc)) return valMesCod.get(cc)!;
      } else if (valMesCli.has(id)) return valMesCli.get(id)!;
    }
    const t = tel8(c.telefone);
    if (t.length === 8 && valMesTel.has(t)) return valMesTel.get(t)!;
    return null;
  };

  // Compradores do MÊS (fonte bi/pedido): quem comprou no mês vira UM card só, na coluna
  // Pedido emitido — some das colunas de conversa/prospecção pra não duplicar. É isto que
  // "junta" o lead de marketing (conversa solta no RD) ao cadastro oficial do WinThor
  // quando ele compra: casa por cliente_id, codcli OU telefone (8 dígitos). Mantemos `cards`
  // inteiro (o enriquecimento do card de pedido depende dele); só filtramos o que é exibido.
  const compradoresMes = new Set<string>();
  for (const r of pcRows ?? []) {
    // Quem está numa das duas colunas de venda sai das demais — MENOS quem tem
    // conversa aberta: a cliente que está respondendo AGORA fica em Negociação,
    // porque reabordar quem já está falando com você é ruído (0105).
    if (r.conversa_aberta) continue;
    const cid = r.cliente_id ?? effCliId(r);
    if (cid) compradoresMes.add("cli:" + cid);
    if (r.codcli != null) compradoresMes.add("cod:" + Number(r.codcli));
    const t = tel8(r.telefone ?? telByCodcli[Number(r.codcli)]);
    if (t.length === 8) compradoresMes.add("tel:" + t);
  }
  const ehCompradorMes = (c: any): boolean => {
    const id = c.cliente_id;
    if (typeof id === "string") {
      if (id.startsWith("winthor:") || id.startsWith("venda:")) {
        if (compradoresMes.has("cod:" + Number(id.slice(id.indexOf(":") + 1)))) return true;
      } else if (compradoresMes.has("cli:" + id)) return true;
    }
    const t = tel8(c.telefone);
    return t.length === 8 && compradoresMes.has("tel:" + t);
  };

  // Cards do FUNIL = conversas (vw_funil, dono = RCA atual, etapa pela conversa) + prospecção,
  // SEM a etapa pedido_emitido e SEM quem comprou no mês (esses ficam só em Pedido emitido).
  // Pedido emitido é coluna SEPARADA, das VENDAS (bi/ranking), não das conversas.
  const cardsOutros = cards.filter((c: any) => c.etapa !== "pedido_emitido" && !ehCompradorMes(c) && !ehDescartado(c));
  for (const c of cardsOutros) {
    const v = valorMesDe(c);
    c.venda_valor = v && v > 0 ? v : null; // aqui não há comprador do mês; selo verde não aparece
    c.ciclo = cicloDe(c);
  }

  // As duas colunas de venda (0105). A `etapa` vem do banco; o card guarda
  // `dias` para a tela dizer "há 4 dias" sem recalcular. Enriquece com a
  // conversa, se houver, para o clique e a prévia.
  //
  // `conversa_aberta` é filtrada aqui: a cliente que respondeu nas últimas 24h
  // fica na coluna da CONVERSA, não numa de venda — e por isso ela também não
  // foi removida das demais colunas lá em cima.
  const pedidoCards = (pcRows ?? []).filter((r: any) => !r.conversa_aberta).map((r: any) => {
    const cid = r.cliente_id ?? effCliId(r);
    const key = cid ?? `venda:${r.codcli}`;
    const f = cid ? funilByCliente[cid] : null;
    return {
      cliente_id: key,
      cliente: r.cliente,
      vendedor: r.vendedor_slug,
      etapa: r.etapa,             // "pedido_emitido" | "vender_novamente"
      codcli: r.codcli ?? null,
      dias_da_compra: r.dias,
      pedidos: r.pedidos,
      // soma das compras da janela de 18 dias — NÃO do mês vigente, que zeraria
      // no dia 1º e mostraria R$ 0 num card que está ali por causa de uma compra
      venda_valor: r.valor,
      venda_data: r.ultima_compra,
      telefone: r.telefone ?? f?.telefone ?? null,
      ultima_atividade: f?.ultima_atividade ?? null,
      ultima_mensagem: f?.ultima_mensagem ?? null,
      ultima_enviada_por: f?.ultima_enviada_por ?? null,
      ultimas_mensagens: f?.ultimas_mensagens ?? null,
      ciclo: cicloDe({ cliente_id: key, telefone: r.telefone ?? f?.telefone ?? null }),
    };
  }).filter((pc: any) => !ehDescartado(pc));

  // totais do cabeçalho por carteira e período (bruto, "quem lançou") — já carregado acima
  const vendasTotais: Record<string, Record<string, { total: number; vendas: number }>> = {};
  for (const t of tot) {
    (vendasTotais[t.vendedor_slug] = vendasTotais[t.vendedor_slug] ?? {})[t.periodo] = {
      total: +(t.total ?? 0), vendas: +(t.vendas ?? 0),
    };
  }

  const cfg = await cfgP;

  return Response.json({
    ciclo_ativo: cfg.ciclo_ativo,   // o front esconde selo e filtro quando false
    linhas_visiveis: cfg.linhas_visiveis,
    linhas: cfg.linhas,
    tudo_visivel: tudoVisivel(cfg),
    cards: cardsOutros,
    pedidoCards,
    templatesTotais,
    templatesAutoTotais,
    disparos,
    vendasTotais,
    vendedores,
    dia: hojeBRT,
    atualizado_em: new Date().toISOString(),
  });
}
