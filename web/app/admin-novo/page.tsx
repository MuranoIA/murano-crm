import { redirect } from "next/navigation";
import { sessaoAdmin } from "./_dados/servidor";
import { lerPainel } from "./_dados/painel";
import { Painel } from "./Painel";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// O PAINEL ADMINISTRATIVO NOVO (demanda #51 e #52, 29/09/2026).
//
// Pedido do dono, com estas palavras: "crie mais um item no menu, ao lado de
// administração... posteriormente vamos organizando coisas lá". E depois, ao
// pedir as campanhas: "utilize as novas especificações com as quais nós
// construímos o chat-v2".
//
// Então ele segue a spec do v2 e não o /admin de hoje:
//   · SERVER COMPONENT na 1ª carga (spec §2.3) — o que a tela desenha já vai no
//     HTML, sem casca vazia esperando um `fetch` do navegador;
//   · `loading.tsx` com o formato real, para a página fazer streaming;
//   · `_dados/` como porta única de sessão e banco (spec §2.1 e §6);
//   · Tailwind do v2, sem preflight, tokens prefixados.
//
// O que NÃO fiz: mover nada do /admin de hoje para cá. Mover telas que
// funcionam, sem pedido, é a forma mais fácil de quebrar o que ninguém mandou
// mexer — e o dono já disse que vai organizando aos poucos.
// ---------------------------------------------------------------------------
export default async function PaginaAdminNovo() {
  const s = sessaoAdmin();
  // a guarda vale de novo em cada rota de `/api/admin/*`: a tela esconder não é
  // proteção, é cortesia
  if (!s) redirect("/chat-v2");
  const inicial = await lerPainel();
  return <Painel inicial={inicial} />;
}
