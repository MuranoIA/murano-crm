import Anthropic from "@anthropic-ai/sdk";
import { sbAdmin, guardaAdmin, corpo } from "../../../../../lib/adminApi";
import { lerCrmConfig, linhasVisiveis, modoMigracao } from "../../../../../lib/crmConfig";
import {
  montarPublico, lerFiltros,
  FILTROS_PADRAO, LIMITE_MAX, PERIODOS_COMPRA, DIMENSOES_ITEM,
  type FiltrosPublico, type CachePublico,
} from "../../../../../lib/publicoDisparo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// O assistente que monta o público conversando.
//
// POR QUE ISTO EXISTE
//
// O fluxo real da campanha, até aqui, saía do CRM no meio do caminho: a
// supervisão conversava com um chat FORA do sistema ("200 clientes de cada
// vendedor do inside sales que não compraram esse mês, que não receberam
// template hoje, que não estão em conversa aberta"), recebia uma PLANILHA, e
// subia essa planilha no painel do RD Conversas para disparar.
//
// Três coisas ruins nesse caminho, e todas somem aqui: a planilha nasce de uma
// consulta que ninguém revisa, ela envelhece entre gerar e subir (o cliente
// compra, responde, ou já recebeu template nesse meio tempo), e o disparo
// acontece fora do CRM — sem extrato, sem anti-repetição, sem o corte de número
// que não recebe.
//
// ---------------------------------------------------------------------------
// A REGRA QUE GOVERNA ESTA ROTA: ela NÃO envia nada, e não pode.
//
// Nenhuma das três ferramentas escreve. `montar_publico` é a mesma peneira de
// `lib/publicoDisparo.ts` que a tela usa na prévia; `vocabulario` lê valores
// possíveis; `consultar_base` roda SELECT em transação somente-leitura (0119).
// O envio continua sendo o laço do navegador, depois de o admin clicar em Usar
// este público, Revisar e Confirmar. Não existe caminho de código daqui até
// `/api/send-template`, e é assim de propósito: a decisão de gastar R$ 0,43 ×
// N e falar com N clientes reais é de uma pessoa.
//
// ---------------------------------------------------------------------------
// ⚠️ NENHUM NOME DE CLIENTE VAI PARA O MODELO.
//
// `montar_publico` devolve CONTAGENS. `consultar_base` tem as colunas de
// identificação REMOVIDAS da resposta (`COLUNA_PROIBIDA`) — o modelo vê quantos
// e por quais critérios, nunca quem. A lista com nome e telefone é renderizada
// pela tela a partir da prévia, que roda no nosso servidor.
// ---------------------------------------------------------------------------

const MODEL = "claude-opus-5";
const MAX_VOLTAS = 6;        // com três ferramentas, o caminho normal usa 2-3
const MAX_HISTORICO = 40;

// ⚠️ A Vercel corta a rota em `maxDuration`. Medido em 28/08, ANTES do cache do
// motor: um turno com vocabulário + três tentativas de público levou 85 s e
// teria morrido no meio. O cache resolveu o grosso, mas a rede da Meta e do
// modelo não são previsíveis -- então o laço PARA por conta própria antes do
// limite e responde com o que já tem, em vez de estourar e não responder nada.
const ORCAMENTO_MS = 45_000;

type Bloco = Anthropic.ContentBlockParam;

/** Colunas que nunca voltam de uma consulta livre. `rca_nome` fica: é vendedor, não cliente (§15.5). */
const COLUNA_PROIBIDA = /^(nome|nome_norm|cliente|telefone|tel8|cpf|cpf_bruto|email|endereco|conteudo)$/i;
const CONTEM_PROIBIDO = /(telefone|celular|cpf|email|e_mail)/i;

const LINHAS_PARA_O_MODELO = 40;   // o conjunto guarda tudo; o modelo vê uma amostra

const RECORTE_ITEM = {
  type: "object",
  additionalProperties: false,
  properties: {
    dimensao: { type: "string", enum: [...DIMENSOES_ITEM] },
    valores: {
      type: "array", items: { type: "string" },
      description: "valores EXATOS como estão no ERP. Use `vocabulario` para descobri-los — chutar o nome devolve zero clientes sem avisar.",
    },
    dias: { type: "integer", description: "janela em dias. 0 = qualquer momento." },
  },
  required: ["dimensao", "valores", "dias"],
};

