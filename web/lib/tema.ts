// Temas visuais do CRM. "padrao" é a paleta original do board (estilo RD);
// "murano" é o Tema 1 — identidade visual Murano Professional (skill
// murano-brand): vinho #621244, laranja #dd4222 como cor de ação, fundos
// claros #f5edf4. As chaves espelham o objeto RD do board — trocar o tema é
// trocar os valores, nenhum estilo muda de forma.
export type TemaId = "padrao" | "murano";

export type Paleta = {
  bg: string; surface: string; colHeader: string; border: string;
  navy: string; gray: string; grayLight: string;
  cyan: string; cyanSoft: string; wine: string; wineSoft: string; cream: string;
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
  },
};

export const TEMA_KEY = "crm_tema";

export function temaSalvo(): TemaId {
  if (typeof window === "undefined") return "padrao";
  try { return localStorage.getItem(TEMA_KEY) === "murano" ? "murano" : "padrao"; } catch { return "padrao"; }
}

export function salvarTema(t: TemaId) {
  try { localStorage.setItem(TEMA_KEY, t); } catch {}
}
