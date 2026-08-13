import { cookies } from "next/headers";

/**
 * Quem é o usuário logado, para efeito de marca de leitura e de autoria ao
 * resolver conversa.
 *
 * O login por Google grava `crm_email`; o login admin por senha (env) NÃO tem
 * e-mail — nesse caso vale o próprio valor da sessão ("admin", "home", ou o slug
 * da carteira). Sempre devolve string não vazia, ou null se não há sessão.
 */
export function usuarioDaSessao(): string | null {
  const c = cookies();
  const sessao = c.get("crm_sessao")?.value;
  if (!sessao) return null;
  return c.get("crm_email")?.value || sessao;
}
