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
// ---------------------------------------------------------------------------

const PAGE = 1000;
const COLS = "cliente_id,cliente,vendedor,etapa,ultima_atividade,telefone,venda_valor,rd_cliente_id,codcli";

/** Teto de um disparo. 1000 × 1,8s de espaço entre envios ≈ 30 min de aba aberta. */
export const LIMITE_MAX = 1000;

/** Buckets de compra que a `vw_pedido_bi_card` já calcula — não invente outros. */
export const PERIODOS_COMPRA = ["hoje", "ontem", "semana", "quinzena", "mes"] as const;
export type PeriodoCompra = (typeof PERIODOS_COMPRA)[number];

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
};

export const FILTROS_PADRAO: FiltrosPublico = {
  carteiras: [], times: [], etapas: ["ociosos", "tentativa_contato"],
  diasMin: 0, diasRecontato: 4, semCompraNo: null, semConversaAberta: false,
  porVendedor: 0, limite: 20, canal: null,
};

/** Aceita o que vier da rede (tela ou Claude) e devolve filtros válidos. */
export function lerFiltros(f: any): FiltrosPublico {
  const lista = (v: any) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const num = (v: any, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const per = String(f?.semCompraNo ?? "");
  return {
    carteiras: lista(f?.carteiras),
    times: lista(f?.times).map((t) => t.toUpperCase()),
    etapas: lista(f?.etapas),
    diasMin: Math.min(365, Math.max(0, num(f?.diasMin, 0))),
    diasRecontato: Math.min(60, Math.max(0, num(f?.diasRecontato, 4))),
    semCompraNo: (PERIODOS_COMPRA as readonly string[]).includes(per) ? (per as PeriodoCompra) : null,
    semConversaAberta: !!f?.semConversaAberta,
    porVendedor: Math.min(LIMITE_MAX, Math.max(0, num(f?.porVendedor, 0))),
    limite: Math.min(LIMITE_MAX, Math.max(1, num(f?.limite, 20))),
    canal: f?.canal === "cloud" || f?.canal === "rd" ? f.canal : null,
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
};

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

export async function montarPublico(db: any, f: FiltrosPublico): Promise<Publico> {
  const carteiras = await carteirasDosTimes(db, f);

  // 1) cards do funil (paginado — o PostgREST corta em 1000 e a view passa de 4 mil)
  const cards: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(VIEW_FUNIL_TELA).select(COLS)
      .order("ultima_atividade", { ascending: false, nullsFirst: false })
      // ⚠️ MESMO DESEMPATE DO /api/funil, e aqui o preço é maior: sem ele a
      // paginação perde e duplica linhas (medido: 30 clientes fora, 22 em
      // dobro), e este laço monta o PÚBLICO DA CAMPANHA. Perder alguém aqui é
      // não abordar quem devia; duplicar é ranquear a mesma pessoa duas vezes.
      .order("cliente_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (carteiras.length) q = q.in("vendedor", carteiras);
    if (f.etapas.length) q = q.in("etapa", f.etapas);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    cards.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  // 2) contexto: último disparo, lixeira, ciclo de compra, canal, compras e
  //    conversa aberta. Nenhum depende do outro, então vão em paralelo.
  const desdeDisparo = new Date(Date.now() - Math.max(f.diasRecontato, 1) * 86_400_000).toISOString();
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

  const [dispRes, descRes, cicloRes, linhaRes, desfRes, compraRes, abertaRes, statusRes] = await Promise.all([
    (() => {
      // anti-repetição: só conta template que saiu pelo número em uso
      const q = db.from("disparos_template").select("cliente_id,criada_em").gte("criada_em", desdeDisparo);
      return soCloudP ? q.like("id", "wamid.%") : q;
    })(),
    db.from("wth_descartados").select("cliente_id,codcli,tel8"),
    // motor desligado (crm_config, 0097): a consulta nem sai e o ranqueamento
    // passa a ser só tempo parado + ticket — ver o cálculo de `score` abaixo
    cfg.ciclo_ativo
      ? db.from("vw_ciclo_card").select("cliente_id,codcli,telefone,score_urgencia,tipo_oportunidade")
      : Promise.resolve({ data: [] as any[] }),
    db.from("vw_chat_linha_cliente").select("cliente_id"),
    // Só as FALHAS. Medido em 27/08: 32 linhas em 90 dias.
    db.from("mensagens")
      .select("cliente_id,erro,criada_em")
      .eq("enviada_por", "operator").eq("status", "failed")
      .gte("criada_em", desdeFalha)
      .order("criada_em", { ascending: true }).limit(2000),
    // "não compraram no período": os buckets já vêm prontos da view da nota
    // fiscal, e são o MESMO número que a coluna Pedido emitido do board usa.
    // Contar compra a partir da conversa (tabulação, texto "pedido faturado")
    // daria outro resultado, e o disparo passaria a discordar do board.
    f.semCompraNo
      ? db.from("vw_pedido_bi_card").select("codcli,cliente_id").eq("periodo", f.semCompraNo)
      : Promise.resolve({ data: [] as any[] }),
    // conversa aberta = a cliente falou nas últimas 24h. ⚠️ Passa por
    // `filtroLinhas`: com o RD escondido, conversa que só existe lá não conta
    // (§44) — senão o corte esconderia gente que, para o resto do sistema, não
    // está falando com ninguém.
    f.semConversaAberta
      ? filtroLinhas(
          db.from("mensagens").select("cliente_id")
            .eq("enviada_por", "customer")
            .gte("criada_em", new Date(Date.now() - 24 * 3600_000).toISOString())
            .limit(5000),
          cfg,
        )
      : Promise.resolve({ data: [] as any[] }),
    // ...e a conversa que alguém marcou como aberta no chat, que é a outra
    // metade do sentido de "está em atendimento agora".
    f.semConversaAberta
      ? db.from("chat_conversa").select("cliente_id").eq("status", "aberta")
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const ultimoDisparo = new Map<string, string>();
  for (const d of dispRes.data ?? []) {
    const id = String(d.cliente_id ?? "");
    const atual = ultimoDisparo.get(id);
    if (!atual || String(d.criada_em) > atual) ultimoDisparo.set(id, String(d.criada_em));
  }

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

  const descCli = new Set((descRes.data ?? []).map((d: any) => d.cliente_id).filter(Boolean));
  const descCod = new Set((descRes.data ?? []).map((d: any) => d.codcli).filter((x: any) => x != null).map(Number));
  const descTel = new Set((descRes.data ?? []).map((d: any) => d.tel8).filter(Boolean));

  const comprouCod = new Set((compraRes.data ?? []).map((r: any) => Number(r.codcli)).filter((n: number) => !isNaN(n)));
  const comprouCli = new Set((compraRes.data ?? []).map((r: any) => r.cliente_id).filter(Boolean).map(String));

  const emConversa = new Set<string>([
    ...(abertaRes.data ?? []).map((r: any) => String(r.cliente_id)),
    ...(statusRes.data ?? []).map((r: any) => String(r.cliente_id)),
  ]);

  const cicloCli = new Map<string, any>(), cicloCod = new Map<number, any>(), cicloTel = new Map<string, any>();
  for (const r of cicloRes.data ?? []) {
    if (r.cliente_id) cicloCli.set(String(r.cliente_id), r);
    if (r.codcli != null) cicloCod.set(Number(r.codcli), r);
    const t = tel8(r.telefone);
    if (t.length === 8) cicloTel.set(t, r);
  }

  // Canal do contato. ⚠️ `numero_envio` (§37.1) tem precedência sobre a regra
  // por conversa: com o admin escolhendo Cloud, todo mundo sai pela Cloud.
  const envioPadraoCloud = canalEscolhido(cfg) === "whatsapp"
    || process.env.WHATSAPP_ENVIO_PADRAO === "true";
  const naCloud = new Set((linhaRes.data ?? []).map((r: any) => String(r.cliente_id)));
  const canalDe = (id: string): "whatsapp" | "rd" =>
    envioPadraoCloud || id.startsWith("wa:") || naCloud.has(id) ? "whatsapp" : "rd";

  // 3) peneira, contando o motivo de CADA corte — número sem motivo vira
  //    discussão ("por que só 12?") que ninguém resolve olhando a tela.
  const cortes: Record<string, number> = {
    sem_contato: 0, sem_telefone: 0, descartado: 0, disparo_recente: 0,
    ativo_demais: 0, canal: 0, numero_morto: 0, comprou_no_periodo: 0, conversa_aberta: 0,
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
  };
}
