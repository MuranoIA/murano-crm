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
] as const;

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

  // Só booleano de verdade. `"false"` (string) é `true` em JS, e um cliente
  // desatualizado mandando string ligaria o mecanismo achando que desligou.
  if (typeof b.ciclo_ativo !== "boolean") {
    return Response.json({ error: "informe ciclo_ativo como true ou false" }, { status: 400 });
  }
  const alvo: boolean = b.ciclo_ativo;

  const sb = sbAdmin();
  const antes = await lerCrmConfig(sb);
  if (antes.ciclo_ativo === alvo) {
    return Response.json({ ok: true, aviso: "já estava assim — nada mudou.", config: antes });
  }

  const { data, error } = await sb.from("crm_config").upsert({
    id: 1,
    ciclo_ativo: alvo,
    atualizado_por: g.email,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "id" }).select("ciclo_ativo,atualizado_por,atualizado_em").single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    ok: true,
    config: data,
    aviso: alvo
      ? "O ciclo volta a aparecer no board, no chat, no disparo em massa e no relatório."
      : "O ciclo saiu do board, do chat, do disparo em massa e do relatório. Quem estiver com a tela aberta vê a mudança na próxima atualização.",
  });
}
