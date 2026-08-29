"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Guarda, num cookie, a última tela do CRM em que a pessoa estava.
 *
 * Existe por causa de um caso só, mas que dói todo dia: dentro do hub
 * (murano-app) o CRM roda num <iframe> cujo `src` é o link de SSO
 * (`/auth/hub-sso?token=…`). Recarregar a página do hub recarrega esse `src`,
 * e a rota de SSO sempre mandava para `/` — quem estava atendendo no /chat
 * voltava para o board, que refaz a consulta de milhares de cards. O
 * navegador não tem como saber onde a pessoa estava: para ele, o iframe
 * acabou de nascer. Este cookie é essa memória.
 *
 * Cookie, e não sessionStorage, porque quem precisa da informação é o
 * SERVIDOR (a rota de SSO decide o destino do redirect antes de qualquer JS
 * rodar). Não é httpOnly de propósito: quem escreve é esta tela.
 *
 * O `SameSite=None; Secure` é a mesma exigência do `crm_sessao` — dentro do
 * iframe do hub o documento de topo é outro site, e sem isso o navegador
 * descarta o cookie por ser de terceiro. Fora de https (dev local) o par
 * None/Secure é inválido e o cookie seria recusado; ali vale `Lax`, que
 * basta porque não há iframe de outro site no meio.
 */

const HORAS = 8; // mesma validade do crm_sessao: a memoria nao sobrevive a sessao

/**
 * Grava a tela atual no cookie. Exportada porque a troca de conversa no /chat
 * nao e uma navegacao: o React so troca o estado, o `usePathname` nao muda e o
 * efeito abaixo nunca rodaria. Aquela tela reescreve a URL (`?cliente=`) e
 * chama isto na mao — sem esta funcao a volta do SSO acertaria o /chat e
 * erraria a conversa, que foi o primeiro relato depois do conserto.
 */
export function lembrarTelaAtual() {
  if (typeof window === "undefined") return;

  // `embed=1` e o /chat DENTRO da lupa do board (um iframe nosso, na nossa
  // origem). Se ele gravasse, a lupa venceria o board que a hospeda e a volta
  // do SSO cairia numa conversa em tela cheia e sem a navegacao do produto —
  // que e justamente o que o modo embutido esconde.
  if (/[?&]embed=1(&|$)/.test(window.location.search)) return;

  // rotas que nao sao "onde eu estava trabalhando"
  if (/^\/(auth|api|privacidade|termos)(\/|$)/.test(window.location.pathname)) return;

  const tela = window.location.pathname + window.location.search;
  const seguro = window.location.protocol === "https:";
  try {
    document.cookie =
      `crm_tela=${encodeURIComponent(tela)}; path=/; max-age=${HORAS * 3600}` +
      (seguro ? "; SameSite=None; Secure" : "; SameSite=Lax");
  } catch {
    // cookie bloqueado (navegador com bloqueio total de terceiros): a volta do
    // SSO continua caindo no board, como sempre caiu. Degrada, nao quebra.
  }
}

export default function LembrarTela() {
  // usePathname (e nao useSearchParams) porque este componente mora no layout
  // raiz: useSearchParams ali exigiria Suspense e afetaria toda pagina. A query
  // real e lida do window dentro de `lembrarTelaAtual`, que ja esta certa
  // quando o efeito roda.
  const caminho = usePathname();
  useEffect(() => { lembrarTelaAtual(); }, [caminho]);
  return null;
}
