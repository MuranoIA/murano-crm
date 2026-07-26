// Papel efetivo a partir do cookie `crm_sessao`. Três tokens:
//   "admin"    -> vê TODAS as carteiras + tem B.I. Conversas / Ranking / Sincronizar / Disparo em massa
//   "home"     -> vê TODAS as carteiras, mas SEM aquelas 4 features (nível intermediário)
//   <slug>     -> vendedor: vê só a própria carteira, também SEM as 4 features
// A tabela `acesso` guarda os papéis QUE o e-mail pode assumir (papeis[]); a troca de papel
// (multi-papel: Romulo=admin|vendedor, Joas=admin|home) reescreve o cookie via /api/trocar-papel.
export type Papel = "admin" | "home" | "vendedor";

export function papelDe(sessao: string | null | undefined): Papel | null {
  if (!sessao) return null;
  if (sessao === "admin") return "admin";
  if (sessao === "home") return "home";
  return "vendedor";
}

// admin e home enxergam todas as carteiras (sem escopo por vendedor).
export const veTudo = (sessao: string | null | undefined): boolean =>
  sessao === "admin" || sessao === "home";

// carteira efetiva do escopo: null = todas (admin/home); senão o slug do vendedor.
export const carteiraDe = (sessao: string | null | undefined): string | null =>
  veTudo(sessao) ? null : (sessao ?? null);

// só admin tem as 4 features restritas (sincronizar, disparo em massa, B.I., ranking).
export const podeAdmin = (sessao: string | null | undefined): boolean => sessao === "admin";

// token de cookie p/ um papel + carteira (usado no login e na troca de papel).
export const tokenDePapel = (papel: Papel, carteira: string | null): string =>
  papel === "admin" ? "admin" : papel === "home" ? "home" : (carteira ?? "");
