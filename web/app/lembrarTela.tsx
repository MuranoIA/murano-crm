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

const HORAS = 8; // mesma validade do crm_sessao: a memória não sobrevive à sessão

export default function LembrarTela() {
  // usePathname (e não useSearchParams) porque este componente mora no layout
  // raiz: useSearchParams ali exigiria Suspense e afetaria toda página. A query
  // real é lida do window, que já está certa quando o efeito roda.
  const caminho = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tela = window.location.pathname + window.location.search;

    // `embed=1` é o /chat DENTRO da lupa do board (um iframe nosso, na nossa
    // origem). Se ele gravasse, a lupa venceria o board que a hospeda e a
    // volta do SSO cairia numa conversa em tela cheia e sem a navegação do
    // produto — que é justamente o que o modo embutido esconde.
    if (/[?&]embed=1(&|$)/.test(window.location.search)) return;

    // rotas que não são "onde eu estava trabalhando"
    if (/^\/(auth|api|privacidade|termos)(\/|$)/.test(window.location.pathname)) return;

    const seguro = window.location.protocol === "https:";
    try {
      document.cookie =
        `crm_tela=${encodeURIComponent(tela)}; path=/; max-age=${HORAS * 3600}` +
        (seguro ? "; SameSite=None; Secure" : "; SameSite=Lax");
    } catch {
      // cookie bloqueado (navegador com bloqueio total de terceiros): a volta
      // do SSO continua caindo no board, como sempre caiu. Degrada, não quebra.
    }
  }, [caminho]);

  return null;
}