const FERRAMENTAS = [
  {
    name: "montar_publico",
    description:
      "Conta quantos clientes seriam atingidos por um conjunto de filtros, SEM enviar nada. "
      + "Use SEMPRE antes de afirmar qualquer número — nunca estime de cabeça. "
      + "Devolve o total de elegíveis, quantos entram na seleção, quanto de cada carteira, "
      + "e quantos ficaram de fora por cada motivo.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        // --- quem ---------------------------------------------------------
        carteiras: { type: "array", items: { type: "string" }, description: "slugs de carteira escolhidos a dedo. Vazio = todas (ou as do time)." },
        times: { type: "array", items: { type: "string", enum: ["IS", "ISR", "GC"] }, description: "IS = inside sales, ISR = reativação, GC = grandes contas." },
        etapas: {
          type: "array", items: { type: "string", enum: ["ociosos", "tentativa_contato", "prospeccao", "negociacao"] },
          description: "ociosos = falou por último e a janela de 24h fechou; tentativa_contato = recebeu template e não respondeu; prospeccao = está na carteira e nunca teve conversa; negociacao = conversa ativa (normalmente NÃO se dispara aqui). Vazio = todas.",
        },
        diasMin: { type: "integer", description: "parado há pelo menos N dias sem atividade na conversa. 0 = sem exigência." },
        diasRecontato: { type: "integer", description: "não recebeu template nos últimos N dias. 1 = 'não recebeu hoje'." },
        semCompraNo: { type: "string", enum: [...PERIODOS_COMPRA, "nenhum"], description: "corta quem COMPROU no período (nota fiscal). 'mes' = não compraram neste mês." },
        semConversaAberta: { type: "boolean", description: "corta quem falou nas últimas 24h ou tem conversa marcada como aberta." },
        porVendedor: { type: "integer", description: "cota por carteira — o '200 de cada vendedor'. 0 = sem cota." },
        limite: { type: "integer", description: `teto total (máximo ${LIMITE_MAX}). Com cota, use cota × número de carteiras.` },

        // --- onde ---------------------------------------------------------
        cidades: { type: "array", items: { type: "string" }, description: "cidades exatas do cadastro." },
        estados: { type: "array", items: { type: "string" }, description: "siglas: PA, MA." },
        bairros: { type: "array", items: { type: "string" }, description: "bairros exatos do cadastro." },
        cepPrefixos: { type: "array", items: { type: "string" }, description: "prefixos de CEP, só dígitos ('660', '66093')." },

        // --- o que compra -------------------------------------------------
        comprou: { ...RECORTE_ITEM, description: "comprou isto (em qualquer momento, ou nos últimos `dias`)." },
        naoComprou: { ...RECORTE_ITEM, description: "NUNCA comprou isto. `dias` é ignorado." },
        semComprarItemHa: { ...RECORTE_ITEM, description: "já comprou isto, mas não compra há `dias`." },

        // --- quanto compra -------------------------------------------------
        ticketMin: { type: "number", description: "ticket médio mínimo em reais. 0 = sem limite." },
        ticketMax: { type: "number", description: "ticket médio máximo. 0 = sem limite." },
        receitaMin: { type: "number", description: "receita líquida acumulada mínima." },
        ultimoPedidoMin: { type: "number", description: "valor mínimo do último pedido." },
        pedidosMin: { type: "integer", description: "número mínimo de pedidos no histórico. Min 1 + Max 1 = cliente de compra única." },
        pedidosMax: { type: "integer", description: "número máximo de pedidos. 0 = sem limite." },

        // --- quando comprou ------------------------------------------------
        semComprarDiasMin: { type: "integer", description: "sem comprar há pelo menos N dias." },
        semComprarDiasMax: { type: "integer", description: "sem comprar há no máximo N dias. Com o Min, forma a faixa (ex.: 60 a 90)." },
        nuncaComprou: { type: "boolean", description: "nunca comprou nada — não aparece no faturamento." },
        primeiraCompraUltimosDias: { type: "integer", description: "primeira compra nos últimos N dias (cliente novo)." },
        comDevolucaoUltimosDias: { type: "integer", description: "teve devolução nos últimos N dias." },
        semDevolucao: { type: "boolean", description: "nunca devolveu nada." },

        // --- quem é / motor ------------------------------------------------
        ramos: { type: "array", items: { type: "string" }, description: "ramo do cliente (SALAO, PROFISSIONAL...). ATENÇÃO: só existe para parte da base." },
        tiposOportunidade: { type: "array", items: { type: "string" }, description: "RECOMPRA, EXPANSAO, RECUPERACAO, REATIVACAO, ATRASO. Só vale com o motor de ciclo ligado." },
        tendencias: { type: "array", items: { type: "string" }, description: "CRESCENDO, CAINDO, PAROU. Só vale com o motor de ciclo ligado." },
        scoreMin: { type: "integer", description: "score de urgência mínimo (0-100). Só vale com o motor de ciclo ligado." },

        conjunto: { type: "string", description: "id de um conjunto devolvido por `consultar_base`. Vazio = não usa." },
      },
      required: [
        "carteiras", "times", "etapas", "diasMin", "diasRecontato", "semCompraNo",
        "semConversaAberta", "porVendedor", "limite",
        "cidades", "estados", "bairros", "cepPrefixos",
        "comprou", "naoComprou", "semComprarItemHa",
        "ticketMin", "ticketMax", "receitaMin", "ultimoPedidoMin", "pedidosMin", "pedidosMax",
        "semComprarDiasMin", "semComprarDiasMax", "nuncaComprou", "primeiraCompraUltimosDias",
        "comDevolucaoUltimosDias", "semDevolucao",
        "ramos", "tiposOportunidade", "tendencias", "scoreMin", "conjunto",
      ],
    },
  },
  {
    name: "vocabulario",
    description:
      "Lista os valores que EXISTEM no cadastro para uma dimensão, com quantos clientes cada um tem. "
      + "Chame isto antes de filtrar por seção, departamento, marca, produto, cidade, bairro ou ramo: "
      + "o nome que a pessoa usa na fala quase nunca é o nome do ERP, e um valor inventado devolve "
      + "zero clientes sem erro nenhum.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        dimensao: { type: "string", enum: ["secao", "departamento", "marca", "produto", "cidade", "bairro", "ramo"] },
        busca: { type: "string", description: "pedaço do nome para filtrar. Vazio = os mais frequentes." },
      },
      required: ["dimensao", "busca"],
    },
  },
  {
    name: "consultar_base",
    description:
      "SELECT de leitura no banco, para a pergunta que os filtros de `montar_publico` não expressam. "
      + "Use SÓ nesse caso — os filtros já cobrem carteira, etapa, localização, produto, valor, "
      + "frequência, recência e devolução, e passam por travas que a consulta crua não tem. "
      + "Se a consulta devolver uma coluna `codcli`, o resultado vira um CONJUNTO cujo id você "
      + "passa em `montar_publico.conjunto` — é assim que ela vira público, nunca direto. "
      + "Somente leitura, uma consulta por vez, sobre uma lista branca de objetos.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        sql: { type: "string", description: "um SELECT (ou WITH ... SELECT). Sem ponto e vírgula." },
        motivo: { type: "string", description: "em uma frase, o que você está tentando descobrir — aparece na tela para o admin." },
      },
      required: ["sql", "motivo"],
    },
  },
] as unknown as Anthropic.Tool[];

