// -----------------------------------------------------------------------------
// Ciclo 2 — conversa parada, sem ninguém perceber. O ciclo de maior risco.
//
// ⚠️ ADAPTAÇÃO DE SEGURANÇA (§5 da definição): o documento manda "revogar token
// ou desconectar o número". NÃO FAÇO ISSO — derruba o atendimento real de 15
// pessoas. Testo o DETECTOR, não a queda: `lib/saudeCanal.ts` dispara pelo
// sintoma "recibo que não volta" (§52), então planto mensagens presas em `wait`
// na conversa do número autorizado, confiro que o alarme acende, e removo.
//
// A janela em que o alarme fica aceso para a equipe é de segundos, e é o preço
// mínimo para saber se o alarme funciona — um alarme nunca testado é decoração.
// -----------------------------------------------------------------------------
import { TEL8_AUTORIZADO, espera } from "../ajuda.mjs";

export const ciclo = "Ciclo 2 — canal caído, e quem avisa";

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(ciclo inteiro)", "⛔", `servidor fora do ar em ${api.BASE}`); return; }

  const { data: linhas } = await db.sb.from("chat_linha")
    .select("phone_number_id").eq("ativo", true).neq("phone_number_id", "rd").limit(1);
  const LINHA = linhas?.[0]?.phone_number_id ?? "1264458800091787";

  const { data: alvos } = await db.sb.from("clientes").select("id,telefone").like("telefone", `%${TEL8_AUTORIZADO}`);
  const ID = (alvos ?? []).find((c) => c.id === "6a66af9224e3f7ae2f1e99a7")?.id ?? alvos?.[0]?.id;
  if (!ID) { t.pular("(ciclo inteiro)", "⛔", "o número autorizado não tem contato no banco"); return; }

  // ------------------------------------------------------------------ passo 1
  t.pular("1. simular queda do canal (revogar token / desconectar número)", "—",
    "RECUSADO por segurança: revogar o token ou desconectar o número derruba o atendimento real de " +
    "15 pessoas e o recebimento de clientes. Testo o detector no passo 2, que é o que interessa saber.");

  // ------------------------------------------------------------------ passo 2
  await t.passo("2. mensagem presa em `wait` acende o alarme de canal mudo", "⛔ (o doc diz que não há alerta)", async () => {
    const linhaEnvioAtiva = (await api.get("/api/funil", api.SESSOES.admin)).json?.saude;
    if (linhaEnvioAtiva === null || linhaEnvioAtiva === undefined) {
      throw new Error(
        "PULAR:`/api/funil` devolveu `saude` nula — `linhaDeEnvio()` leu WHATSAPP_PHONE_NUMBER_ID vazio. " +
        "Suba o servidor com WHATSAPP_PHONE_NUMBER_ID (e SEM WHATSAPP_TOKEN, para que nada possa ser enviado).",
      );
    }

    // estado de partida, para comparar
    const antes = linhaEnvioAtiva;

    // planta 3 presas (PRESAS_GRAVE) com 20 min de idade (> MINUTOS_PRESA=15)
    const criada = new Date(Date.now() - 20 * 60_000).toISOString();
    const ids = [1, 2, 3].map((n) => `wamid.QA_PRESA_${Date.now()}_${n}`);
    for (const id of ids) {
      const { error } = await db.sb.from("mensagens").insert({
        id, cliente_id: ID, enviada_por: "operator", tipo: "mensagem",
        conteudo: "[QA] mensagem plantada para testar o alarme de canal", status: "wait",
        criada_em: criada, linha_id: LINHA,
      });
      if (error) throw new Error(`não consegui plantar a mensagem presa: ${error.message}`);
      db.anotarRastro(`mensagens ${id} (presa de teste)`, async (c) => { await c.from("mensagens").delete().eq("id", id); });
    }

    const r = await api.get("/api/funil", api.SESSOES.admin);
    api.status(r, 200, "GET /api/funil com presas plantadas");
    const s = r.json?.saude;
    api.ok(s, "a rota parou de devolver `saude`");
    api.igual(s.estado, "mudo", `o alarme não acendeu: estado=${s.estado}, presas=${s.presas}`);
    api.ok(s.presas >= 3, `contou ${s.presas} presas, esperava >= 3`);
    api.ok(String(s.titulo ?? "").length > 0, "alarme sem título — não diria nada a quem olha o board");

    return `antes estado="${antes.estado}" · com 3 presas: estado="${s.estado}", ${s.presas} presas, ` +
      `título "${s.titulo}"`;
  });

  // ------------------------------------------------------------------ passo 3
  await t.passo("3. o alarme apaga quando as presas somem (não fica travado aceso)", "✅", async () => {
    // as presas do passo 2 já foram removidas pelo rastro? não — o rastro só roda
    // no fim. Removo aqui para provar que o alarme é função do estado, não um
    // sinalizador que alguém precisa desligar na mão.
    const { error } = await db.sb.from("mensagens").delete().like("id", "wamid.QA_PRESA_%");
    if (error) throw new Error(error.message);
    await espera(300);
    const r = await api.get("/api/funil", api.SESSOES.admin);
    const s = r.json?.saude;
    api.ok(s && s.estado !== "mudo", `o alarme continuou "mudo" depois de remover as presas: ${JSON.stringify(s)}`);
    return `voltou a estado="${s.estado}" — o alarme segue o estado, não fica preso`;
  });

  // ------------------------------------------------------------------ passo 4
  await t.passo("4. o diagnóstico profundo existe e é de admin (rota /api/admin/saude-canal)", "⚠️", async () => {
    const rv = await api.get("/api/admin/saude-canal", api.SESSOES.romulo);
    api.ok(rv.status === 403 || rv.status === 401, `consultor acessou o diagnóstico: HTTP ${rv.status}`);
    const ra = await api.get("/api/admin/saude-canal", api.SESSOES.admin);
    api.ok(ra.status === 200, `admin não acessou o diagnóstico: HTTP ${ra.status} — ${(ra.texto ?? "").slice(0, 160)}`);
    // A parte que fala com a Graph pode falhar sem token local; o que importa é
    // que cada checagem falhe por conta própria, sem derrubar a resposta.
    const j = ra.json ?? {};
    return `consultor ${rv.status} · admin ${ra.status} · chaves: ${Object.keys(j).join(", ").slice(0, 120)}`;
  });

  // ------------------------------------------------------------------ passo 5
  t.pular("5. notificação automática do problema (fora da tela)", "⛔",
    "confirmado como lacuna real, sem execução: o alarme é de TELA (faixa no board e /admin). " +
    "Não há push nem e-mail — se o canal cair de madrugada, ninguém sabe até alguém abrir o sistema. " +
    "Está descrito assim na §52 e continua verdade no código.");
}
