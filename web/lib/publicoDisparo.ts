import { lerCrmConfig, linhasVisiveis, canalEscolhido, filtroLinhas, VIEW_FUNIL_TELA } from "./crmConfig";
import { codigoMeta, FALHA_DO_NUMERO } from "./erroMeta";

// ---------------------------------------------------------------------------
// O motor do público do disparo em massa.
//
// Vivia dentro do POST de /api/admin/disparo-massa. Saiu de lá porque passou a
// ter DOIS chamadores: a tela (que monta o público por campos) e o chat do
// Claude (que monta o mesmo público conversando). Se cada um tivesse a sua
// peneira, o número que o Claude promete na conversa e o que a tela mostra na
// prévia divergiriam -- e a divergência só apareceria depois do envio.
//
// Regra de ouro deste arquivo: ele NÃO envia nada. Só responde "quem seria
// atingido, e quem ficou de fora por quê".
//
// ---------------------------------------------------------------------------
// SEGMENTAÇÃO (0118): as 11 famílias do documento
//
// `variaveis-segmentacao-listas-template.md` lista o que a supervisão pede na
// prática. Quase tudo já estava espelhado em `wth_*` pelo `wth-sync-tudo`; o que
// faltava era um jeito barato de perguntar. As views `vw_cliente_item` e
// `vw_cliente_financeiro` (0118) resolvem isso, e os filtros abaixo as usam.
//
// ⚠️ TODO recorte que depende do ERP corta quem NÃO TEM `codcli`, e esse corte
// aparece nomeado (`sem_dados_do_erp`). Sumir com essa gente em silêncio seria a
// mesma doença que a tela de Pendências existe para curar (§36.1).
// ---------------------------------------------------------------------------

const PAGE = 1000;
const COLS = "cliente_id,cliente,vendedor,etapa,ultima_atividade,telefone,venda_valor,rd_cliente_id,codcli";

/** Teto de um disparo. 1000 × 1,8s de espaço entre envios ≈ 30 min de aba aberta. */
export const LIMITE_MAX = 1000;

/** Buckets de compra que a `vw_pedido_bi_card` já calcula — não invente outros. */
export const PERIODOS_COMPRA = ["hoje", "ontem", "semana", "quinzena", "mes"] as const;
export type PeriodoCompra = (typeof PERIODOS_COMPRA)[number];

export const DIMENSOES_ITEM = ["secao", "departamento", "marca", "produto"] as const;
export type DimensaoItem = (typeof DIMENSOES_ITEM)[number];

/** Um recorte por aquilo que o cliente compra. `dias` = 0 quando não se aplica. */
export type RecorteItem = { dimensao: DimensaoItem; valores: string[]; dias: number };

export type FiltrosPublico = {
  /** slugs de carteira (`kamilly`, `milene`…). Vazio = a equipe toda. */
  carteiras: string[];
  /** times de `carteira_config` (IS / ISR / GC). Vira carteira antes da peneira. */
  times: string[];
  etapas: string[];
  /** parado há pelo menos N dias (sem atividade nenhuma na conversa) */
  diasMin: number;
  /** não recebeu template nos últimos N dias. 1 = "não recebeu hoje". */
  diasRecontato: number;
  /** corta quem comprou no período — o "que não compraram nesse mês" */
  semCompraNo: PeriodoCompra | null;
  /** corta quem está em conversa aberta agora */
  semConversaAberta: boolean;
  /** cota por carteira — o "200 de cada vendedor". 0 = sem cota. */
  porVendedor: number;
  /** teto total do disparo */
  limite: number;
  /** canal do template escolhido, para não oferecer quem ele não alcança */
  canal: "cloud" | "rd" | null;

  // --- localização (§2 do documento) ---------------------------------------
  cidades: string[];
  estados: string[];
  bairros: string[];
  /** prefixos de CEP, para roteirização ("660", "66093") */
  cepPrefixos: string[];

  // --- produto (§4) ---------------------------------------------------------
  /** comprou isto (em qualquer momento, ou nos últimos `dias`) */
  comprou: RecorteItem | null;
  /** NUNCA comprou isto */
  naoComprou: RecorteItem | null;
  /** comprou isto, mas não compra há `dias` */
  semComprarItemHa: RecorteItem | null;

  // --- financeiro (§5) e frequência (§6) ------------------------------------
  ticketMin: number;
  ticketMax: number;
  receitaMin: number;
  ultimoPedidoMin: number;
  pedidosMin: number;
  pedidosMax: number;

  // --- recência (§3) e devolução (§9) ---------------------------------------
  semComprarDiasMin: number;
  semComprarDiasMax: number;
  /** nunca comprou nada — não existe no faturamento */
  nuncaComprou: boolean;
  /** primeira compra nos últimos N dias (cliente novo) */
  primeiraCompraUltimosDias: number;
  comDevolucaoUltimosDias: number;
  semDevolucao: boolean;

  // --- cadastro (§10) e preditivo (§7) --------------------------------------
  ramos: string[];
  tiposOportunidade: string[];
  tendencias: string[];
  scoreMin: number;

  /** id de um conjunto de codcli produzido pela consulta livre (0119) */
  conjunto: string;
};

