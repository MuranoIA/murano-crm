import { carteiraDe } from "./papel";

// Helpers compartilhados das rotas de Tickets (evita copia por rota).
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Nome de exibicao a partir do e-mail: carteira capitalizada; senao a parte antes do @.
export const nomeDeEmailCarteira = (email: string, carteira: string | null): string =>
  carteira ? cap(carteira) : String(email).split("@")[0];

// Resolve o nome do usuario logado: carteira do cookie (carteiraDe) ou da tabela `acesso`,
// com fallback. `sb` = client supabase (service role).
export async function nomeDoUsuario(
  email: string | undefined,
  sessao: string,
  sb: { from: (table: string) => any },
  fallback = "Usuário",
): Promise<string> {
  if (!email) return fallback;
  let carteira = carteiraDe(sessao);
  const { data } = await sb.from("acesso").select("carteira").eq("email", email).maybeSingle();
  if (data?.carteira) carteira = data.carteira;
  return carteira ? cap(carteira) : email.split("@")[0];
}
