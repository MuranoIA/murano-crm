import { sbAdmin, guardaAdmin, corpo } from "../../../../lib/adminApi";
import { lerCrmConfig, CRM_CONFIG_PADRAO, linhasVisiveis, tudoVisivel } from "../../../../lib/crmConfig";

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
]  as const;

// O seletor de linhas NÃO é um booleano, então não entra na lista acima: é uma
// escolha de conjunto. O texto mora aqui pelo mesmo motivo dos outros — a tela
// não deve inventar a explicação do que o admin está prestes a mudar.
const LINHAS_INFO = {
  rotulo: "Conversas visíveis, por número",
  resumo:
    "Quais números alimentam a classificação dos cards nas 5 colunas do board e a lista do " +
    "chat. Desmarcar um número não apaga nada: as conversas dele continuam no banco e o ETL " +
    "continua trazendo as novas.",
  desliga: [
    "Conversas do número desmarcado na lista do chat, na busca e na thread",
    "Última mensagem, prévia e tempo parado nos cards vindos dele",
    "Os gatilhos que levam esses cards para Negociação e Tentativa de contato",
  ],
  mantem: [
    "A régua das 5 colunas, intacta — só deixa de receber sinal daquele número",
    "A coluna Pedido emitido, que vem da nota fiscal e não da conversa",
    "O ETL, que segue ingerindo o RD normalmente para o banco",
    "O disparo em massa, que continua enxergando o contato real",
  ],
  nota:
    "Sem sinal de conversa, cada cliente cai onde a régua manda: quem está na carteira do " +
    "WinThor vai para Prospecção; quem foi contatado mas o ERP não alcança vai para Ociosos. " +
    "Ninguém some. Medido em 24/08, só com a Murano Professional marcada: 4.091 em " +
    "prospecção, 76 em ociosos, 1 em negociação.",
} as const;

const CHAVES = MECANISMOS.map((m) => m.chave) as readonly string[];

export async function GET() {
  const g = guardaAdmin("ver os interruptores do CRM");
  if (g.erro) return g.erro;

  const sb = sbAdmin();
  const cfg = await lerCrmConfig(sb);

  // `padrao` viaja junto para a tela poder dizer "este é o estado de fábrica"
  // sem repetir a regra do lado do navegador.
  return Response.json({
    "crm-config": {
      config: cfg,
      padrao: CRM_CONFIG_PADRAO,
      mecanismos: MECANISMOS,
      linhas: {
        ...LINHAS_INFO,
        // as linhas vêm de `chat_linha` (§14.1: cadastro em tabela, não lista no
        // código) — ativar uma amanhã a faz aparecer aqui sozinha
        opcoes: cfg.linhas,
        selecionadas: linhasVisiveis(cfg),
        tudo: tudoVisivel(cfg),
      },
    },
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
  const valor = typeof b.valor === "boolean" || Array.isArray(b.valor) ? b.valor : b.ciclo_ativo;

  const sb = sbAdmin();
  const antes = await lerCrmConfig(sb);

  // ---- seletor de linhas: escolha de CONJUNTO, não booleano -----------------
  if (chave === "linhas_visiveis") {
    if (!Array.isArray(valor) || valor.some((v) => typeof v !== "string")) {
      return Response.json({ error: "informe a lista de linhas" }, { status: 400 });
    }
    const ativas = antes.linhas.filter((l) => l.ativo).map((l) => l.phone_number_id);
    const escolhidas = ativas.filter((id) => valor.includes(id));   // ignora id desconhecido

    // Zero linhas deixaria o board inteiro em prospecção/ociosos sem nada na
    // tela explicando por quê. Se um dia esse for o desenho desejado, ele é
    // outro interruptor ("fonte do board"), não um efeito colateral daqui.
    if (!escolhidas.length) {
      return Response.json({ error: "marque ao menos um número" }, { status: 400 });
    }

    // Tudo marcado grava NULO, não a lista: com a lista congelada, ativar uma
    // linha nova amanhã a deixaria invisível até alguém lembrar de marcá-la.
    const novo = escolhidas.length === ativas.length ? null : escolhidas;
    const { data, error } = await sb.from("crm_config").upsert({
      id: 1, linhas_visiveis: novo,
      atualizado_por: g.email, atualizado_em: new Date().toISOString(),
    }, { onConflict: "id" }).select("ciclo_ativo,linhas_visiveis,atualizado_por,atualizado_em").single();
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const nomes = antes.linhas.filter((l) => escolhidas.includes(l.phone_number_id)).map((l) => l.rotulo);
    return Response.json({
      ok: true,
      config: data,
      aviso: novo === null
        ? "Todos os números voltaram a aparecer no board e no chat."
        : `Board e chat passam a enxergar só: ${nomes.join(", ")}. Os demais clientes caem em Prospecção e Ociosos. Quem estiver com a tela aberta vê na próxima atualização.`,
    });
  }

  if (!CHAVES.includes(chave)) {
    return Response.json({ error: "mecanismo desconhecido" }, { status: 400 });
  }
  // Só booleano de verdade. `"false"` (string) é `true` em JS, e um cliente
  // desatualizado mandando string ligaria o mecanismo achando que desligou.
  if (typeof valor !== "boolean") {
    return Response.json({ error: "informe o valor como true ou false" }, { status: 400 });
  }

  if ((antes as any)[chave] === valor) {
    return Response.json({ ok: true, aviso: "já estava assim — nada mudou.", config: antes });
  }

  const { data, error } = await sb.from("crm_config").upsert({
    id: 1,
    [chave]: valor,
    atualizado_por: g.email,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: "id" }).select("ciclo_ativo,linhas_visiveis,atualizado_por,atualizado_em").single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const avisos: Record<string, { on: string; off: string }> = {
    ciclo_ativo: {
      on: "O ciclo volta a aparecer no board, no chat, no disparo em massa e no relatório.",
      off: "O ciclo saiu do board, do chat, do disparo em massa e do relatório.",
    },
  };
  const a = avisos[chave];

  return Response.json({
    ok: true,
    config: data,
    aviso: `${valor ? a.on : a.off} Quem estiver com a tela aberta vê a mudança na próxima atualização.`,
  });
}
