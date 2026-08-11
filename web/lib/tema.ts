// Temas visuais do CRM. "padrao" é a paleta original do board (estilo RD);
// "murano" é o Tema 1 — identidade visual Murano Professional (skill
// murano-brand): vinho #621244, laranja #dd4222 como cor de ação, fundos
// claros #f5edf4; "escuro" é o Dark — tokens do CSS de produção do murano-app
// (--color-murano-*, ver src/app/globals.css do hub), recalculado em
// 11/08/2026 pra bater 1:1 com o hub (fundo em gradiente, borda translúcida,
// fonte Inter carregada de verdade em app/layout.tsx) — ver comentário na
// definição de `escuro` abaixo pros dois ajustes que não são token literal.
// As chaves espelham o objeto RD do board — trocar o tema é trocar os valores,
// nenhum estilo muda de forma.
export type TemaId = "padrao" | "murano" | "escuro";

export type Paleta = {
  bg: string; surface: string; colHeader: string; border: string;
  navy: string; gray: string; grayLight: string;
  cyan: string; cyanSoft: string; wine: string; wineSoft: string; cream: string;
  // fundos especiais de card (aguardando resposta / recontato) — no tema escuro
  // não podem ser os tons claros fixos, senão texto claro some no fundo claro
  aguardaBg: string; aguardaBorda: string; aguardaTexto: string; recontatoBg: string; recontatoBorda: string;
  // Chips/badges semânticos que ATÉ 11/08/2026 eram hex fixo espalhado pelo
  // arquivo, sem passar pelo tema — inofensivo nos temas claros (o pastel
  // combina com fundo claro), mas no "escuro" virava um monte de pílulas
  // pastel-claras brigando com o fundo quase preto (o problema real por trás
  // do "sem harmonia" apontado depois do primeiro recálculo do Dark).
  // padrao/murano usam exatamente os hex de sempre (zero mudança visual);
  // escuro usa uma paleta bem mais contida, no espírito do Gestão de Ofertas
  // (poucos matizes, um só de destaque por vez) e da regra do próprio hub de
  // "laranja/verde marca UM número por tela, não vira cor de fundo em massa"
  // (CLAUDE.md do hub, seção 6): a maioria dos chips no escuro vira neutro
  // (tom de texto/pearl), só o número de faturamento (o "destaque da tela")
  // guarda uma cor própria.
  infoBg: string; infoBorda: string; infoTexto: string;
  successBg: string; successBorda: string; successTexto: string;
  autoBg: string; autoBorda: string; autoTexto: string;
  avisoBg: string; avisoBorda: string; avisoTexto: string;
};

