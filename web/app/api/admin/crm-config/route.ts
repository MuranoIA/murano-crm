import { sbAdmin, guardaAdmin, corpo } from "../../../../lib/adminApi";
import { lerCrmConfig, CRM_CONFIG_PADRAO } from "../../../../lib/crmConfig";

export const dynamic = "force-dynamic";

// Interruptores globais do CRM (`crm_config`, migration 0097). Hoje só o motor
// de ciclo de compra; os próximos mecanismos entram como coluna nova ali e como
// mais um item na lista `MECANISMOS` abaixo.
//
// A tela precisa de mais do que o booleano: precisa dizer O QUE cada chave
// desliga e o que ela NÃO desliga. Um interruptor de mecanismo sem essa lista é
// um botão que ninguém tem coragem de virar — e, virado, ninguém sabe explicar
// o que mudou na tela do vendedor no dia seguinte.

const MECANISMOS = [
  {
    chave: "ciclo_ativo",
    rotulo: "Motor de ciclo de compra",
    resumo:
      "Classificação preditiva de recompra: em que ponto do ciclo o cliente está, " +
      "quão urgente é falar com ele e qual ação sugerir.",
    desliga: [
      "Selo de situação no card do board (Na hora, Atrasado, Expansão, Recuperação, Reativação)",
      "Filtro “Ciclo compra” no cabeçalho do board, incluindo a prioridade “Urgentes (ligar hoje)”",
      "Aba Ciclo e a barra de % do ciclo no painel do contato, dentro do chat",
      "Peso da urgência no ranqueamento do disparo em massa",
      "Colunas de ciclo no Excel do relatório",
    ],
    mantem: [
      "Dias sem comprar, e o filtro “Tempo parado” do board",
      "Ticket médio, total de pedidos e última compra",
      "Valor faturado no mês e a coluna Pedido emitido",
    ],
    nota:
      "Nada é apagado. A tabela wth_ciclo continua sendo atualizada a cada 10 minutos " +
      "pelo sync do WinThor, então religar mostra o dado de agora, não um buraco.",
  },
  {
    chave: "conversas_rd_visiveis",
    rotulo: "Conversas do RD Conversas",
    resumo:
      "As conversas que vieram do RD Conversas alimentam a classificação dos cards nas 5 " +
      "colunas do board e a lista do chat. Desligando, o CRM passa a enxergar só o que " +
      "chegou pelo WhatsApp da Murano Professional.",
    desliga: [
      "Conversas do RD na lista do chat, na busca por conteúdo e na thread",
      "Última mensagem, prévia e “há quanto tempo parado” nos cards do board",
      "Os gatilhos que levam o card para Negociação e Tentativa de contato",
    ],
    mantem: [
      "A régua das 5 colunas, intacta — só deixa de receber sinal do RD",
      "A coluna Pedido emitido, que vem da nota fiscal e não da conversa",
      "O ETL, que segue ingerindo o RD normalmente para o banco",
      "O disparo em massa, que continua enxergando o contato real",
    ],
    nota:
      "Sem sinal de conversa, cada cliente cai onde a régua manda: quem está na carteira do " +
      "WinThor vai para Prospecção; quem foi contatado mas o ERP não alcança vai para Ociosos. " +
      "Ninguém some. Medido em 24/08: 4.091 em prospecção, 75 em ociosos, 2 conversas da Cloud.",
  },
] as const;

const CHAVES = MECANISMOS.map((m) => m.chave) as readonly string[];

export async function GET() {
  const g = guardaAdmin("ver os interruptores do CRM");
  if (g.erro) return g.erro;

  const sb = sbAdmin();
  const cfg = await lerCrmConfig(sb);

  // `padrao` viaja junto para a tela poder dizer "este é o estado de fábrica"
  // sem repetir a regra do lado do navegador.
  return Response.json({
    "crm-config": { config: cfg, padrao: CRM_CONFIG_PADRAO, mecanismos: MECANISMOS },
  });
}

/** Liga ou desliga um mecanismo para TODO MUNDO. */
export async function PUT(req: Request) {
  const g = guardaAdmin("ligar ou desligar um mecanismo do CRM");
  if (g.erro) return g.erro;

  const b = await corpo(req);
  if (!b) return Response.json({ error: "body inválido" }, { status: 400 });

  // Uma chave por chamada: `{chave, valor}`. O formato antigo `{ciclo_ativo}`
  // continua aceito porque uma aba já aberta no navegador de alguém ainda manda
  // assim durante o deploy.
  const chave: string = typeof b.chave === "string" ? b.chave
    : typeof b.ciclo_ativo === "boolean" ? "ciclo_ativo" : "";
  const valor = typeof b.valor === "boolean" ? b.valor : b.ciclo_ativo;

  if (!CHAVES.includes(chave)) {
    return Response.json({ error: "mecanismo desconhecido" }, { status: 400 });
  }
  // Só booleano de verdade. `"false"` (string) é `true` em JS, e um cliente
  // desatualizado mandando string ligaria o mecanismo achando que desligou.
  if (typeof valor !== "boolean") {
    return Response.json({ error: "informe o valor como true ou false" }, { status: 400 });
  }

  const sb = sbAdmin();
  const antes = await lerCrmConfig(sb);
  if ((antes as any)[chave] === valor) {
    return Response.json({ ok: true, aviso: "já estava assim — nada mudou.", config: antes });
  }

  const { data, error } = await sb.from("crm_config").upsert({
    id: 1,
    [chave]: valor,
    atualizado_por: g.email,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "id" }).select("ciclo_ativo,conversas_rd_visiveis,atualizado_por,atualizado_em").single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const avisos: Record<string, { on: string; off: string }> = {
    ciclo_ativo: {
      on: "O ciclo volta a aparecer no board, no chat, no disparo em massa e no relatório.",
      off: "O ciclo saiu do board, do chat, do disparo em massa e do relatório.",
    },
    conversas_rd_visiveis: {
      on: "As conversas do RD voltam a aparecer no board e no chat.",
      off: "O board passa a classificar só pelo WhatsApp da Murano Professional; os demais clientes caem em Prospecção e Ociosos.",
    },
  };
  const a = avisos[chave];

  return Response.json({
    ok: true,
    config: data,
    aviso: `${valor ? a.on : a.off} Quem estiver com a tela aberta vê a mudança na próxima atualização.`,
  });
}
