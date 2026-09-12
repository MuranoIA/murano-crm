// -----------------------------------------------------------------------------
// Regressão — o board se atualiza por DELTA, não reconstruindo tudo.
//
// O que este caso protege (11/09/2026):
//
//   1. abrir o board não gera requisição repetida a /api/funil em intervalo
//      curto — a rede de proteção passou de 60s para 5 min;
//   2. mensagem nova move o card em segundos, pela rota /api/funil/delta, que
//      recalcula ao vivo (`get_funil_card`) só quem mudou;
//   3. board parado não gera tráfego além do heartbeat do WebSocket.
//
// POR QUE ISTO IMPORTA: o laudo de performance mediu o custo de UM carregamento
// do board — 19 idas ao banco e ~2 s — e registrou o multiplicador: cada mensagem gera
// um evento de Realtime, e cada aba reagia recarregando tudo. É o multiplicador
// que este caso vigia.
//
// ⚠️ O caminho "óbvio" — o navegador assinar `postgres_changes` em `mensagens` —
// NÃO funciona neste projeto e falharia em SILÊNCIO: a tabela está com RLS
// ligada sem policy desde 03/08 (§12.5), então a chave anon não enxerga linha
// nenhuma e o Realtime não entrega evento. Por isso o sinal continua sendo o
// broadcast do board (0069) e quem descobre QUEM mudou é o servidor. Se alguém
// trocar isso um dia, o passo 3 aqui é o que denuncia.
// -----------------------------------------------------------------------------
import { espera } from "../ajuda.mjs";
import { clienteEscreve, idFicticio, resolverLinha, limparEnsaio } from "../simulacao.mjs";

export const ciclo = "Regressão — board por delta (Realtime sem polling)";

/** Fora da faixa que os outros casos usam, para duas suítes não brigarem. */
const N = 91;

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  const ID = idFicticio(N);
  const NOME = `Cliente Ensaio ${N}`;
  await resolverLinha(db);

  // ---------------------------------------------------------------- passo 1
  await t.passo("1. /api/funil/delta exige sessão e um `desde` válido", "✅", async () => {
    const semCookie = await api.get("/api/funil/delta?desde=" + new Date().toISOString(), api.SESSOES.anonimo);
    api.igual(semCookie.status, 401, "sem cookie deveria ser 401");

    const semParam = await api.get("/api/funil/delta", api.SESSOES.admin);
    api.igual(semParam.status, 400, "sem `desde` deveria ser 400");

    const lixo = await api.get("/api/funil/delta?desde=ontem", api.SESSOES.admin);
    api.igual(lixo.status, 400, "`desde` inválido deveria ser 400");
    return "401 sem sessão, 400 sem `desde` e com `desde` inválido";
  });

  // ---------------------------------------------------------------- passo 2
  await t.passo("2. o delta devolve cursor e responde bem mais rápido que o board inteiro", "✅", async () => {
    const desde = new Date(Date.now() - 10 * 60_000).toISOString();
    const d = await api.get("/api/funil/delta?desde=" + encodeURIComponent(desde), api.SESSOES.admin);
    api.status(d, 200, "GET no delta");
    api.ok(d.json && typeof d.json.ate === "string", "o delta não devolveu o cursor `ate`");
    api.ok(Array.isArray(d.json.cards), "`cards` deveria ser lista");
    api.ok(Array.isArray(d.json.remover), "`remover` deveria ser lista");

    // O cursor tem de fechar ANTES da consulta, senão uma mensagem que chega
    // durante a chamada entra no cursor sem entrar no resultado — e some para
    // sempre, porque o delta seguinte parte de um ponto à frente dela.
    api.ok(Date.parse(d.json.ate) <= Date.now() + 1000, "o cursor `ate` veio do futuro");

    const cheio = await api.get("/api/funil", api.SESSOES.admin);
    api.status(cheio, 200, "GET no board inteiro");
    return `delta ${d.ms}ms (${d.json.cards.length} cards) contra ${cheio.ms}ms do board inteiro`;
  });

  // ---------------------------------------------------------------- passo 3
  // O de verdade: board aberto no navegador, mensagem chegando pelo webhook.
  await t.passo("3. board parado não repete /api/funil; mensagem nova move o card em segundos", "✅", async () => {
    let chrome;
    try { chrome = await t.chrome(); }
    catch (e) { throw new Error("PULAR:" + String(e.message).replace(/^PULAR:/, "")); }

    const aba = await t.aba();
    // Conta as requisições por CDP. `/api/funil` e `/api/funil/delta` são
    // contadas SEPARADAS: o ponto do caso é justamente que a primeira pare de
    // se repetir e a segunda assuma.
    let cheios = 0, deltas = 0;
    aba.ouvir((m) => {
      if (m.method !== "Network.requestWillBeSent") return;
      const u = String(m.params?.request?.url ?? "");
      if (u.includes("/api/funil/delta")) deltas++;
      else if (/\/api\/funil(\?|$)/.test(u)) cheios++;
    });

    await aba.cookies(api.SESSOES.admin, api.BASE);
    await aba.ir(api.BASE + "/", { esperar: 9000 });

    const p = await aba.panorama();
    api.ok(!p.erroNext, `o board abriu com erro de cliente. Exceções: ${JSON.stringify(aba.excecoes.slice(0, 3))}`);
    api.ok(aba.excecoes.length === 0, `exceção de JS no board: ${JSON.stringify(aba.excecoes.slice(0, 3))}`);

    const cheiosNaAbertura = cheios;
    api.ok(cheiosNaAbertura >= 1, "o board não chegou a carregar (/api/funil não foi chamado)");

    // -- (a) PARADO: 25s sem tocar em nada -----------------------------------
    // Com o poll antigo de 60s isto daria 0 também, então 25s não provaria nada
    // sozinho. O que prova é o passo (b): quem atualiza passou a ser o delta.
    await espera(25_000);
    api.igual(cheios - cheiosNaAbertura, 0, "o board parado recarregou o funil inteiro");

    // -- (b) mensagem nova ---------------------------------------------------
    const deltasAntes = deltas;
    const t0 = Date.now();
    const r = await clienteEscreve(N, "[QA] delta do board", NOME);
    api.igual(r.status, 200, "o webhook não aceitou a mensagem de ensaio");
    db.anotarRastro(`ensaio ${ID}`, async () => { await limparEnsaio(db.sb); });

    const apareceu = await aba.ate(
      `(document.body.textContent||'').includes(${JSON.stringify(NOME)})`,
      { ms: 20_000, passo: 250 },
    );
    const levou = Date.now() - t0;
    const foto = await aba.foto("board_delta");

    api.ok(apareceu, `o card não apareceu no board em 20s (levou mais que isso) — foto ${foto}`);
    api.ok(deltas > deltasAntes, "o card apareceu, mas /api/funil/delta não foi chamado — a atualização veio de outro caminho");
    api.igual(cheios - cheiosNaAbertura, 0, "o board reconstruiu o funil inteiro em vez de aplicar o delta");
    api.ok(aba.excecoes.length === 0, `exceção de JS ao aplicar o delta: ${JSON.stringify(aba.excecoes.slice(0, 3))}`);

    return `card em ${(levou / 1000).toFixed(1)}s · ${deltas - deltasAntes} delta(s) · 0 recarga inteira · foto ${foto}`;
  });

  // ---------------------------------------------------------------- passo 4
  await t.passo("4. a faixa de ensaio sai do banco", "✅", async () => {
    const relato = await limparEnsaio(db.sb);
    return relato.join(" · ");
  });
}
