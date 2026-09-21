// ---------------------------------------------------------------------------
// A BARRA DO PRODUTO — os itens de navegação que o funil e o chat mostram.
//
// Mora num arquivo próprio pelo motivo que `MenuSecundario.tsx` já registra:
// duas listas de menu divergem no primeiro item novo, e a divergência aparece
// como "no chat tem, no funil não". Foi exatamente o relato de 14/09/2026 —
// quem estava no chat não via Orçamento nem Templates.
//
// ⚠️ HOJE AINDA HÁ CÓPIAS: `app/chat/page.tsx` e `app/page.tsx` têm a sua,
// inline. Este arquivo nasce para o chat-v2 porque a frente não pode editar o
// chat antigo (CLAUDE.md §73.2) e duas outras frentes estão no `page.tsx` agora.
// A cópia do chat antigo some sozinha na fase 7, quando aquele arquivo for
// removido; o funil deve passar a importar daqui no mesmo movimento. **Até lá,
// item novo entra nos três lugares** — o que é exatamente o custo que um
// arquivo só existe para acabar, e por isso tem prazo.
//
// `acao` existe porque nem todo item é link: Orçamento abre um PAINEL
// FLUTUANTE, não uma rota. Um link para `/orcamento` levaria à página cheia e
// tiraria o consultor da conversa — o oposto do que um orçamento durante o
// atendimento pede.
// ---------------------------------------------------------------------------

export type ItemNav = {
  href: string;
  rotulo: string;
  /** só quem tem papel `admin` vê */
  soAdmin?: boolean;
  acao?: "orcamento";
};

export const NAV: ItemNav[] = [
  { href: "/", rotulo: "Funil" },
  { href: "/chat", rotulo: "💬 Chat" },
  { href: "#orcamento", rotulo: "Orçamento", acao: "orcamento" },
  { href: "/analises", rotulo: "Análises", soAdmin: true },
  { href: "/templates", rotulo: "Templates" },
  { href: "/admin", rotulo: "⚙️ Administração", soAdmin: true },
];

/** Os indicadores de atendimento: fora da barra, mas a um clique de quem atende. */
export const INDICADORES = {
  href: "/chat/indicadores",
  rotulo: "📊 Indicadores",
  dica: "Tempo de resposta e encerramentos por vendedor",
};

export const itensDoPapel = (papel: string | null | undefined) =>
  NAV.filter((n) => !n.soAdmin || papel === "admin");