function sistema(ctx: {
  carteiras: { slug: string; time: string | null }[];
  hoje: string; canalTpl: string | null; semRd: boolean; cicloAtivo: boolean;
  objetos: { objeto: string; nota: string | null }[];
}) {
  const carteiras = ctx.carteiras.map((c) => `${c.slug} (${c.time ?? "sem time"})`).join(", ") || "nenhuma cadastrada";
  return [
    "Você é o assistente de campanha do CRM Murano (Pulse). Sua única função é ajudar a supervisão a",
    "montar o PÚBLICO de um disparo de template de WhatsApp em massa, conversando em português do Brasil.",
    "",
    "COMO VOCÊ TRABALHA",
    "- Toda vez que o público mudar, chame `montar_publico` e responda com os números que ela devolveu.",
    "- Nunca estime de cabeça: se você não chamou a ferramenta, não afirme quantidade nenhuma.",
    "- Antes de filtrar por seção, departamento, marca, produto, cidade, bairro ou ramo, chame",
    "  `vocabulario` para pegar o nome exato. Um valor inventado devolve zero e não dá erro.",
    "- Se o pedido for ambíguo em algo que muda o resultado, escolha o mais conservador, DIGA qual",
    "  escolha você fez, e ofereça a alternativa numa frase.",
    "- Responda curto: dois ou três parágrafos, sem repetir os filtros campo a campo — a tela já",
    "  mostra a proposta ao lado da sua resposta.",
    "- ⚠️ A ÚLTIMA chamada de `montar_publico` do seu turno é a que vira o cartão com o botão",
    "  'Usar este público'. Se você explorar alternativas para comparar números, TERMINE chamando",
    "  de novo com o público que você está de fato recomendando — senão o texto diz um número e o",
    "  botão aplica outro.",
    "",
    "QUANDO USAR `consultar_base`",
    "- Só quando a pergunta não couber nos campos de `montar_publico`. Os filtros estruturados já",
    "  cobrem carteira, time, etapa, tempo parado, template recente, compra no período, conversa",
    "  aberta, cidade, bairro, CEP, produto/seção/departamento/marca (comprou, nunca comprou, não",
    "  compra há N dias), ticket, receita, valor do último pedido, número de pedidos, faixa de dias",
    "  sem comprar, cliente novo, devolução e ramo.",
    "- O resultado NÃO é o público. Se a consulta tiver uma coluna `codcli`, ela vira um conjunto;",
    "  passe o id em `montar_publico.conjunto` para que as travas do disparo continuem valendo.",
    "- Você não recebe nome, telefone nem CPF: essas colunas são removidas da resposta.",
    `- Objetos disponíveis: ${ctx.objetos.map((o) => o.objeto).join(", ")}.`,
    "",
    "O QUE VOCÊ NÃO FAZ",
    "- Você NÃO envia template nenhum e não tem como. Quem dispara é a supervisão, aplicando a sua",
    "  proposta na tela e confirmando. Nunca diga que enviou, nem que vai enviar.",
    "- Você não vê nome nem telefone de cliente. A lista aparece na tela, não aqui.",
    "",
    "O QUE CUSTA",
    "- Cada template disparado custa cerca de R$ 0,43. Um público de 800 custa ~R$ 344 e leva ~25",
    "  minutos de aba aberta (o envio é um por vez). Diga isso quando o número passar de algumas",
    "  centenas — não para desencorajar, mas para a decisão ser consciente.",
    "",
    "CONTEXTO DE HOJE",
    `- Hoje é ${ctx.hoje} (fuso de Brasília).`,
    `- Carteiras ativas: ${carteiras}.`,
    `- Padrão da tela quando ninguém pede nada: etapas ${FILTROS_PADRAO.etapas.join(" e ")}, sem repetir`,
    `  template por ${FILTROS_PADRAO.diasRecontato} dias, ${FILTROS_PADRAO.limite} clientes.`,
    ctx.cicloAtivo
      ? "- O motor de ciclo de compra está ligado: oportunidade, tendência e score valem."
      : "- O motor de ciclo de compra está DESLIGADO: filtros de oportunidade, tendência e score são ignorados, e o ranqueamento é por tempo parado e ticket.",
    ctx.semRd
      ? "- Existe um número só. Não mencione RD Conversas, Tallos, nem canal de atendimento antigo: para quem lê esta tela, isso não existe."
      : ctx.canalTpl === "cloud"
        ? "- O template escolhido é da WhatsApp Cloud, então só alcança quem já conversa por lá; o resto aparece no corte 'canal'."
        : "- O template escolhido é do RD Conversas.",
    "",
    "COISAS QUE JÁ SÃO AUTOMÁTICAS — não prometa como mérito seu, mas mencione se perguntarem:",
    "- quem está na lixeira sai; quem não tem telefone sai;",
    "- número que já falhou com erro permanente do WhatsApp sai;",
    "- quem recebeu template dentro da janela de anti-repetição sai;",
    "- havendo mais elegíveis que a quantidade pedida, entram os mais prioritários.",
  ].filter(Boolean).join("\n");
}