export const FILTROS_PADRAO: FiltrosPublico = {
  carteiras: [], times: [], etapas: ["ociosos", "tentativa_contato"],
  diasMin: 0, diasRecontato: 4, semCompraNo: null, semConversaAberta: false,
  porVendedor: 0, limite: 20, canal: null,
  cidades: [], estados: [], bairros: [], cepPrefixos: [],
  comprou: null, naoComprou: null, semComprarItemHa: null,
  ticketMin: 0, ticketMax: 0, receitaMin: 0, ultimoPedidoMin: 0,
  pedidosMin: 0, pedidosMax: 0,
  semComprarDiasMin: 0, semComprarDiasMax: 0, nuncaComprou: false,
  primeiraCompraUltimosDias: 0, comDevolucaoUltimosDias: 0, semDevolucao: false,
  ramos: [], tiposOportunidade: [], tendencias: [], scoreMin: 0,
  conjunto: "",
};

const lista = (v: any) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : []);
const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const naoNeg = (v: any, d = 0) => Math.max(0, num(v, d));

function lerRecorte(v: any): RecorteItem | null {
  if (!v || typeof v !== "object") return null;
  const dim = String(v.dimensao ?? "");
  const valores = lista(v.valores);
  if (!(DIMENSOES_ITEM as readonly string[]).includes(dim) || !valores.length) return null;
  return { dimensao: dim as DimensaoItem, valores, dias: naoNeg(v.dias) };
}

/** Aceita o que vier da rede (tela ou Claude) e devolve filtros válidos. */
export function lerFiltros(f: any): FiltrosPublico {
  const per = String(f?.semCompraNo ?? "");
  return {
    carteiras: lista(f?.carteiras),
    times: lista(f?.times).map((t) => t.toUpperCase()),
    etapas: lista(f?.etapas),
    diasMin: Math.min(365, naoNeg(f?.diasMin)),
    diasRecontato: Math.min(60, naoNeg(f?.diasRecontato, 4)),
    semCompraNo: (PERIODOS_COMPRA as readonly string[]).includes(per) ? (per as PeriodoCompra) : null,
    semConversaAberta: !!f?.semConversaAberta,
    porVendedor: Math.min(LIMITE_MAX, naoNeg(f?.porVendedor)),
    limite: Math.min(LIMITE_MAX, Math.max(1, num(f?.limite, 20))),
    canal: f?.canal === "cloud" || f?.canal === "rd" ? f.canal : null,

    cidades: lista(f?.cidades),
    estados: lista(f?.estados).map((e) => e.toUpperCase()),
    bairros: lista(f?.bairros),
    cepPrefixos: lista(f?.cepPrefixos).map((c) => c.replace(/\D/g, "")).filter(Boolean),

    comprou: lerRecorte(f?.comprou),
    naoComprou: lerRecorte(f?.naoComprou),
    semComprarItemHa: lerRecorte(f?.semComprarItemHa),

    ticketMin: naoNeg(f?.ticketMin), ticketMax: naoNeg(f?.ticketMax),
    receitaMin: naoNeg(f?.receitaMin), ultimoPedidoMin: naoNeg(f?.ultimoPedidoMin),
    pedidosMin: naoNeg(f?.pedidosMin), pedidosMax: naoNeg(f?.pedidosMax),

    semComprarDiasMin: naoNeg(f?.semComprarDiasMin), semComprarDiasMax: naoNeg(f?.semComprarDiasMax),
    nuncaComprou: !!f?.nuncaComprou,
    primeiraCompraUltimosDias: naoNeg(f?.primeiraCompraUltimosDias),
    comDevolucaoUltimosDias: naoNeg(f?.comDevolucaoUltimosDias),
    semDevolucao: !!f?.semDevolucao,

    ramos: lista(f?.ramos).map((r) => r.toUpperCase()),
    tiposOportunidade: lista(f?.tiposOportunidade).map((t) => t.toUpperCase()),
    tendencias: lista(f?.tendencias).map((t) => t.toUpperCase()),
    scoreMin: naoNeg(f?.scoreMin),

    // ⚠️ so aceita id no formato que NOS geramos. Sem isto, qualquer string que
    // o modelo produza (ja veio um "</antml>") vira consulta ao banco.
    conjunto: /^c[a-z0-9]{6,40}$/.test(String(f?.conjunto ?? "").trim())
      ? String(f.conjunto).trim() : "",
  };
}

