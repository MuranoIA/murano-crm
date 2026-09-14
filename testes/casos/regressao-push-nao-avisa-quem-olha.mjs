// -----------------------------------------------------------------------------
// Regressão — o push do hub NÃO toca para quem está olhando a tela.
//
// Por que o push do hub existe: em iframe cross-origin o navegador responde
// `Notification.permission = "denied"` ANTES de qualquer pergunta. Medido em
// 14/09/2026, com a permissão no estado "nunca decidiu":
//
//   topo, sem iframe        default   (dá para perguntar)
//   iframe de mesma origem  default   (dá para perguntar)
//   iframe CROSS-ORIGIN     denied
//
// O botão que mora dentro do chat nunca teve chance para quem entra pelo hub —
// e a prova estava no banco, onde as duas únicas inscrições eram de quem abre o
// CRM direto. Daí a `hub_push_inscricao` (0134), registrada no documento de
// topo e entregue pelo mesmo webhook de sempre.
//
// ⚠️ O QUE ESTE CASO MEDE é a regra que decide se a notificação vale: a aba do
// hub carimba `visto_em` enquanto está à frente, e a entrega pula quem carimbou
// há menos de 90s. Errar para o lado do silêncio é o caminho curto para a
// equipe desligar os avisos e perder também os que importam.
//
// ⚠️ E mede a SINTAXE do filtro, não a aritmética. O risco real está no
// `or(visto_em.is.null,visto_em.lt.<corte>)`: um `lt` sozinho descartaria em
// silêncio a inscrição recém-criada, que ainda tem `visto_em` nulo — a pessoa
// ligaria os avisos e nunca receberia nenhum. Por isso o caso roda contra o
// PostgREST de verdade, e não contra uma função pura.
// -----------------------------------------------------------------------------

export const ciclo = "Regressão — push do hub não avisa quem está com a tela na frente";

/** O mesmo valor de `JANELA_DO_BATIMENTO_MS` em web/lib/chatPush.ts. */
const JANELA_MS = 90_000;

/** Fora de qualquer faixa de cliente: isto não é conversa, é inscrição. */
const USUARIO = "ensaio-push@exemplo.invalido";

export default async function (t) {
  const { db } = t;

  const agora = Date.now();
  const casos = [
    { rot: "olhando a tela agora",        atras: 5_000,   esperado: false },
    { rot: "olhou há 80s (dentro dos 90)", atras: 80_000,  esperado: false },
    { rot: "olhou há 5 min",               atras: 300_000, esperado: true  },
    { rot: "nunca carimbou (visto_em nulo)", atras: null,  esperado: true  },
  ];

  await t.passo("1. quatro inscrições de ensaio, em estados diferentes de batimento", "✅", async () => {
    await db.sb.from("hub_push_inscricao").delete().eq("usuario", USUARIO);
    db.anotarRastro(`inscrições de push de ensaio (${USUARIO})`, async (c) => {
      await c.from("hub_push_inscricao").delete().eq("usuario", USUARIO);
    });

    for (let i = 0; i < casos.length; i++) {
      const { error } = await db.sb.from("hub_push_inscricao").insert({
        usuario: USUARIO,
        // endpoint inválido de propósito: este caso mede a ESCOLHA de quem
        // avisar, não a entrega. Nada aqui chega a servidor de push nenhum.
        endpoint: `https://ensaio.invalido/push/${i}`,
        p256dh: "ensaio", auth: "ensaio",
        aparelho: casos[i].rot,
        visto_em: casos[i].atras === null ? null : new Date(agora - casos[i].atras).toISOString(),
      });
      if (error) throw new Error(`não consegui inserir "${casos[i].rot}": ${error.message}`);
    }
    return `${casos.length} inscrições criadas`;
  });

  await t.passo("2. a entrega pula quem está com a tela na frente e alcança o resto", "⚠️", async () => {
    const corte = new Date(Date.now() - JANELA_MS).toISOString();
    const { data, error } = await db.sb
      .from("hub_push_inscricao")
      .select("aparelho")
      .in("usuario", [USUARIO])
      .or(`visto_em.is.null,visto_em.lt.${corte}`);

    if (error) throw new Error(`o filtro do batimento não compila no PostgREST: ${error.message}`);

    const veio = new Set((data ?? []).map((r) => r.aparelho));
    const erradas = casos.filter((c) => veio.has(c.rot) !== c.esperado);
    if (erradas.length) {
      const detalhe = erradas
        .map((c) => `${c.rot}: esperava ${c.esperado ? "avisar" : "pular"}, ${veio.has(c.rot) ? "avisou" : "pulou"}`)
        .join(" | ");
      throw new Error(detalhe);
    }
    return `${veio.size} de ${casos.length} seriam avisadas — as duas que estão olhando a tela ficaram de fora`;
  });
}