/**
 * O erro da Anthropic em português, com o que fazer.
 *
 * Mesma régua dos erros da Meta (`lib/erroMeta.ts`): recado que não diz o que
 * fazer vira diagnóstico errado, e diagnóstico errado vira pedido de mudança na
 * coisa errada (§37). O texto cru vai junto, no fim -- perdê-lo já custou horas
 * uma vez (§22.6.1).
 */
function recadoDoErro(e: any): string {
  const cru = String(e?.message ?? e ?? "");
  const status = Number(e?.status ?? 0);

  if (/credit balance is too low/i.test(cru)) {
    return "A conta da Anthropic está sem créditos. Adicione crédito em console.anthropic.com "
      + "→ Settings → Billing e tente de novo. Os filtros ao lado continuam funcionando.";
  }
  if (status === 401 || /authentication|invalid x-api-key/i.test(cru)) {
    return "A chave da Anthropic foi recusada. Confira a ANTHROPIC_API_KEY nas variáveis de "
      + "ambiente da Vercel — chave revogada ou expirada dá exatamente isto.";
  }
  if (status === 429 || /rate.?limit/i.test(cru)) {
    return "A API da Anthropic está limitando o ritmo. Espere alguns segundos e pergunte de novo.";
  }
  if (status >= 500) {
    return "A API da Anthropic falhou do lado deles. Tente de novo em instantes.";
  }
  return `O assistente não respondeu${status ? ` (${status})` : ""}. ${cru}`;
}

