import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { VIEW_FUNIL_TELA } from "../../../../lib/crmConfig";
import { semEnsaio } from "../../../../lib/ensaio";
import { escopoCarteira } from "../../../../lib/verComo";

export const dynamic = "force-dynamic";

/**
 * PRÉVIAS DO CARD — as 3 últimas mensagens, só dos cards que a pessoa está vendo.
 *
 * Por que esta rota existe
 * -----------------------
 * `vw_funil_visivel.ultimas_mensagens` é um lateral join em `mensagens` que
 * busca as 3 últimas de cada cliente. O laudo (`prototipos/laudo-performance.md`
 * §2) mediu o custo dela, com mediana de 7 rodadas intercaladas sobre a mesma
 * página de 1000 linhas:
 *
 *     sem a coluna    625 ms
 *     com a coluna  1.302 ms   (+677 ms por página, 2,1x)
 *
 * O board pagina 5 vezes: **~2,8 s de trabalho do Postgres por carregamento**,
 * multiplicado por toda aba aberta. E o que isso entrega na tela são 3 bolhas
 * cortadas em 2 linhas pelo CSS — o banco transporta mensagens de até 597
 * caracteres para a tela mostrar ~120, e só nos cards que a pessoa olhar.
 *
 * Duas saídas foram MEDIDAS E DESCARTADAS antes desta (§2 do laudo): não é falta
 * de índice (o índice existe e responde em 170 ms; o custo é fazer mil buscas,
 * não fazer uma mal), e não adianta calcular só para quem tem conversa — das
 * 4.232 linhas só 1.130 têm, e cortar as outras economizou **18 ms (3%)**,
 * porque o custo mora justamente nas que têm.
 *
 * O que corta o custo é pedir MENOS LINHAS. O board já desenha ~400 cards mas a
 * pessoa vê algumas dezenas: o `IntersectionObserver` do front junta os ids que
 * entraram na tela e pede aqui. 100 linhas ≈ 70 ms contra 4.232 ≈ 2,8 s.
 *
 * ⚠️ Isto ADIA o trabalho, mas não o adia todo: só chega aqui o card que alguém
 * olhou. Quem rolar o board inteiro paga o custo antigo em fatias — e ninguém
 * rola 4.232 cards.
 */

/**
 * Teto de ids por chamada. O front lotea; este número existe para uma chamada
 * forjada não pedir o board inteiro por uma porta que foi aberta justamente
 * para pedir pouco.
 */
const TETO = 150;

export async function GET(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  // Mesma régua do `/api/funil`: admin e home veem tudo, vendedor vê só a
  // própria carteira. A prévia é CONTEÚDO DE MENSAGEM — se o escopo ficasse só
  // no front, bastaria forjar um id para ler a conversa de outra carteira.
  const carteira = escopoCarteira();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes" }, { status: 500 });
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const bruto = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(bruto.split(",").map((s) => s.trim()).filter(Boolean))]
    // Card sintético do ERP não tem conversa: `winthor:<codcli>` é fila de
    // prospecção e `venda:<codcli>` é nota fiscal. Pedi-los seria uma ida ao
    // banco garantidamente vazia.
    .filter((id) => !/^(winthor|venda):/.test(id))
    .slice(0, TETO);
  if (!ids.length) return Response.json({ previas: {} });

  // A leitura é da MESMA view do board, não de `mensagens` direto. A view já
  // aplica a visibilidade por número (§32.5) e o recorte de `evento_sistema`;
  // reimplementar isso aqui criaria uma segunda régua que divergiria da
  // primeira no dia seguinte — e o sintoma seria a prévia do card citar uma
  // mensagem que a tela esconde.
  let q = semEnsaio(sb.from(VIEW_FUNIL_TELA).select("cliente_id,ultimas_mensagens"))
    .in("cliente_id", ids);
  if (carteira) q = q.eq("vendedor", carteira);

  const { data, error } = await q;
  if (error) {
    // Coluna ausente (migration pendente) não pode derrubar o board: o card
    // continua com a prévia de UMA linha que já veio no payload do `/api/funil`.
    if (/ultimas_mensagens/.test(error.message)) return Response.json({ previas: {} });
    return Response.json({ error: error.message }, { status: 500 });
  }

  const previas: Record<string, any[]> = {};
  for (const r of (data ?? []) as any[]) {
    if (r.cliente_id) previas[r.cliente_id] = r.ultimas_mensagens ?? [];
  }
  // Id pedido e não devolvido (fora do escopo, ou sem mensagem) entra como
  // lista VAZIA de propósito: assim o front sabe que já perguntou e não fica
  // repetindo a pergunta a cada rolagem.
  for (const id of ids) if (!(id in previas)) previas[id] = [];

  return Response.json({ previas });
}
