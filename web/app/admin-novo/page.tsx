import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { podeAdmin } from "../../lib/papel";
import { Painel } from "./Painel";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// O PAINEL ADMINISTRATIVO NOVO (demanda #51, 29/09/2026).
//
// Pedido do dono, com estas palavras: "crie mais um item no menu, ao lado de
// administração... posteriormente vamos organizando coisas lá, mas no momento
// coloque a funcionalidade de configurar quem aparece na lista de transferência
// de atendimentos".
//
// Então ele nasce com UMA coisa, e o nome diz que está em construção. O que
// NÃO fiz: mover nada do /admin de hoje para cá. Mover telas que funcionam,
// sem pedido, é a forma mais fácil de quebrar o que ninguém pediu para mexer —
// e o dono já disse que vai organizando aos poucos.
//
// A guarda é a mesma das rotas: `podeAdmin`. Ela também vale no servidor de
// cada rota de `/api/admin/*` — a tela esconder não é proteção, é cortesia.
// ---------------------------------------------------------------------------
export default function PaginaAdminNovo() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) redirect("/?erro=sessao");
  if (!podeAdmin(sessao)) redirect("/chat-v2");
  return <Painel />;
}