export const TEMAS: Record<TemaId, Paleta> = {
  padrao: {
    bg: "#eef0f4",
    surface: "#ffffff",
    colHeader: "#eae5f2",
    border: "#d3dae5",
    navy: "#111d33",
    gray: "#616b79",
    grayLight: "#7d8695",
    cyan: "#0ea3dc",
    cyanSoft: "#daeffb",
    wine: "#57163f",
    wineSoft: "#efe6eb",
    cream: "#e7d7dc",
    aguardaBg: "#fffdf5",
    aguardaBorda: "#f3ddad",
    aguardaTexto: "#b76e00",
    recontatoBg: "#fdf7fb",
    recontatoBorda: "#ecdae4",
    infoBg: "#eaf6fd", infoBorda: "#bfe6f8", infoTexto: "#0b7fb0",
    successBg: "#e7f6ec", successBorda: "#bfe6cd", successTexto: "#15803d",
    autoBg: "#f8e6ec", autoBorda: "#ecc6d2", autoTexto: "#9c1f47",
    avisoBg: "#fff3e0", avisoBorda: "#f0c987", avisoTexto: "#b45309",
  },
  murano: {
    bg: "#f5edf4",        // --murano-light
    surface: "#ffffff",
    colHeader: "#eddfe9",
    border: "#e0cfdb",
    navy: "#241327",      // --murano-black (texto principal)
    gray: "#6f5c6d",
    grayLight: "#9a8098", // --murano-muted
    cyan: "#dd4222",      // --murano-orange: cor de ação/destaque no Tema 1
    cyanSoft: "#fbe2da",
    wine: "#621244",      // --murano-wine
    wineSoft: "#f3e4ee",
    cream: "#e4d4d3",     // --murano-blush
    aguardaBg: "#fffdf5",
    aguardaBorda: "#f3ddad",
    aguardaTexto: "#b76e00",
    recontatoBg: "#fdf7fb",
    recontatoBorda: "#ecdae4",
    // mesmos hex de sempre — os chips nunca seguiram o tema, então "Tema 1"
    // já mostrava esses tons hoje; manter idêntico evita mudar algo que
    // ninguém pediu pra mudar.
    infoBg: "#eaf6fd", infoBorda: "#bfe6f8", infoTexto: "#0b7fb0",
    successBg: "#e7f6ec", successBorda: "#bfe6cd", successTexto: "#15803d",
    autoBg: "#f8e6ec", autoBorda: "#ecc6d2", autoTexto: "#9c1f47",
    avisoBg: "#fff3e0", avisoBorda: "#f0c987", avisoTexto: "#b45309",
  },
  // Recalculado em 11/08/2026 pra bater com o murano-app de verdade, não só
  // "parecido": os valores abaixo saem 1:1 de src/app/globals.css do hub
  // (--color-murano-*) sempre que existe token equivalente. Dois ajustes
  // deliberados que NAO sao token literal, com o motivo registrado porque
  // senao parece descuido:
  // 1) `border` e `cyanSoft` viraram rgba translucido — a borda do
  //    .murano-card do hub e literalmente `rgba(222,211,214,.1)`, nao um hex
  //    solido; copiar um hex fixo teria ficado mais opaco/pesado que o
  //    original.
  // 2) `wine`, usado tanto como PREENCHIMENTO (avatar, faixa, botao) quanto
  //    como COR DE TEXTO (item de menu ativo) neste arquivo — o hub nunca usa
  //    roxo como texto, so como borda/gradiente/preenchimento, entao nao ha
  //    token "certo" pra copiar pro segundo uso. `--color-murano-purple-soft`
  //    (#8a2a63) puro deu so 2,3:1 de contraste contra o fundo (conta WCAG
  //    feita a mao) — clareado pra #a8447f (mesmo tom, mais luminoso) sobe
  //    pra ~3,4:1. Ainda abaixo do ideal de texto de leitura (4,5:1), mas e
  //    usado em rotulo pequeno em negrito, nao paragrafo, e quase sempre ao
  //    lado de um "✓" que ja reforça o estado sem depender so da cor.
  //
  // Retrabalho de 11/08/2026 (2ª rodada, depois do feedback "sem harmonia"):
  // os chips/badges abaixo (info/success/auto/aviso) antes eram hex fixo
  // pastel-claro (herdado do tema "padrao") aparecendo por cima do fundo
  // escuro — o choque de um monte de pilulas mint-green/rosa-choque/ciano-
  // claro sobre #1c0e1b era a causa real da falta de harmonia, não só o tom
  // do roxo. Referência usada: o app Gestão de Ofertas (murano-deals-hub) e
  // o próprio shadcn/ui de lá — quase tudo em tons neutros/translúcidos da
  // MESMA família (pearl/azul/roxo), com UMA cor de destaque só onde
  // realmente importa. Aqui isso virou: "info" (contadores neutros,
  // ativo/sincronizado) e "auto" (automático) ficam dentro da família
  // azul/roxo que o resto do tema já usa — zero matiz novo. "success"
  // (faturamento — o número mais importante da tela) é a ÚNICA cor extra
  // deliberada, seguindo a regra do próprio hub de "uma cor de destaque por
  // tela, não em massa" (CLAUDE.md do hub, seção 6, sobre o laranja no
  // Consulta Clientes). "aviso" (sincronização pausada/falhou) é a outra
  // exceção aceitável — aviso genuíno deve continuar visualmente diferente
  // de "tudo normal".
  escuro: {
    bg: "#1c0e1b",        // --color-murano-dark
    surface: "#241327",   // --color-murano-black (base do .murano-card do hub)
    colHeader: "#2e1730", // um degrau acima do surface — mantido do calculo original
    border: "rgba(222, 211, 214, 0.12)", // borda do .murano-card (.1) + leve reforço p/ contexto de board
    navy: "#ded3d6",      // --color-murano-pearl, texto principal
    gray: "rgba(222, 211, 214, 0.68)", // mesma opacidade do texto secundario em .murano-note
    grayLight: "#9a9aa5", // --color-murano-gray (token oficial, nao mais um palpite)
    cyan: "#2f7fd4",      // --color-murano-blue, acao/ativo (token oficial)
    cyanSoft: "rgba(47, 127, 212, 0.14)", // mesma familia de wash de .murano-note (fundo rgba(47,127,212,.08))
    wine: "#a8447f",      // ver nota acima — clareado a partir do purple-soft por legibilidade como texto
    wineSoft: "rgba(138, 42, 99, 0.16)", // wash de purple-soft, mesma logica do cyanSoft
    cream: "#f4e9f0",     // texto claro sobre preenchimento solido de wine (avatar, badge)
    aguardaBg: "#33260f", // âmbar escuro (aguardando resposta) — sem token no hub, mantido
    aguardaBorda: "#5c4415",
    aguardaTexto: "#e0a458", // mesmo tom de avisoTexto — mesma familia ambar, legivel no escuro
    recontatoBg: "#331a2f", // vinho escuro (recontatar)
    recontatoBorda: "rgba(138, 42, 99, 0.35)",
    // "info" = mesma familia azul (acao/ativo) que RD.cyan/cyanSoft ja usam
    infoBg: "rgba(47, 127, 212, 0.14)", infoBorda: "rgba(47, 127, 212, 0.4)", infoTexto: "#2f7fd4",
    // "success" (faturamento) = unica cor extra deliberada, o destaque da tela
    successBg: "rgba(34, 197, 94, 0.14)", successBorda: "rgba(34, 197, 94, 0.4)", successTexto: "#4ade80",
    // "auto" (automatico) = familia roxo/marca (RD.wine/wineSoft), nao um rosa a parte
    autoBg: "rgba(138, 42, 99, 0.16)", autoBorda: "rgba(138, 42, 99, 0.4)", autoTexto: "#a8447f",
    // "aviso" = ambar contido, so pra estado genuinamente anormal (pausado/falhou)
    avisoBg: "rgba(217, 119, 6, 0.16)", avisoBorda: "#c98a3a", avisoTexto: "#e0a458",
  },
};

export const TEMA_KEY = "crm_tema";

export function temaSalvo(): TemaId {
  if (typeof window === "undefined") return "padrao";
  try {
    const t = localStorage.getItem(TEMA_KEY);
    return t === "murano" || t === "escuro" ? t : "padrao";
  } catch { return "padrao"; }
}

export function salvarTema(t: TemaId) {
  try { localStorage.setItem(TEMA_KEY, t); } catch {}
}