export type Alvo = {
  envio_id: string; cliente_id: string; cliente: string; primeiro_nome: string;
  vendedor: string | null; etapa: string | null; dias: number | null;
  canal: "whatsapp" | "rd"; ciclo: string | null; score: number;
};

export type Publico = {
  ciclo_ativo: boolean;
  total: number;
  selecionados: Alvo[];
  cortes: Record<string, number>;
  porCanal: { whatsapp: number; rd: number };
  /** quantos de cada carteira entraram na seleção — o que a cota produziu */
  porVendedor: Record<string, number>;
  /** carteiras efetivamente consideradas depois de expandir os times */
  carteirasUsadas: string[];
  /** o que o motor precisou dizer sobre o próprio resultado */
  avisos: string[];
};

/** Dias desde uma data ISO. Sem data = nunca teve atividade. */
const diasDesde = (iso: string | null | undefined): number => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return isNaN(t) ? Infinity : (Date.now() - t) / 86_400_000;
};

const tel8 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-8);

/** Data ISO (só o dia) de N dias atrás, em BRT — o mesmo fuso das views. */
const diaAtras = (n: number) =>
  new Date(Date.now() - 3 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);

/**
 * O id que o /api/send-template entende. A linha do funil pode ser um card
 * sintético (`winthor:<codcli>`, da fila de prospecção) que não existe em
 * `clientes` — esse contato só é alcançável se já tiver par no RD.
 */
function idDeEnvio(c: any): string | null {
  if (c.rd_cliente_id) return String(c.rd_cliente_id);
  const id = c.cliente_id;
  if (typeof id !== "string") return null;
  // ⚠️ NÃO é "sem dois-pontos". Era, e por isso TODO contato do nosso próprio
  // número (`wa:<telefone>`, §16.3) ficava fora do disparo em massa -- contado
  // como "sem contato", que é o rótulo de quem não dá para alcançar. Eles dão:
  // `/api/send-template` roteia `wa:` para a Cloud sem hesitar.
  return /^(winthor|venda):/.test(id) ? null : id;
}

const codDeId = (id: any): number | null => {
  if (typeof id === "string" && (id.startsWith("winthor:") || id.startsWith("venda:"))) {
    const n = Number(id.slice(id.indexOf(":") + 1));
    return isNaN(n) ? null : n;
  }
  return null;
};

/** Expande `times` em carteiras e junta com as escolhidas a dedo. */
export async function carteirasDosTimes(db: any, f: FiltrosPublico): Promise<string[]> {
  if (!f.times.length) return f.carteiras;
  const { data } = await db.from("carteira_config").select('slug,"time"').eq("ativo", true);
  const doTime = (data ?? [])
    .filter((c: any) => f.times.includes(String(c.time ?? "").toUpperCase()))
    .map((c: any) => String(c.slug));
  return [...new Set([...f.carteiras, ...doTime])];
}

/**
 * Junta os `codcli` de uma consulta paginada. O PostgREST corta em 1000 e
 * algumas destas consultas passam disso (a `vw_cliente_item` tem 205 mil
 * linhas) — parar na primeira página deixaria gente de fora sem avisar, que é
 * o mesmo erro do `limit` cego que escondeu o corte de número morto (§61.2).
 */
async function coletarCod(fazer: (de: number, ate: number) => any): Promise<Set<number>> {
  const s = new Set<number>();
  for (let de = 0; ; de += PAGE) {
    const { data, error } = await fazer(de, de + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const n = Number((r as any).codcli);
      if (!isNaN(n)) s.add(n);
    }
    if (!data || data.length < PAGE) break;
  }
  return s;
}

/**
 * Memória de UM turno do assistente.
 *
 * O modelo chama `montarPublico` várias vezes no mesmo turno — ele explora,
 * compara e refaz. Sem isto, cada chamada repetia a varredura da `vw_funil`
 * (5,6 s medidos) e todas as consultas de contexto: um turno chegou a **85 s**,
 * contra o `maxDuration` de 60 da Vercel. Com o cache, só a primeira paga.
 *
 * O cache vive na requisição e morre com ela — nada aqui é compartilhado entre
 * usuários nem entre turnos, porque o público tem de refletir o banco de AGORA.
 */