/** O que volta para o modelo: contagem, nunca cliente. */
function resumoParaModelo(p: any, f: FiltrosPublico) {
  const cortes = Object.fromEntries(Object.entries(p.cortes).filter(([, n]) => Number(n) > 0));
  return JSON.stringify({
    elegiveis: p.total,
    selecionados: p.selecionados.length,
    por_carteira: p.porVendedor,
    por_canal: p.porCanal,
    ficaram_de_fora: cortes,
    carteiras_consideradas: p.carteirasUsadas,
    custo_reais: Math.round(p.selecionados.length * 0.43 * 100) / 100,
    avisos: p.avisos,
    filtros_aplicados: f,
  });
}

/** Tira do resultado da consulta livre qualquer coluna que identifique a cliente. */
function limparPii(linhas: any[]): any[] {
  return linhas.map((l) => {
    const saida: Record<string, any> = {};
    for (const [k, v] of Object.entries(l ?? {})) {
      if (COLUNA_PROIBIDA.test(k) || CONTEM_PROIBIDO.test(k)) continue;
      saida[k] = v;
    }
    return saida;
  });
}

/**
 * Os valores que existem de verdade. Sem isto o modelo escreve "SELAGEM" (que
 * não existe: o departamento é "ESCOVAS/ALISANTES") e o filtro devolve zero
 * clientes sem erro nenhum -- o pior tipo de resposta errada.
 */
