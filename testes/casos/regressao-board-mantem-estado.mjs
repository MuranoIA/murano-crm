// -----------------------------------------------------------------------------
// Regressão — o board volta do chat como foi deixado.
//
// Relatado em 12/09/2026, com print: filtrar o board (por produto, no caso),
// clicar num card para ir ao chat, e voltar por "Negociações" devolvia o board
// limpo, sem o filtro, recarregando tudo.
//
// A causa é estrutural: board e chat são PÁGINAS diferentes do App Router, e
// `router.push`/`<Link>` desmontam a árvore inteira da página que se deixa.
// Todo filtro do board é `useState`, que morre na desmontagem. A correção é uma
// memória de tela em escopo de MÓDULO (sobrevive à desmontagem, morre com a
// aba) espelhada em `sessionStorage`, mais a última foto do `/api/funil` para a
// volta pintar na hora em vez de esperar o carregamento inteiro.
//
// ⚠️ DUAS ARMADILHAS QUE ESTE CASO JÁ PAGOU — não desfazer:
//
//  1. O filtro escolhido tem de DEIXAR CARDS na tela. A primeira versão filtrou
//     até sobrar zero: o clique não achou card nenhum, a navegação nunca
//     aconteceu, e o caso passou dizendo que o filtro sobreviveu — sobreviveu
//     porque a página nunca foi desmontada. Falso verde.
//
//  2. NÃO usar o chip de VENDEDOR. Ele já sobrevive por conta própria: clicar
//     nele escreve o cookie `ver_como` no servidor, e a montagem o lê de volta.
//     Medido: com ele o caso passa NOS DOIS lados e não mede nada. O relato é
//     sobre os filtros LOCAIS — busca, produto, cidade, tempo parado. Este caso
//     usa a BUSCA, que é a mais barata de dirigir e tem a mesma natureza.
// -----------------------------------------------------------------------------
export const ciclo = "Regressão — o board mantém o estado ao voltar do chat";

export default async function (t) {
  const { api } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  await t.passo("o filtro local sobrevive à ida ao chat e à volta", "✅", async () => {
    try { await t.chrome(); }
    catch (e) { throw new Error("PULAR:" + String(e.message).replace(/^PULAR:/, "")); }

    const aba = await t.aba();
    await aba.cookies(api.SESSOES.admin, api.BASE);
    await aba.enviar("Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

    const ESTADO = `return {
      cards: document.querySelectorAll('article[data-card]').length,
      busca: (document.querySelector('input[placeholder*="Buscar"]')||{}).value || "",
    };`;

    await aba.ir(`${api.BASE}/`, { esperar: 600 });
    api.ok(await aba.ate("document.querySelectorAll('article[data-card]').length > 20", { ms: 90_000, passo: 200 }),
      "o board não desenhou cards");
    const inicial = await aba.js(ESTADO);

    // O termo sai dos PRÓPRIOS cards da tela, não de uma constante: um nome
    // fixo vira "sem cards" no dia em que a base mudar, e o caso passaria a
    // acusar o produto por uma escolha do teste.
    // ⚠️ O nome do cliente não é um <b>: é uma <div> com `fontWeight: 700` e um
    // `title` igual ao próprio texto (para o nome cortado em 2 linhas ter dica).
    // Esse par texto === title é o que identifica o elemento sem depender do
    // estilo, que muda com o tema.
    const termo = await aba.js(`
      const nomes = [];
      for (const c of document.querySelectorAll('article[data-card]')) {
        const d = [...c.querySelectorAll('div')]
          .find(x => x.title && x.title.trim() === (x.textContent||'').trim());
        if (d) nomes.push(d.title.replace(/^\\d+\\s*-\\s*/, '').trim());
      }
      const filtrados = nomes.filter(n => n.length > 3);
      if (!filtrados.length) return null;
      // a primeira palavra mais repetida: filtra de verdade, mas não zera
      const conta = {};
      for (const n of filtrados) { const p = n.split(/\\s+/)[0]; if (p.length >= 4) conta[p] = (conta[p]||0)+1; }
      const par = Object.entries(conta).sort((a,b) => b[1]-a[1])[0];
      return par ? par[0] : filtrados[0].split(/\\s+/)[0];
    `);
    if (!termo) throw new Error("PULAR:nenhum nome de cliente na tela para montar a busca");

    await aba.digitar('input[placeholder*="Buscar"]', termo);
    await new Promise((r) => setTimeout(r, 1500));
    const comFiltro = await aba.js(ESTADO);
    api.ok(comFiltro.cards > 0,
      `a busca por "${termo}" não deixou card nenhum — o clique não teria onde acontecer`);
    api.ok(comFiltro.cards < inicial.cards,
      `a busca por "${termo}" não filtrou nada (${inicial.cards} antes e depois)`);

    // vai ao chat CLICANDO NUM CARD — é o gesto do relato
    const id = await aba.js(`
      const c = document.querySelector('article[data-card]');
      if (!c) return null; c.click(); return c.dataset.card;
    `);
    api.ok(await aba.ate("location.pathname === '/chat'", { ms: 30_000, passo: 200 }),
      `clicar no card ${id} não levou ao /chat`);
    await new Promise((r) => setTimeout(r, 2000));

    // volta por "Negociações", como no relato
    const t0 = await aba.js("return performance.now();");
    api.ok(await aba.js(`
      const a = [...document.querySelectorAll('a')].find(x => /Negocia/.test(x.textContent||''));
      if (!a) return false; a.click(); return true;
    `), 'não achei o link "Negociações" no chat');

    const voltou = await aba.ate(
      "location.pathname === '/' && document.querySelectorAll('article[data-card]').length > 0",
      { ms: 60_000, passo: 50 });
    const ms = await aba.js(`return Math.round(performance.now() - ${t0});`);
    const naVolta = await aba.js(ESTADO);
    const foto = await aba.foto("board_mantem_estado");

    api.ok(voltou, `o board não voltou a desenhar card em 60 s — foto ${foto}`);
    api.igual(naVolta.busca, termo, `a busca se perdeu na volta — foto ${foto}`);
    api.igual(naVolta.cards, comFiltro.cards,
      `o filtro não foi reaplicado: ${comFiltro.cards} cards antes, ${naVolta.cards} depois — foto ${foto}`);
    api.ok(aba.excecoes.length === 0, `exceção de JS: ${JSON.stringify(aba.excecoes.slice(0, 3))}`);

    return `busca "${termo}" sobreviveu · ${comFiltro.cards} de ${inicial.cards} cards nos dois lados`
      + ` · primeiro card em ${ms} ms · foto ${foto.split(/[\\/]/).pop()}`;
  });
}
