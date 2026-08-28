import Anthropic from "@anthropic-ai/sdk";
import { sbAdmin, guardaAdmin, corpo } from "../../../../../lib/adminApi";
import { lerCrmConfig, linhasVisiveis, modoMigracao } from "../../../../../lib/crmConfig";
import {
  montarPublico, lerFiltros,
  FILTROS_PADRAO, LIMITE_MAX, PERIODOS_COMPRA, type FiltrosPublico,
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
// A única ferramenta que o modelo tem é `montar_publico`, que é SÓ LEITURA — a
// mesma peneira de `lib/publicoDisparo.ts` que a tela usa na prévia. O envio
// continua sendo o laço do navegador, depois de o admin clicar em Aplicar,
// Revisar e Confirmar. Não existe caminho de código daqui até
// `/api/send-template`, e é assim de propósito: a decisão de gastar R$ 0,43 ×
// N e falar com N clientes reais é de uma pessoa.
//
// ---------------------------------------------------------------------------
// ⚠️ NENHUM NOME DE CLIENTE VAI PARA O MODELO.
//
// `montar_publico` devolve CONTAGENS — total, cortes por motivo, quanto de cada
// carteira, canal. A lista com nome e telefone é renderizada pela tela a partir
// da prévia, que roda no nosso servidor. O modelo não precisa dos nomes para
// montar um público, e mandar a base de clientes para um serviço externo a cada
// pergunta seria pagar um preço de privacidade por nada.
// ---------------------------------------------------------------------------

const MODEL = "claude-opus-5";
const MAX_VOLTAS = 4;        // o modelo pode refazer a conta, não varrer o banco
const MAX_HISTORICO = 40;    // pares de turno guardados pela tela

type Bloco = Anthropic.ContentBlockParam;

const FERRAMENTA = {
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
      carteiras: {
        type: "array", items: { type: "string" },
        description: "slugs de carteira escolhidos a dedo. Vazio = todas (ou as do time).",
      },
      times: {
        type: "array", items: { type: "string", enum: ["IS", "ISR", "GC"] },
        description: "times inteiros. IS = inside sales / vendas internas, ISR = reativação, GC = grandes contas.",
      },
      etapas: {
        type: "array", items: { type: "string", enum: ["ociosos", "tentativa_contato", "prospeccao", "negociacao"] },
        description:
          "etapas do funil. ociosos = a cliente falou por último e a janela de 24h fechou; "
          + "tentativa_contato = recebeu template e ainda não respondeu; prospeccao = está na carteira do "
          + "WinThor e nunca teve conversa; negociacao = conversa ativa nas últimas 24h (normalmente NÃO se "
          + "dispara template aqui). Vazio = todas.",
      },
      diasMin: { type: "integer", description: "parado há pelo menos N dias sem nenhuma atividade. 0 = sem exigência." },
      diasRecontato: { type: "integer", description: "não recebeu template nos últimos N dias. 1 = 'não recebeu hoje'. 0 = desliga o corte." },
      semCompraNo: {
        type: "string", enum: [...PERIODOS_COMPRA, "nenhum"],
        description: "corta quem COMPROU no período (nota fiscal do WinThor). 'mes' = não compraram neste mês. 'nenhum' = não olha compra.",
      },
      semConversaAberta: { type: "boolean", description: "corta quem está em conversa aberta agora (falou nas últimas 24h ou tem conversa marcada como aberta no chat)." },
      porVendedor: { type: "integer", description: "cota por carteira — o '200 de cada vendedor'. 0 = sem cota." },
      limite: { type: "integer", description: `teto total do disparo (máximo ${LIMITE_MAX}). Com cota por vendedor, use cota × número de carteiras.` },
    },
    required: ["carteiras", "times", "etapas", "diasMin", "diasRecontato", "semCompraNo", "semConversaAberta", "porVendedor", "limite"],
  } as any,
} as unknown as Anthropic.Tool;