async function rodarVocabulario(db: any, dimensao: string, busca: string) {
  const b = busca.trim();

  if (dimensao === "cidade" || dimensao === "bairro") {
    const tab = dimensao === "cidade" ? "wth_carteira" : "wth_endereco";
    let q = db.from(tab).select(dimensao).not(dimensao, "is", null).limit(5000);
    if (b) q = q.ilike(dimensao, `%${b}%`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const c = new Map<string, number>();
    for (const r of data ?? []) {
      const v = String((r as any)[dimensao]);
      c.set(v, (c.get(v) ?? 0) + 1);
    }
    return [...c.entries()].sort((x, y) => y[1] - x[1]).slice(0, 60).map(([valor, clientes]) => ({ valor, clientes }));
  }

  if (dimensao === "ramo") {
    const { data } = await db.from("wth_ciclo").select("ramo").not("ramo", "is", null).limit(5000);
    const c = new Map<string, number>();
    for (const r of data ?? []) {
      const v = String((r as any).ramo);
      c.set(v, (c.get(v) ?? 0) + 1);
    }
    return [...c.entries()].sort((x, y) => y[1] - x[1]).map(([valor, clientes]) => ({ valor, clientes }));
  }

  // secao / departamento / marca / produto saem da view agregada, via a mesma
  // função de leitura da consulta livre (é SELECT sobre objeto da lista branca)
  const dim = dimensao.replace(/'/g, "");
  let sql = `select valor, count(*) as clientes from vw_cliente_item where dimensao = '${dim}'`;
  if (b) sql += ` and valor ilike '%${b.replace(/'/g, "''")}%'`;
  sql += " group by valor order by clientes desc limit 60";
  const { data, error } = await db.rpc("crm_consulta_leitura", { p_sql: sql, p_limite: 60 });
  if (error) throw new Error(error.message);
  const linhas: any[] = Array.isArray(data) ? data : [];
  if (dimensao !== "produto") return linhas;

  // produto é código: sem o nome do catálogo o modelo não sabe o que escolheu
  const cods = linhas.map((l) => Number(l.valor)).filter((n) => !isNaN(n));
  const { data: cat } = await db.from("wth_catalogo").select("codprod,produto,marca,secao").in("codprod", cods);
  const nomes = new Map((cat ?? []).map((c: any) => [String(c.codprod), c]));
  return linhas.map((l) => ({ ...l, ...(nomes.get(String(l.valor)) ?? {}) }));
}

export async function POST(req: Request) {
  const g = guardaAdmin("usar o assistente de campanha");
  if (g.erro) return g.erro;

  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) {
    return Response.json({
      error: "O assistente não está configurado. Falta a variável ANTHROPIC_API_KEY na Vercel "
        + "(Settings → Environment Variables) — sem ela esta conversa não tem como acontecer. "
        + "Os filtros ao lado continuam funcionando normalmente.",
    }, { status: 501 });
  }

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  const texto = String(b.texto ?? "").trim().slice(0, 4000);
  if (!texto) return Response.json({ error: "escreva o que você quer montar" }, { status: 400 });

  const db = sbAdmin();
  const [cfg, cartRes, objRes] = await Promise.all([
    lerCrmConfig(db),
    db.from("carteira_config").select('slug,"time"').eq("ativo", true).order("slug"),
    db.from("crm_consulta_objetos").select("objeto,nota").order("objeto"),
  ]);

  const canalTpl = b.canal === "cloud" || b.canal === "rd" ? b.canal : null;
  const sys = sistema({
    carteiras: (cartRes.data ?? []).map((c: any) => ({ slug: String(c.slug), time: c.time ?? null })),
    hoje: new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/"),
    canalTpl,
    semRd: modoMigracao(cfg) || !linhasVisiveis(cfg).includes("rd"),
    cicloAtivo: cfg.ciclo_ativo,
    objetos: (objRes.data ?? []) as any[],
  });

  // O histórico vem da tela e volta para a tela. Guardá-lo aqui exigiria uma
  // tabela e uma limpeza; e o pareamento tool_use/tool_result tem que ser
  // exato, então quem devolve a lista pronta é esta rota — a tela só ecoa.
  const anteriores: Anthropic.MessageParam[] = Array.isArray(b.mensagens)
    ? (b.mensagens as Anthropic.MessageParam[]).slice(-MAX_HISTORICO)
    : [];
  const mensagens: Anthropic.MessageParam[] = [...anteriores, { role: "user", content: texto }];

  const client = new Anthropic({ apiKey: chave });
  const comecou = Date.now();
  // uma memória por requisição: o modelo refaz o público várias vezes no mesmo
  // turno, e sem isto cada tentativa repetia a varredura inteira da vw_funil
  const cache: CachePublico = {};

  let proposta: FiltrosPublico | null = null;
  let resultado: any = null;
  let resposta = "";
  let avisoTempo = "";
  const consultas: { sql: string; motivo: string; linhas: number; conjunto: string | null; erro?: string }[] = [];

  try {
    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      if (volta > 0 && Date.now() - comecou > ORCAMENTO_MS) {
        avisoTempo = "Parei aqui para não estourar o tempo da requisição — se faltou algo, pergunte de novo.";
        break;
      }
      const r = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system: sys,
        tools: FERRAMENTAS,
        messages: mensagens,
      });

      const chamadas = r.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
      resposta = r.content.filter((c) => c.type === "text").map((c: any) => c.text).join("\n").trim();

      if (!chamadas.length) break;

      mensagens.push({ role: "assistant", content: r.content as Bloco[] });

      const devolucoes: Anthropic.ToolResultBlockParam[] = [];
      for (const ch of chamadas) {
        try {
          if (ch.name === "montar_publico") {
            // ⚠️ o input chega como JSON já parseado, mas é do MODELO: passa por
            // `lerFiltros` como qualquer coisa que vem da rede. E `canal` NÃO vem
            // do modelo — vem do template marcado na tela; sem isso o número que
            // o assistente promete e o da prévia divergem.
            const f = lerFiltros({ ...(ch.input as any), canal: canalTpl });
            const p = await montarPublico(db, f, cache);
            proposta = f;
            resultado = {
              total: p.total, selecionados: p.selecionados.length, cortes: p.cortes,
              porVendedor: p.porVendedor, porCanal: p.porCanal,
              carteirasUsadas: p.carteirasUsadas, avisos: p.avisos,
            };
            devolucoes.push({ type: "tool_result", tool_use_id: ch.id, content: resumoParaModelo(p, f) });

          } else if (ch.name === "vocabulario") {
            const i = ch.input as any;
            const vals = await rodarVocabulario(db, String(i.dimensao ?? ""), String(i.busca ?? ""));
            devolucoes.push({
              type: "tool_result", tool_use_id: ch.id,
              content: JSON.stringify({ dimensao: i.dimensao, valores: vals }),
            });

          } else if (ch.name === "consultar_base") {
            const i = ch.input as any;
            const sql = String(i.sql ?? "");
            const { data, error } = await db.rpc("crm_consulta_leitura", { p_sql: sql, p_limite: 5000 });
            if (error) throw new Error(error.message);
            const linhas: any[] = Array.isArray(data) ? data : [];

            // Se a consulta trouxe codcli, ela vira CONJUNTO -- e é só assim que
            // o resultado de uma consulta livre pode virar público, com todas as
            // travas do disparo ainda pela frente.
            let conjuntoId: string | null = null;
            const cods = [...new Set(linhas.map((l) => Number(l?.codcli)).filter((n) => !isNaN(n)))];
            if (cods.length) {
              conjuntoId = `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
              const { error: e2 } = await db.from("crm_conjunto").insert({
                id: conjuntoId, criado_por: g.email ?? null,
                consulta: sql.slice(0, 4000), codclis: cods,
              });
              if (e2) conjuntoId = null;
            }
            consultas.push({ sql, motivo: String(i.motivo ?? ""), linhas: linhas.length, conjunto: conjuntoId });
            devolucoes.push({
              type: "tool_result", tool_use_id: ch.id,
              content: JSON.stringify({
                linhas: linhas.length,
                conjunto: conjuntoId,
                clientes_no_conjunto: cods.length,
                amostra: limparPii(linhas.slice(0, LINHAS_PARA_O_MODELO)),
                nota: linhas.length > LINHAS_PARA_O_MODELO
                  ? `mostrando ${LINHAS_PARA_O_MODELO} de ${linhas.length} linhas; o conjunto guarda todos`
                  : undefined,
              }),
            });

          } else {
            devolucoes.push({ type: "tool_result", tool_use_id: ch.id, is_error: true, content: "ferramenta desconhecida" });
          }
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (ch.name === "consultar_base") {
            const i = ch.input as any;
            consultas.push({ sql: String(i?.sql ?? ""), motivo: String(i?.motivo ?? ""), linhas: 0, conjunto: null, erro: msg });
          }
          devolucoes.push({ type: "tool_result", tool_use_id: ch.id, is_error: true, content: msg });
        }
      }
      mensagens.push({ role: "user", content: devolucoes });
    }
  } catch (e: any) {
    return Response.json({ error: recadoDoErro(e) }, { status: 502 });
  }

  if (resposta) mensagens.push({ role: "assistant", content: resposta });

  return Response.json({
    texto: [resposta || "Não consegui montar isso. Tente descrever o público de outro jeito.", avisoTempo]
      .filter(Boolean).join("\n\n"),
    // a tela usa isto para desenhar o cartão com o botão. Sem proposta, foi só
    // conversa — e a tela não oferece botão nenhum, que é o certo.
    proposta,
    resultado,
    // as consultas livres aparecem na tela: quem confirma o disparo tem direito
    // de ver por qual caminho o público foi montado
    consultas,
    mensagens,
  });
}
