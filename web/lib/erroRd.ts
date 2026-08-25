// Tradução dos erros da API do RD Conversas para algo que o vendedor possa agir.
//
// Motivo (25/08/2026): o usuário tentou falar com um contato e a tela mostrou só
// **"RD 429"**. Ele leu como "o sistema não permitiu falar com esse número" —
// quando era a cota da API estourada, que passa sozinha em um minuto. Erro que
// não diz o que fazer vira diagnóstico errado, e diagnóstico errado vira pedido
// de mudança na coisa errada.
//
// Mesma lição da §22.6.1, no lado da Meta: perder o texto do erro custou horas.
// Aqui o texto nem existia.

export type ErroRd = { erro: string; podeTentarDeNovo: boolean; sugereOutroCanal: boolean };

export function traduzErroRd(status: number, corpo: any): ErroRd {
  const doRd = String(corpo?.message ?? corpo?.error ?? "").trim();

  // 429 — a cota do RD (~48 req/min, §14.5) é COMPARTILHADA com o ETL. Já houve
  // 5 tentativas com backoff antes de chegar aqui, então insistir na hora não
  // resolve: ou se espera, ou se manda pelo outro número.
  if (status === 429) {
    return {
      erro: "O RD Conversas está sem cota no momento — ele divide o mesmo limite com a sincronização. "
          + "Tente de novo em um minuto, ou mude o número de envio em Administração → Mecanismos.",
      podeTentarDeNovo: true,
      sugereOutroCanal: true,
    };
  }

  // 404 — o contato não existe NO RD. Acontece com quem nasceu do nosso lado
  // (webhook da Cloud ou botão + do chat): o RD nunca soube dele.
  if (status === 404) {
    return {
      erro: "O RD Conversas não conhece este contato — ele existe só no nosso banco. "
          + "Para falar com ele, use o Murano Professional.",
      podeTentarDeNovo: false,
      sugereOutroCanal: true,
    };
  }

  if (status === 401 || status === 403) {
    return {
      erro: "O RD Conversas recusou nossas credenciais. O token pode ter sido trocado — avise quem cuida da integração.",
      podeTentarDeNovo: false,
      sugereOutroCanal: true,
    };
  }

  if (status >= 500) {
    return {
      erro: `O RD Conversas está instável (${status})${doRd ? ` — ${doRd}` : ""}. Tente de novo em instantes.`,
      podeTentarDeNovo: true,
      sugereOutroCanal: true,
    };
  }

  // Demais casos: o texto do RD é a melhor pista que existe; o código sozinho
  // não é. Só cai no genérico quando ele não manda nada.
  return {
    erro: doRd || `O RD Conversas recusou o envio (${status}).`,
    podeTentarDeNovo: false,
    sugereOutroCanal: false,
  };
}
