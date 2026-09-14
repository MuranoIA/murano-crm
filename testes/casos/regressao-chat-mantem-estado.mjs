// -----------------------------------------------------------------------------
// Regressão — o chat volta do board como foi deixado, e sem o portão de sessão.
//
// Duas queixas de 12/09/2026, mesma causa: *"ao alternar entre chat e board,
// eles recarregam em vez de manter o último estado"* e *"sempre aparece
// Verificando sessão"*.
//
// O que este caso vigia:
//
//   1. a BUSCA e a FILA escolhidas sobrevivem à ida ao board e à volta;
//   2. "Verificando sessão…" NÃO aparece na volta — a sessão é a mesma das duas
//      telas e é lida uma vez por aba (lib/memoriaTela);
//   3. a volta é NAVEGAÇÃO DE CLIENTE, não recarregamento de página.
//
// ⚠️ O item 3 é o que mais engana, e só apareceu porque o relógio do navegador
// deu NEGATIVO no meio de uma medição: o menu do board usava `<a href>` puro, e
// `performance.now()` zerava na chegada — prova de que a página tinha recarregado
// inteira. Com isso a memória de módulo morria a cada troca e nada do resto
// valia. Por isso o caso mede o relógio, e não só o conteúdo da tela.
// -----------------------------------------------------------------------------
export const ciclo = "Regressão — o chat mantém o estado ao voltar do board";

export default async function (t) {
  const { api } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  await t.passo("busca e fila sobrevivem, sem portão de sessão e sem recarregar", "✅", async () => {
    try { await t.chrome(); }
    catch (e) { throw new Error("PULAR:" + String(e.message).replace(/^PULAR:/, "")); }

    const aba = await t.aba();
    await aba.cookies(api.SESSOES.admin, api.BASE);
    await aba.enviar("Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

    // Vigia o portão o tempo todo. Amostrar é o único jeito: ele some sozinho
    // quando a resposta chega, e uma foto no fim não o teria visto.
    await aba.enviar("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__portao = 0;
        setInterval(() => { if (/Verificando sess/.test(document.body?.innerText || "")) window.__portao++; }, 40);`,
    });

    const ESTADO = `return {
      busca: (document.querySelector('input[placeholder*="Buscar"]')||{}).value || "",
      titulo: ((document.body.innerText||"").match(/^(.+?)\\s*▾/m) || [])[1] || null,
      conversas: document.querySelectorAll('button').length,
    };`;

    await aba.ir(`${api.BASE}/chat`, { esperar: 600 });
    api.ok(await aba.ate("!!document.querySelector('input[placeholder*=\"Buscar\"]')", { ms: 90_000, passo: 200 }),
      "o chat não carregou a barra lateral");
    await new Promise((r) => setTimeout(r, 1200));

    await aba.digitar('input[placeholder*="Buscar"]', "MARI");
    await new Promise((r) => setTimeout(r, 900));
    const antes = await aba.js(ESTADO);
    api.igual(antes.busca, "MARI", "não consegui digitar na busca");

    const salvo = await aba.js(`return sessionStorage.getItem('crm_chat_escolhas');`);
    api.ok(salvo && /"busca":"MARI"/.test(salvo),
      `a escolha não foi guardada: ${String(salvo).slice(0, 120)}`);

    // ---- vai ao board -----------------------------------------------------
    api.ok(await aba.js(`
      const a = [...document.querySelectorAll('a')].find(x => /Negocia/.test(x.textContent||''));
      if (!a) return false; a.click(); return true;
    `), 'não achei o link "Negociações" no chat');
    api.ok(await aba.ate("location.pathname === '/'", { ms: 30_000, passo: 100 }), "não chegou ao board");
    api.ok(await aba.ate("document.querySelectorAll('article[data-card]').length > 5", { ms: 60_000, passo: 100 }),
      "o board não desenhou cards");

    // ---- e volta ----------------------------------------------------------
    const portaoAntes = await aba.js("return window.__portao;");
    const t0 = await aba.js("return performance.now();");
    api.ok(await aba.js(`
      const a = [...document.querySelectorAll('a')].find(x => /Chat/.test(x.textContent||''));
      if (!a) return false; a.click(); return true;
    `), 'não achei o link "Chat" no board');
    api.ok(await aba.ate("location.pathname === '/chat'", { ms: 30_000, passo: 60 }), "não voltou ao chat");
    api.ok(await aba.ate("!!document.querySelector('input[placeholder*=\"Buscar\"]')", { ms: 60_000, passo: 40 }),
      "a barra lateral não voltou a aparecer");
    const ms = await aba.js(`return Math.round(performance.now() - ${t0});`);
    await new Promise((r) => setTimeout(r, 1500));

    const depois = await aba.js(ESTADO);
    const portao = await aba.js("return window.__portao;");
    const foto = await aba.foto("chat_mantem_estado");

    // ⚠️ NEGATIVO = a página recarregou: `performance.now()` recomeça do zero num
    // carregamento de documento, então o t0 de antes fica MAIOR que o de depois.
    // É assim que se pega um `<a href>` disfarçado de navegação.
    api.ok(ms > 0,
      `a volta RECARREGOU a página inteira (relógio deu ${ms} ms, negativo) — `
      + `algum link do menu virou <a href> em vez de <Link> — foto ${foto}`);
    api.igual(depois.busca, antes.busca, `a busca se perdeu na volta — foto ${foto}`);
    api.igual(depois.titulo, antes.titulo, `a fila se perdeu na volta — foto ${foto}`);
    api.igual(portao, portaoAntes,
      `"Verificando sessão…" apareceu ${portao - portaoAntes}x na volta — a sessão `
      + `deveria vir da memória da aba — foto ${foto}`);
    api.ok(aba.excecoes.length === 0, `exceção de JS: ${JSON.stringify(aba.excecoes.slice(0, 3))}`);

    return `busca "${antes.busca}" e fila "${antes.titulo}" sobreviveram · volta em ${ms} ms `
      + `(navegação de cliente) · sem portão de sessão · foto ${foto.split(/[\\/]/).pop()}`;
  });
}
