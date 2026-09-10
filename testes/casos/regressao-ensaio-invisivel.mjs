// -----------------------------------------------------------------------------
// A faixa de ensaio não pode aparecer para consultor.
//
// 10/09/2026: uma rodada foi interrompida às 11:33 sem limpar. Os 25 clientes
// fictícios ficaram meia hora na sidebar da equipe, que os atendeu como se
// fossem reais — um consultor chegou a responder, e o envio saiu para a Graph
// API pela linha de produção (só não chegou a ninguém porque a Meta recusou o
// número, 131026).
//
// O que este caso vigia: se um dia sobrar lixo de ensaio no banco outra vez —
// e vai sobrar, porque a limpeza depende de um processo que pode morrer —, ele
// **não pode** estar na lista do chat nem no board de quem está atendendo.
//
// ⚠️ Este caso NÃO cria nada. Criar cliente fictício para depois conferir que
// ele some é justamente a manobra que causou o incidente: entre criar e apagar,
// a produção mostra. A verificação é sobre o que já está lá.
// -----------------------------------------------------------------------------
import { get, SESSOES } from "../api.mjs";
import { sb } from "../db.mjs";

export const ciclo = "regressão — a faixa de ensaio é invisível";

const PADRAO = "wa:559190000%";
const ehEnsaio = (id) => String(id ?? "").startsWith("wa:559190000");

export default async function (t) {
  if (!t.servidorNoAr) {
    t.pular("servidor no ar", "✅", "servidor fora do ar");
    return;
  }

  let visivel = null;

  await t.passo("/api/session diz se este servidor mostra o ensaio", "✅", async () => {
    const r = await get("/api/session", SESSOES.admin);
    if (r.status !== 200) throw new Error(`/api/session devolveu ${r.status}`);
    if (typeof r.json?.ensaio_visivel !== "boolean") {
      throw new Error("a rota não devolveu `ensaio_visivel` — o interruptor não está ligado no servidor");
    }
    visivel = r.json.ensaio_visivel;
    return visivel
      ? "servidor DE ENSAIO (ENSAIO_VISIVEL=1): a faixa aparece de propósito"
      : "servidor normal: a faixa está escondida";
  });

  await t.passo("quanto lixo de ensaio existe no banco agora", "✅", async () => {
    const { count, error } = await sb.from("clientes")
      .select("*", { count: "exact", head: true }).like("id", PADRAO);
    if (error) throw new Error(error.message);
    // Sobrar lixo não é falha DESTE caso — é o cenário que ele existe para
    // tornar inofensivo. O número fica no relatório para alguém varrer depois.
    return count ? `⚠️  ${count} cliente(s) de ensaio no banco — limpar` : "nenhum";
  });

  if (visivel) {
    t.pular("a faixa não aparece na lista do chat", "✅",
      "servidor de ensaio: a faixa aparece de propósito (suba sem ENSAIO_VISIVEL para exercitar)");
    t.pular("a faixa não aparece no board", "✅", "idem");
    return;
  }

  await t.passo("a faixa não aparece na lista do chat", "✅", async () => {
    const r = await get("/api/chat", SESSOES.admin);
    if (r.status !== 200) throw new Error(`/api/chat devolveu ${r.status}`);
    // sem `?? []`: se o campo mudar de nome, este caso tem de FALHAR, não
    // passar dizendo "nenhuma conversa de ensaio" sobre uma lista vazia.
    const lista = r.json?.conversas;
    if (!Array.isArray(lista)) throw new Error("/api/chat não devolveu `conversas`");
    const vazados = lista.filter((c) => ehEnsaio(c.cliente_id));
    if (vazados.length) {
      throw new Error(`${vazados.length} conversa(s) de ensaio na lista: ${vazados.slice(0, 3).map((c) => c.cliente_id).join(", ")}`);
    }
    return `${lista.length} conversas, nenhuma de ensaio`;
  });

  await t.passo("a faixa não aparece no board", "✅", async () => {
    const r = await get("/api/funil", SESSOES.admin);
    if (r.status !== 200) throw new Error(`/api/funil devolveu ${r.status}`);
    const cards = r.json?.cards;
    if (!Array.isArray(cards)) throw new Error("/api/funil não devolveu `cards`");
    const vazados = cards.filter((c) => ehEnsaio(c.cliente_id));
    if (vazados.length) {
      throw new Error(`${vazados.length} card(s) de ensaio no board: ${vazados.slice(0, 3).map((c) => c.cliente_id).join(", ")}`);
    }
    return `${cards.length} cards, nenhum de ensaio`;
  });
}