export type CachePublico = {
  cards?: any[];
  ctx?: any;
  compras?: Map<string, { cod: Set<number>; cli: Set<string> }>;
  sets?: Map<string, Set<number> | null>;
};

/** Interseção que trata `null` como "sem restrição". */
function cruzar(a: Set<number> | null, b: Set<number> | null): Set<number> | null {
  if (!a) return b;
  if (!b) return a;
  const menor = a.size <= b.size ? a : b;
  const maior = menor === a ? b : a;
  const r = new Set<number>();
  for (const x of menor) if (maior.has(x)) r.add(x);
  return r;
}

/** O conjunto de codcli que compraram (ou não) determinada dimensão. */
function consultaItem(db: any, r: RecorteItem, modo: "comprou" | "sem_comprar_ha") {
  return (de: number, ate: number) => {
    let q = db.from("vw_cliente_item").select("codcli")
      .eq("dimensao", r.dimensao).in("valor", r.valores)
      .order("codcli", { ascending: true }).range(de, ate);
    if (modo === "comprou" && r.dias > 0) q = q.gte("ultima_compra", diaAtras(r.dias));
    if (modo === "sem_comprar_ha") q = q.lt("ultima_compra", diaAtras(Math.max(1, r.dias)));
    return q;
  };
}

export async function montarPublico(db: any, f: FiltrosPublico, cache: CachePublico = {}): Promise<Publico> {
  const carteiras = await carteirasDosTimes(db, f);
  const avisos: string[] = [];

  // 1) cards do funil. Busca a view INTEIRA uma vez e filtra carteira/etapa em
  //    memória: o assistente refaz o público várias vezes no mesmo turno, e
  //    repetir a varredura a cada tentativa foi o que estourou o tempo.
  if (!cache.cards) {
    const todos: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(VIEW_FUNIL_TELA).select(COLS)
        .order("ultima_atividade", { ascending: false, nullsFirst: false })
        // ⚠️ MESMO DESEMPATE DO /api/funil, e aqui o preço é maior: sem ele a
        // paginação perde e duplica linhas (medido: 30 clientes fora, 22 em
        // dobro), e este laço monta o PÚBLICO DA CAMPANHA. Perder alguém aqui é
        // não abordar quem devia; duplicar é ranquear a mesma pessoa duas vezes.
        .order("cliente_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      todos.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    cache.cards = todos;
  }
  const setCarteiras = carteiras.length ? new Set(carteiras) : null;
  const setEtapas = f.etapas.length ? new Set(f.etapas) : null;
  const cards = cache.cards.filter((c: any) =>
    (!setCarteiras || setCarteiras.has(String(c.vendedor)))
    && (!setEtapas || setEtapas.has(String(c.etapa))));

  // 2) contexto: último disparo, lixeira, ciclo de compra, canal, compras e
  //    conversa aberta. Nenhum depende do outro, então vão em paralelo.
  // ⚠️ A janela do anti-repetição é do FILTRO (pode ser 1 dia), mas o cache
  // guarda sempre os 60 dias — o máximo aceito — e a comparação por dia é feita
  // em memória. Cachear a janela pedida faria a segunda chamada do turno usar a
  // janela da primeira, e o número mudaria sem ninguém entender por quê.
  const desdeDisparo = new Date(Date.now() - 60 * 86_400_000).toISOString();
  // ⚠️ A memória de FALHA tem janela própria, e não a do anti-repetição.
  // Um número que não recebe no WhatsApp continua não recebendo amanhã — com a
  // janela do anti-repetição (que pode ser 1 dia), esqueceríamos uma falha de
  // anteontem e queimaríamos outro template no mesmo número morto.
  //
  // 90 dias, e não "sempre", porque a pessoa pode ter instalado o WhatsApp
  // nesse meio tempo: condenar um número para sempre pelo pior dia dele seria
  // o erro simétrico.
  const desdeFalha = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const cfg = await lerCrmConfig(db);
  const soCloudP = !linhasVisiveis(cfg).includes("rd");

  if (!cache.ctx) cache.ctx = await (async () => {
  const [dispRes, descRes, cicloRes, linhaRes, desfRes, abertaRes, statusRes] = await Promise.all([
    (() => {
      // anti-repetição: só conta template que saiu pelo número em uso
      const q = db.from("disparos_template").select("cliente_id,criada_em").gte("criada_em", desdeDisparo);
      return soCloudP ? q.like("id", "wamid.%") : q;
    })(),
    db.from("wth_descartados").select("cliente_id,codcli,tel8"),
    // motor desligado (crm_config, 0097): a consulta nem sai e o ranqueamento
    // passa a ser só tempo parado + ticket — ver o cálculo de `score` abaixo
    // sempre buscado (o cache é do turno inteiro); quem decide se vale é o
    // `cfg.ciclo_ativo` no cálculo do score, mais abaixo
    db.from("vw_ciclo_card").select("cliente_id,codcli,telefone,score_urgencia,tipo_oportunidade"),
    db.from("vw_chat_linha_cliente").select("cliente_id"),
    // Só as FALHAS. Medido em 27/08: 32 linhas em 90 dias.
    db.from("mensagens")
      .select("cliente_id,erro,criada_em")
      .eq("enviada_por", "operator").eq("status", "failed")
      .gte("criada_em", desdeFalha)
      .order("criada_em", { ascending: true }).limit(2000),
    // conversa aberta = a cliente falou nas últimas 24h. ⚠️ Passa por
    // `filtroLinhas`: com o RD escondido, conversa que só existe lá não conta
    // (§44) — senão o corte esconderia gente que, para o resto do sistema, não
    // está falando com ninguém. Sempre buscado: são poucas dezenas de linhas, e
    // condicionar ao filtro tornaria o cache dependente dele.
    filtroLinhas(
      db.from("mensagens").select("cliente_id")
        .eq("enviada_por", "customer")
        .gte("criada_em", new Date(Date.now() - 24 * 3600_000).toISOString())
        .limit(5000),
      cfg,
    ),
    db.from("chat_conversa").select("cliente_id").eq("status", "aberta"),
  ]);

  // ---- NÚMERO QUE NÃO RECEBE (item 5) ------------------------------------
  // ⚠️ DUAS distinções, e sem elas o corte sabotaria o próprio disparo:
  //   1. Nem toda falha é do número — 131047 (janela fechada) é EXATAMENTE quem
  //      o template existe para alcançar; 131042 é problema de pagamento NOSSO.
  //   2. Vale o ÚLTIMO desfecho, não "já falhou alguma vez": quem falhou em
  //      junho e recebeu em agosto instalou o WhatsApp nesse meio tempo.
  const falhaEm = new Map<string, string>();
  for (const m of desfRes.data ?? []) {          // já vem em ordem crescente
    const id = String((m as any).cliente_id ?? "");
    if (!id) continue;
    const cod = codigoMeta((m as any).erro);
    if (cod && FALHA_DO_NUMERO.has(cod)) falhaEm.set(id, String((m as any).criada_em));
    else falhaEm.delete(id);   // falha de outro tipo depois: não é o número
  }
  const morto = new Set(falhaEm.keys());
  if (morto.size) {
    const ids = [...morto].slice(0, 300);        // teto de tamanho de URL
    const { data: vivos } = await db.from("mensagens")
      .select("cliente_id,criada_em")
      .eq("enviada_por", "operator").in("status", ["success", "read"])
      .in("cliente_id", ids).gte("criada_em", desdeFalha).limit(3000);
    for (const v of vivos ?? []) {
      const id = String((v as any).cliente_id ?? "");
      if (String((v as any).criada_em) > (falhaEm.get(id) ?? "")) morto.delete(id);
    }
  }
  return { dispRes, descRes, cicloRes, linhaRes, morto, abertaRes, statusRes };
  })();
  const { dispRes, descRes, cicloRes, linhaRes, morto, abertaRes, statusRes } = cache.ctx;

  // Montado FORA do cache, a partir da lista de 60 dias que ele guarda: o corte
  // usa a janela do filtro, comparada dia a dia mais abaixo.
  const ultimoDisparo = new Map<string, string>();
  for (const d of dispRes.data ?? []) {
    const id = String(d.cliente_id ?? "");
    const atual = ultimoDisparo.get(id);
    if (!atual || String(d.criada_em) > atual) ultimoDisparo.set(id, String(d.criada_em));
  }

  const descCli = new Set((descRes.data ?? []).map((d: any) => d.cliente_id).filter(Boolean));
  const descCod = new Set((descRes.data ?? []).map((d: any) => d.codcli).filter((x: any) => x != null).map(Number));
  const descTel = new Set((descRes.data ?? []).map((d: any) => d.tel8).filter(Boolean));

  // "não compraram no período": os buckets já vêm prontos da view da nota
  // fiscal, e são o MESMO número que a coluna Pedido emitido do board usa.
  cache.compras ??= new Map();
  if (f.semCompraNo && !cache.compras.has(f.semCompraNo)) {
    const { data } = await db.from("vw_pedido_bi_card").select("codcli,cliente_id").eq("periodo", f.semCompraNo);
    cache.compras.set(f.semCompraNo, {
      cod: new Set((data ?? []).map((r: any) => Number(r.codcli)).filter((n: number) => !isNaN(n))),
      cli: new Set((data ?? []).map((r: any) => r.cliente_id).filter(Boolean).map(String)),
    });
  }
  const comprouCod = f.semCompraNo ? cache.compras.get(f.semCompraNo)!.cod : new Set<number>();
  const comprouCli = f.semCompraNo ? cache.compras.get(f.semCompraNo)!.cli : new Set<string>();

  const emConversa = f.semConversaAberta
    ? new Set<string>([
        ...(abertaRes.data ?? []).map((r: any) => String(r.cliente_id)),
        ...(statusRes.data ?? []).map((r: any) => String(r.cliente_id)),
      ])
    : new Set<string>();

  const cicloCli = new Map<string, any>(), cicloCod = new Map<number, any>(), cicloTel = new Map<string, any>();
  for (const r of (cfg.ciclo_ativo ? cicloRes.data ?? [] : [])) {
    if (r.cliente_id) cicloCli.set(String(r.cliente_id), r);
    if (r.codcli != null) cicloCod.set(Number(r.codcli), r);
    const t = tel8(r.telefone);
    if (t.length === 8) cicloTel.set(t, r);
  }

  // ---------------------------------------------------------------------
  // 2.5) RECORTES DO ERP (0118). Cada família vira um conjunto de codcli, e
  //      cada uma tem corte com nome próprio -- "por que só 12?" é pergunta
  //      que ninguém resolve olhando um número sem motivo.
  // ---------------------------------------------------------------------
  const querLocal = !!(f.cidades.length || f.estados.length || f.bairros.length || f.cepPrefixos.length);
  const querFinanceiro = !!(f.ticketMin || f.ticketMax || f.receitaMin || f.ultimoPedidoMin || f.pedidosMin || f.pedidosMax);
  const querRecencia = !!(f.semComprarDiasMin || f.semComprarDiasMax || f.primeiraCompraUltimosDias
    || f.comDevolucaoUltimosDias || f.semDevolucao);
  const querRamo = !!f.ramos.length;
  const querPreditivo = !!(f.tiposOportunidade.length || f.tendencias.length || f.scoreMin);

  if (querPreditivo && !cfg.ciclo_ativo) {
    avisos.push(
      "O motor de ciclo de compra está desligado em Mecanismos, então os filtros de oportunidade, "
      + "tendência e score foram ignorados.",
    );
  }
  if (querRamo) {
    avisos.push("O ramo do cliente só existe para parte da base (a tabela do ciclo), então este filtro estreita bastante.");
  }

  // Cada recorte do ERP é caro e se repete entre as tentativas do mesmo turno
  // (trocar o limite não muda quem mora no bairro X). A chave é o próprio
  // recorte, então tentativas diferentes reaproveitam o que já foi buscado.
  cache.sets ??= new Map();
  const memo = async (chave: string, faz: () => Promise<Set<number> | null>) => {
    if (!cache.sets!.has(chave)) cache.sets!.set(chave, await faz());
    return cache.sets!.get(chave)!;
  };

  const [
    setCidade, setBairro, setCep, setComprou, setNaoComprou, setSemItem,
    setFinanceiro, setRecencia, setRamo, setPreditivo, setConjunto, todosQueCompraram,
  ] = await Promise.all([
    f.cidades.length || f.estados.length
      ? coletarCod((de, ate) => {
          let q = db.from("wth_carteira").select("codcli").order("codcli", { ascending: true }).range(de, ate);
          if (f.cidades.length) q = q.in("cidade", f.cidades);
          if (f.estados.length) q = q.in("estado", f.estados);
          return q;
        })
      : Promise.resolve(null),
    f.bairros.length
      ? coletarCod((de, ate) => db.from("wth_endereco").select("codcli").in("bairro", f.bairros)
          .order("codcli", { ascending: true }).range(de, ate))
      : Promise.resolve(null),
    f.cepPrefixos.length
      ? coletarCod((de, ate) => db.from("wth_endereco").select("codcli")
          .or(f.cepPrefixos.map((p) => `cep.like.${p}%`).join(","))
          .order("codcli", { ascending: true }).range(de, ate))
      : Promise.resolve(null),
    f.comprou ? coletarCod(consultaItem(db, f.comprou, "comprou")) : Promise.resolve(null),
    f.naoComprou ? coletarCod(consultaItem(db, f.naoComprou, "comprou")) : Promise.resolve(null),
    f.semComprarItemHa ? coletarCod(consultaItem(db, f.semComprarItemHa, "sem_comprar_ha")) : Promise.resolve(null),
    querFinanceiro
      ? coletarCod((de, ate) => {
          let q = db.from("vw_cliente_financeiro").select("codcli").order("codcli", { ascending: true }).range(de, ate);
          if (f.ticketMin) q = q.gte("ticket_medio", f.ticketMin);
          if (f.ticketMax) q = q.lte("ticket_medio", f.ticketMax);
          if (f.receitaMin) q = q.gte("receita_liquida", f.receitaMin);
          if (f.ultimoPedidoMin) q = q.gte("valor_ultimo_pedido", f.ultimoPedidoMin);
          if (f.pedidosMin) q = q.gte("pedidos", f.pedidosMin);
          if (f.pedidosMax) q = q.lte("pedidos", f.pedidosMax);
          return q;
        })
      : Promise.resolve(null),
    querRecencia
      ? coletarCod((de, ate) => {
          let q = db.from("vw_cliente_financeiro").select("codcli").order("codcli", { ascending: true }).range(de, ate);
          if (f.semComprarDiasMin) q = q.gte("dias_sem_comprar", f.semComprarDiasMin);
          if (f.semComprarDiasMax) q = q.lte("dias_sem_comprar", f.semComprarDiasMax);
          if (f.primeiraCompraUltimosDias) q = q.gte("primeira_compra", diaAtras(f.primeiraCompraUltimosDias));
          if (f.comDevolucaoUltimosDias) q = q.gte("ultima_devolucao", diaAtras(f.comDevolucaoUltimosDias));
          if (f.semDevolucao) q = q.is("ultima_devolucao", null);
          return q;
        })
      : Promise.resolve(null),
    querRamo
      ? coletarCod((de, ate) => db.from("wth_ciclo").select("codcli").in("ramo", f.ramos)
          .order("codcli", { ascending: true }).range(de, ate))
      : Promise.resolve(null),
    querPreditivo && cfg.ciclo_ativo
      ? coletarCod((de, ate) => {
          let q = db.from("wth_ciclo").select("codcli").order("codcli", { ascending: true }).range(de, ate);
          if (f.tiposOportunidade.length) q = q.in("tipo_oportunidade", f.tiposOportunidade);
          if (f.tendencias.length) q = q.in("tendencia", f.tendencias);
          if (f.scoreMin) q = q.gte("score_urgencia", f.scoreMin);
          return q;
        })
      : Promise.resolve(null),
    f.conjunto
      ? db.from("crm_conjunto").select("codclis").eq("id", f.conjunto).maybeSingle()
          .then((r: any) => {
            const arr: number[] = r?.data?.codclis ?? [];
            if (!r?.data) { avisos.push(`O conjunto "${f.conjunto}" não foi encontrado — o filtro dele foi ignorado.`); return null; }
            return new Set(arr.map(Number));
          })
      : Promise.resolve(null),
    // `nuncaComprou` é o complemento: quem NÃO aparece no faturamento.
    f.nuncaComprou
      ? coletarCod((de, ate) => db.from("vw_cliente_financeiro").select("codcli")
          .order("codcli", { ascending: true }).range(de, ate))
      : Promise.resolve(null),
  ]);

  const setLocal = cruzar(cruzar(setCidade, setBairro), setCep);
  const precisaErp = !!(setLocal || setComprou || setNaoComprou || setSemItem || setFinanceiro
    || setRecencia || setRamo || setPreditivo || setConjunto || todosQueCompraram);

  // Canal do contato. ⚠️ `numero_envio` (§37.1) tem precedência sobre a regra
  // por conversa: com o admin escolhendo Cloud, todo mundo sai pela Cloud.
  const envioPadraoCloud = canalEscolhido(cfg) === "whatsapp"
    || process.env.WHATSAPP_ENVIO_PADRAO === "true";
  const naCloud = new Set((linhaRes.data ?? []).map((r: any) => String(r.cliente_id)));
  const canalDe = (id: string): "whatsapp" | "rd" =>
    envioPadraoCloud || id.startsWith("wa:") || naCloud.has(id) ? "whatsapp" : "rd";

  // 3) peneira, contando o motivo de CADA corte
  const cortes: Record<string, number> = {
    sem_contato: 0, sem_telefone: 0, descartado: 0, disparo_recente: 0,
    ativo_demais: 0, canal: 0, numero_morto: 0, comprou_no_periodo: 0, conversa_aberta: 0,
    sem_dados_do_erp: 0, localizacao: 0, produto: 0, financeiro: 0, recencia: 0,
    ramo: 0, ciclo: 0, conjunto: 0,
  };
  const elegiveis: Alvo[] = [];
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

    // Antes dos cortes de tempo: não adianta ranquear quem não pode receber.
    if (morto.has(envio) || morto.has(String(c.cliente_id))) { cortes.numero_morto++; continue; }

    if (f.semCompraNo
      && ((cod != null && comprouCod.has(Number(cod))) || comprouCli.has(String(c.cliente_id)))) {
      cortes.comprou_no_periodo++; continue;
    }

    if (f.semConversaAberta && (emConversa.has(envio) || emConversa.has(String(c.cliente_id)))) {
      cortes.conversa_aberta++; continue;
    }

    // --- recortes do ERP -------------------------------------------------
    if (precisaErp) {
      const n = cod == null ? null : Number(cod);
      // ⚠️ Sem `codcli` não há como responder nada do ERP. O corte é NOMEADO:
      // esse contato existe, tem telefone, e ficou de fora só porque o CRM não
      // sabe quem ele é no WinThor -- some-lo em silêncio esconderia um problema
      // de cadastro atrás de um filtro de campanha.
      if (n == null) { cortes.sem_dados_do_erp++; continue; }
      if (setLocal && !setLocal.has(n)) { cortes.localizacao++; continue; }
      if (setComprou && !setComprou.has(n)) { cortes.produto++; continue; }
      if (setNaoComprou && setNaoComprou.has(n)) { cortes.produto++; continue; }
      if (setSemItem && !setSemItem.has(n)) { cortes.produto++; continue; }
      if (setFinanceiro && !setFinanceiro.has(n)) { cortes.financeiro++; continue; }
      if (setRecencia && !setRecencia.has(n)) { cortes.recencia++; continue; }
      if (todosQueCompraram && todosQueCompraram.has(n)) { cortes.recencia++; continue; }  // nuncaComprou
      if (setRamo && !setRamo.has(n)) { cortes.ramo++; continue; }
      if (setPreditivo && !setPreditivo.has(n)) { cortes.ciclo++; continue; }
      if (setConjunto && !setConjunto.has(n)) { cortes.conjunto++; continue; }
    }

    const ud = ultimoDisparo.get(envio) ?? ultimoDisparo.get(String(c.cliente_id));
    if (f.diasRecontato > 0 && ud && diasDesde(ud) < f.diasRecontato) { cortes.disparo_recente++; continue; }

    const dias = diasDesde(c.ultima_atividade);
    if (dias < f.diasMin) { cortes.ativo_demais++; continue; }

    const canal = canalDe(envio);
    // Template da Cloud só chega em conversa que já corre na Cloud: numa do RD o
    // envio cai no ramo do RD com um nome que o painel deles não conhece —
    // falha certa, uma por cliente.
    if (f.canal === "cloud" && canal !== "whatsapp") { cortes.canal++; continue; }

    // dedup: prospecção e conversa podem apontar para o mesmo contato do RD
    if (vistos.has(envio)) continue;
    vistos.add(envio);

    const ci = (cod != null && cicloCod.get(Number(cod)))
      || cicloCli.get(String(c.cliente_id))
      || (t.length === 8 ? cicloTel.get(t) : null);

    // urgência do ciclo + tempo parado + ticket. Com o motor desligado, `ci` é
    // sempre nulo e a ordem passa a ser tempo parado + ticket — que continua
    // sendo uma ordem defensável, em vez de campanha sem critério nenhum.
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

  // 4) seleção. A cota por vendedor é o "200 de cada", e ela molda a ESCOLHA,
  //    não a elegibilidade: quem sobra da cota continua contando no total, e
  //    aparece na próxima campanha em vez de sumir como se fosse inelegível.
  const usados: Record<string, number> = {};
  const selecionados: Alvo[] = [];
  for (const a of elegiveis) {
    if (selecionados.length >= f.limite) break;
    const chave = a.vendedor ?? "sem carteira";
    if (f.porVendedor > 0 && (usados[chave] ?? 0) >= f.porVendedor) continue;
    usados[chave] = (usados[chave] ?? 0) + 1;
    selecionados.push(a);
  }

  if (cortes.sem_dados_do_erp > 0) {
    avisos.push(
      `${cortes.sem_dados_do_erp} contato(s) ficaram de fora por não terem cadastro no WinThor — `
      + "sem código de cliente não dá para responder nada sobre compra, produto ou endereço.",
    );
  }

  return {
    ciclo_ativo: cfg.ciclo_ativo,
    total: elegiveis.length,
    selecionados,
    cortes,
    porCanal: {
      whatsapp: selecionados.filter((c) => c.canal === "whatsapp").length,
      rd: selecionados.filter((c) => c.canal === "rd").length,
    },
    porVendedor: usados,
    carteirasUsadas: carteiras,
    avisos,
  };
}
