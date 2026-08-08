// Temas visuais do CRM. "padrao" é a paleta original do board (estilo RD);
// "murano" é o Tema 1 — identidade visual Murano Professional (skill
// murano-brand): vinho #621244, laranja #dd4222 como cor de ação, fundos
// claros #f5edf4; "escuro" é o Dark — tokens extraídos do CSS de produção de
// app.muranoprofessional.com.br (--color-murano-*): fundo #1c0e1b/#241327,
// texto pearl #ded3d6, azul #2f7fd4 como ação, roxos #621244/#8a2a63/#3d0b2a.
// As chaves espelham o objeto RD do board — trocar o tema é trocar os valores,
// nenhum estilo muda de forma.
export type TemaId = "padrao" | "murano" | "escuro";

export type Paleta = {
  bg: string; surface: string; colHeader: string; border: string;
  navy: string; gray: string; grayLight: string;
  cyan: string; cyanSoft: string; wine: string; wineSoft: string; cream: string;
  // fundos especiais de card (aguardando resposta / recontato) — no tema escuro
  // não podem ser os tons claros fixos, senão texto claro some no fundo claro
  aguardaBg: string; aguardaBorda: string; recontatoBg: string; recontatoBorda: string;
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
    recontatoBg: "#fdf7fb",
    recontatoBorda: "#ecdae4",
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
    recontatoBg: "#fdf7fb",
    recontatoBorda: "#ecdae4",
  },
  escuro: {
    bg: "#1c0e1b",        // fundo do app (theme-color de produção)
    surface: "#241327",   // cards/top bar (gradiente escuro do app)
    colHeader: "#301631", // cabeçalho de coluna: um degrau acima do surface
    border: "#432a45",
    navy: "#ded3d6",      // texto principal = --color-murano-pearl
    gray: "#b3a4b1",
    grayLight: "#9a8fa0", // ~--color-murano-gray com o tom do fundo
    cyan: "#2f7fd4",      // ação/ativo = --color-murano-blue (token oficial)
    cyanSoft: "#15304d",
    wine: "#8a2a63",      // acento = --color-murano-purple-soft (legível no escuro)
    wineSoft: "#3d0b2a",  // --color-murano-purple-deep
    cream: "#ded3d6",
    aguardaBg: "#33260f", // âmbar escuro (aguardando resposta)
    aguardaBorda: "#5c4415",
    recontatoBg: "#331a2f", // vinho escuro (recontatar)
    recontatoBorda: "#54305b",
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