function sistema(ctx: {
  carteiras: { slug: string; time: string | null }[];
  hoje: string; canalTpl: string | null; semRd: boolean;
}) {
  const lista = ctx.carteiras.map((c) => `${c.slug} (${c.time ?? "sem time"})`).join(", ") || "nenhuma cadastrada";
  return [
    "Você é o assistente de campanha do CRM Murano (Pulse). Sua única função é ajudar a supervisão a",
    "montar o PÚBLICO de um disparo de template de WhatsApp em massa, conversando em português do Brasil.",
    "",
    "COMO VOCÊ TRABALHA",
    "- Toda vez que o público mudar, chame `montar_publico` e responda com os números que ela devolveu.",
    "- Nunca estime de cabeça: se você não chamou a ferramenta, não afirme quantidade nenhuma.",
    "- Se o pedido for ambíguo em algo que muda o resultado, escolha o mais conservador, DIGA qual",
    "  escolha você fez, e ofereça a alternativa numa frase.",
    "- Responda curto: dois ou três parágrafos no máximo, sem listas longas e sem repetir os filtros",
    "  campo a campo — a tela já mostra a proposta ao lado da sua resposta.",
    "",
    "O QUE VOCÊ NÃO FAZ",
    "- Você NÃO envia template nenhum e não tem como. Quem dispara é a supervisão, aplicando a sua",
    "  proposta na tela e confirmando. Nunca diga que enviou, nem que vai enviar.",
    "- Você não vê nome nem telefone de cliente. A lista aparece na tela, não aqui.",
    "",
    "O QUE CUSTA",
    `- Cada template disparado custa cerca de R$ 0,43. Um público de 800 custa ~R$ 344 e leva ~25 minutos`,
    "  de aba aberta (o envio é um por vez, para não estourar a cota da API). Diga isso quando o número",
    "  passar de algumas centenas — não para desencorajar, mas para a decisão ser consciente.",
    "",
    "CONTEXTO DE HOJE",
    `- Hoje é ${ctx.hoje} (fuso de Brasília).`,
    `- Carteiras ativas: ${lista}.`,
    `- Padrão da tela quando ninguém pede nada: etapas ${FILTROS_PADRAO.etapas.join(" e ")}, sem repetir`,
    `  template por ${FILTROS_PADRAO.diasRecontato} dias, ${FILTROS_PADRAO.limite} clientes.`,
    ctx.canalTpl === "cloud"
      ? "- O template escolhido na tela é da WhatsApp Cloud, então só alcança quem já conversa por lá; o resto sai do público e aparece no corte 'canal'."
      : "- O template escolhido na tela é do RD Conversas.",
    ctx.semRd
      ? "- O sistema está em modo migração: conversa que só existe no RD Conversas não conta para nada aqui."
      : "",
    "",
    "COISAS QUE JÁ SÃO AUTOMÁTICAS — não prometa como se fosse mérito seu, mas mencione se perguntarem:",
    "- quem está na lixeira sai;",
    "- quem não tem telefone sai;",
    "- número que já falhou com erro permanente do WhatsApp sai;",
    "- quem recebeu template dentro da janela de anti-repetição sai;",
    "- havendo mais elegíveis que a quantidade pedida, entram os mais prioritários",
    "  (urgência do ciclo de compra, tempo parado e ticket).",
  ].filter(Boolean).join("\n");
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
    motor_de_ciclo_ligado: p.ciclo_ativo,
    filtros_aplicados: f,
  });
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
  const [cfg, cartRes] = await Promise.all([
    lerCrmConfig(db),
    db.from("carteira_config").select('slug,"time"').eq("ativo", true).order("slug"),
  ]);

  const canalTpl = b.canal === "cloud" || b.canal === "rd" ? b.canal : null;
  const sys = sistema({
    carteiras: (cartRes.data ?? []).map((c: any) => ({ slug: String(c.slug), time: c.time ?? null })),
    hoje: new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/"),
    canalTpl,
    semRd: modoMigracao(cfg) || !linhasVisiveis(cfg).includes("rd"),
  });

  // O histórico vem da tela e volta para a tela. Guardá-lo aqui exigiria uma
  // tabela e uma limpeza; e o pareamento tool_use/tool_result tem que ser
  // exato, então quem devolve a lista pronta é esta rota — a tela só ecoa.
  const anteriores: Anthropic.MessageParam[] = Array.isArray(b.mensagens)
    ? (b.mensagens as Anthropic.MessageParam[]).slice(-MAX_HISTORICO)
    : [];
  const mensagens: Anthropic.MessageParam[] = [...anteriores, { role: "user", content: texto }];

  const client = new Anthropic({ apiKey: chave });

  let proposta: FiltrosPublico | null = null;
  let resultado: any = null;
  let resposta = "";

  try {
    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      const r = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system: sys,
        tools: [FERRAMENTA],
        messages: mensagens,
      });

      const chamadas = r.content.filter(
        (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
      );
      resposta = r.content.filter((c) => c.type === "text").map((c: any) => c.text).join("\n").trim();

      if (!chamadas.length) break;

      mensagens.push({ role: "assistant", content: r.content as Bloco[] });

      const devolucoes: Anthropic.ToolResultBlockParam[] = [];
      for (const ch of chamadas) {
        // ⚠️ o input chega como JSON já parseado, mas é do MODELO: passa por
        // `lerFiltros` como qualquer coisa que vem da rede, senão um `limite`
        // de 50.000 viraria uma varredura e uma promessa impossível na tela.
        // ⚠️ `canal` NÃO vem do modelo: vem do template que está marcado na
        // tela. Sem isto, o número que o assistente promete na conversa e o
        // número da prévia divergem sempre que o template é da Cloud -- e a
        // divergência só apareceria depois de aplicar. É exatamente o que este
        // desenho existe para impedir (por isso a peneira é uma só).
        const f = lerFiltros({ ...(ch.input as any), canal: canalTpl });
        try {
          const p = await montarPublico(db, f);
          proposta = f;
          resultado = {
            total: p.total, selecionados: p.selecionados.length, cortes: p.cortes,
            porVendedor: p.porVendedor, porCanal: p.porCanal, carteirasUsadas: p.carteirasUsadas,
          };
          devolucoes.push({ type: "tool_result", tool_use_id: ch.id, content: resumoParaModelo(p, f) });
        } catch (e: any) {
          devolucoes.push({
            type: "tool_result", tool_use_id: ch.id, is_error: true,
            content: `falhou ao contar o público: ${e?.message ?? String(e)}`,
          });
        }
      }
      mensagens.push({ role: "user", content: devolucoes });
    }
  } catch (e: any) {
    const st = e?.status ? ` (${e.status})` : "";
    return Response.json({ error: `o assistente não respondeu${st}: ${e?.message ?? String(e)}` }, { status: 502 });
  }

  if (resposta) mensagens.push({ role: "assistant", content: resposta });

  return Response.json({
    texto: resposta || "Não consegui montar isso. Tente descrever o público de outro jeito.",
    // a tela usa isto para desenhar o cartão com o botão Aplicar. Sem proposta,
    // foi só conversa — e a tela não oferece botão nenhum, que é o certo.
    proposta,
    resultado,
    mensagens,
  });
}
