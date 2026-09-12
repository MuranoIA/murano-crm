// -----------------------------------------------------------------------------
// Regressão — a prévia de 3 bolhas sai do payload do board e vira sob demanda.
//
// O que este caso protege (12/09/2026):
//
//   1. `/api/funil` NÃO devolve mais `ultimas_mensagens` — a coluna é um lateral
//      join em `mensagens`, cobrada por linha em ~4 mil linhas a cada
//      carregamento, para desenhar bolhas que só os cards olhados mostram;
//   2. `/api/funil/previas` está protegida: sem cookie é 401, e o escopo por
//      carteira vale no SERVIDOR — prévia é conteúdo de mensagem;
//   3. e o principal: **o card continua mostrando as mesmas bolhas**. Tirar a
//      coluna e deixar o card mais pobre não é a mesma coisa que tirar a coluna.
//
// ⚠️ O passo 3 compara o MESMO cliente com o que o banco diz, não com um número
// fixo: "3 bolhas" seria falso para quem só tem uma mensagem, e o caso passaria
// a acusar o produto por uma escolha do teste.
// -----------------------------------------------------------------------------
export const ciclo = "Regressão — prévia do card sob demanda (/api/funil/previas)";

export default async function (t) {
  const { api } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  /** guardado entre os passos: o cliente que serve de cobaia */
  let alvo = null;

  await t.passo("1. /api/funil não carrega mais a prévia de 3 mensagens", "✅", async () => {
    const r = await api.get("/api/funil", api.SESSOES.admin);
    api.status(r, 200, "GET /api/funil");
    const cards = r.json?.cards ?? [];
    api.ok(cards.length > 0, "o board voltou sem card nenhum");
    // A cobaia é escolhida ANTES das asserções de propósito: se o passo 1
    // falhar, os passos 2 e 3 ainda têm de rodar e dizer o que mais quebrou.
    // Deixá-la depois transformava uma falha em três, duas delas sem medição.
    const comUma = cards.filter((c) => c.ultima_mensagem);
    alvo = comUma.find((c) => !/^(winthor|venda):/.test(c.cliente_id)) ?? null;

    const comPrevia = cards.filter((c) => Array.isArray(c.ultimas_mensagens) && c.ultimas_mensagens.length);
    api.igual(comPrevia.length, 0,
      `${comPrevia.length} cards ainda trazem ultimas_mensagens no payload do board`);
    // e a prévia de UMA linha continua vindo — é ela que o card mostra enquanto
    // a de 3 não chegou. Sem isso o card nasceria vazio, que é pior.
    api.ok(comUma.length > 0, "nenhum card trouxe `ultima_mensagem` — o card nasceria vazio");
    return `${cards.length} cards · 0 com a prévia de 3 · ${comUma.length} com a de 1 linha`;
  });

  await t.passo("2. /api/funil/previas exige sessão e devolve o dialeto do card", "✅", async () => {
    if (!alvo) throw new Error("PULAR:nenhum card de conversa real no board");

    const semCookie = await api.get(`/api/funil/previas?ids=${encodeURIComponent(alvo.cliente_id)}`, api.SESSOES.anonimo);
    api.igual(semCookie.status, 401, "sem cookie deveria ser 401");

    const vazio = await api.get("/api/funil/previas?ids=", api.SESSOES.admin);
    api.status(vazio, 200, "sem ids");
    api.ok(vazio.json && typeof vazio.json.previas === "object", "`previas` deveria ser objeto");

    // card sintético do ERP não tem conversa: a rota o descarta antes do banco
    const sintetico = await api.get("/api/funil/previas?ids=winthor:1,venda:2", api.SESSOES.admin);
    api.status(sintetico, 200, "ids sintéticos");
    api.igual(Object.keys(sintetico.json?.previas ?? {}).length, 0,
      "id sintético não deveria chegar ao banco");

    const r = await api.get(`/api/funil/previas?ids=${encodeURIComponent(alvo.cliente_id)}`, api.SESSOES.admin);
    api.status(r, 200, "GET /api/funil/previas");
    const p = r.json?.previas?.[alvo.cliente_id];
    api.ok(Array.isArray(p), "o id pedido tem que voltar, nem que seja com lista vazia");
    for (const m of p) {
      api.ok("c" in m && "e" in m && "t" in m,
        `a bolha veio em outro dialeto: ${JSON.stringify(m).slice(0, 80)}`);
    }
    return `401 sem sessão · sintéticos cortados · ${p.length} bolha(s) para ${alvo.cliente_id}`;
  });

  await t.passo("3. o card na tela mostra as MESMAS bolhas que a rota devolve", "✅", async () => {
    if (!alvo) throw new Error("PULAR:nenhum card de conversa real no board");
    try { await t.chrome(); }
    catch (e) { throw new Error("PULAR:" + String(e.message).replace(/^PULAR:/, "")); }

    const r = await api.get(`/api/funil/previas?ids=${encodeURIComponent(alvo.cliente_id)}`, api.SESSOES.admin);
    const esperadas = (r.json?.previas?.[alvo.cliente_id] ?? [])
      .map((m) => String(m.c ?? "").trim().slice(0, 30)).filter(Boolean);
    if (!esperadas.length) throw new Error("PULAR:o cliente escolhido não tem mensagem visível");

    const aba = await t.aba();
    await aba.cookies(api.SESSOES.admin, api.BASE);
    await aba.enviar("Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await aba.ir(`${api.BASE}/`, { esperar: 600 });
    api.ok(await aba.ate("document.querySelectorAll('article[data-card]').length > 20", { ms: 90_000, passo: 200 }),
      "o board não desenhou cards");

    // Rola até o card: é o gesto que faz o observer vê-lo. Sem isto o caso
    // mediria um card fora da tela, que por desenho NÃO tem prévia — e acusaria
    // o produto por uma escolha do teste.
    const LER = `
      const c = document.querySelector('article[data-card=' + JSON.stringify(${JSON.stringify(alvo.cliente_id)}) + ']');
      if (!c) return { achou: false };
      c.scrollIntoView({ block: 'center' });
      const cx = [...c.querySelectorAll('div')].find(d => getComputedStyle(d).overflowY === 'auto');
      const bolhas = cx
        ? [...cx.querySelectorAll(':scope > div')].map(d => (d.textContent||'').trim().slice(0,30)).filter(Boolean)
        : [];
      return { achou: true, bolhas };
    `;
    const antes = await aba.js(`${LER}`);
    api.ok(antes.achou, `o card ${alvo.cliente_id} não está desenhado no board`);

    // espera a prévia chegar: o observer tem 180ms de espera, mais a viagem
    const chegou = await aba.ate(
      `(() => { const c = document.querySelector('article[data-card=' + JSON.stringify(${JSON.stringify(alvo.cliente_id)}) + ']');`
      + ` if (!c) return false;`
      + ` const cx = [...c.querySelectorAll('div')].find(d => getComputedStyle(d).overflowY === 'auto');`
      + ` if (!cx) return false;`
      + ` return [...cx.querySelectorAll(':scope > div')].map(d => (d.textContent||'').trim()).filter(Boolean).length >= ${esperadas.length}; })()`,
      { ms: 30_000, passo: 300 });

    const depois = await aba.js(`${LER}`);
    const foto = await aba.foto("previas_card");
    api.ok(chegou,
      `a prévia não chegou ao card: esperava ${esperadas.length} bolha(s), a tela tem `
      + `${JSON.stringify(depois.bolhas)} — foto ${foto}`);

    // O conteúdo tem que bater, não só a quantidade. A tela desenha do mais
    // antigo para o mais recente; a rota devolve o contrário.
    const naTela = depois.bolhas.filter((s) => !/conversa inteira|carregando/i.test(s));
    for (const esp of esperadas) {
      api.ok(naTela.some((s) => s.includes(esp.slice(0, 20)) || esp.includes(s.slice(0, 20))),
        `a bolha "${esp}" não apareceu no card — a tela tem ${JSON.stringify(naTela)} — foto ${foto}`);
    }
    api.ok(aba.excecoes.length === 0, `exceção de JS: ${JSON.stringify(aba.excecoes.slice(0, 3))}`);
    return `${esperadas.length} bolha(s) da rota apareceram no card · foto ${foto.split(/[\\/]/).pop()}`;
  });
}
