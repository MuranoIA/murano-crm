// -----------------------------------------------------------------------------
// Regressão — o selo "Esperando" tem de contar a MESMA coisa que a lista mostra.
//
// Relatado pelos consultores em 14/09/2026, com print: com o filtro no Thiago, o
// selo dizia 3 e a lista mostrava 1 conversa.
//
// A causa não era escopo nem dado atrasado: o contador exigia duas condições
// (`nao_lida && !na_fila`) e a lista exigia três — ela também pede
// `status === "aberta"`. Toda a diferença eram conversas não lidas que já tinham
// sido ENCERRADAS. Medido no mesmo dia, antes do conserto:
//
//     vendedor      selo   lista   diferença
//     thiago           4       2       2 encerradas
//     anne             5       3       2 encerradas
//     kamilly          2       0       2 encerradas   <- promete 2, lista vazia
//     geral           21      14       7
//
// ⚠️ ESTE CASO NÃO MEDE O NÚMERO, MEDE O ACORDO. Cravar "o selo do Thiago é 2"
// quebraria amanhã por uma cliente ter escrito — e quebraria dizendo a coisa
// errada, como se o conserto tivesse se perdido. O que não pode mudar é que o
// selo e a lista falem do mesmo conjunto.
//
// Por isso ele roda no NAVEGADOR e não contra a rota: o defeito vivia na tela,
// em duas expressões diferentes para a mesma pergunta. Comparar dois cálculos do
// servidor não teria pegado nada.
// -----------------------------------------------------------------------------

export const ciclo = "Regressão — o selo Esperando bate com a lista";

/**
 * As linhas da lista.
 *
 * ⚠️ A primeira versão disto procurava " - " no texto, porque o nome costuma
 * vir como "305 - FULANA". Só que o código do WinThor só aparece para quem TEM
 * código: clientes sem cadastro saem só com o nome, e a sonda os perdia. Ela
 * contava 10 onde havia 13, e reprovou um conserto que estava certo.
 *
 * A régua agora é estrutural: linha é botão com <b> (o nome). O único outro
 * botão com <b> na coluna é o título-dropdown das filas, que carrega o "▾" — e
 * é assim que ele sai da conta.
 */
const LINHAS = `[...document.querySelectorAll('button')].filter(b => b.querySelector('b') && (b.textContent||'').indexOf('▾') < 0)`;

export default async function (t) {
  const { api } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  let aba = null;

  await t.passo("1. abre o chat como quem enxerga todas as carteiras", "✅", async () => {
    aba = await t.aba();
    try {
      await aba.enviar("Network.enable");
      await aba.enviar("Network.setCacheDisabled", { cacheDisabled: true });
    } catch { /* sem cache desligado o teste ainda vale */ }
    await aba.cookies(api.SESSOES.admin, api.BASE);
    await aba.enviar("Emulation.setDeviceMetricsOverride", {
      width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await aba.ir(`${api.BASE}/chat`, { esperar: 1000 });
    const veio = await aba.ate("document.querySelectorAll('button').length > 30", { ms: 90_000, passo: 400 });
    if (!veio) throw new Error("o chat não terminou de carregar");
    await new Promise((r) => setTimeout(r, 4000));
    return "chat carregado";
  });

  await t.passo("2. o número do selo Esperando é o número de linhas da lista", "⚠️", async () => {
    // O selo, antes de clicar em nada.
    const selo = await aba.js(`
      const b = [...document.querySelectorAll('button')].find(x => /Esperando/.test(x.textContent||''));
      if (!b) return null;
      const m = (b.textContent||'').match(/\\d+/);
      return m ? Number(m[0]) : null;
    `);
    if (selo === null) throw new Error("não achei o selo Esperando na tela");

    // Entra na fila e conta o que ela de fato mostra.
    const clicou = await aba.js(`
      const b = [...document.querySelectorAll('button')].find(x => /Esperando/.test(x.textContent||''));
      if (!b) return false; b.click(); return true;
    `);
    if (!clicou) throw new Error("não consegui abrir a fila Esperando");
    await new Promise((r) => setTimeout(r, 2500));

    const naLista = await aba.js(`return ${LINHAS}.length;`);
    await aba.foto("esperando-selo-x-lista");

    if (selo !== naLista) {
      throw new Error(
        `o selo diz ${selo} e a lista mostra ${naLista}. ` +
        `A diferença costuma ser conversa NÃO LIDA já ENCERRADA: o contador precisa ` +
        `exigir status "aberta", como a lista exige.`,
      );
    }
    return selo === 0
      ? "selo 0 e lista vazia — concordam (momento sem ninguém esperando)"
      : `selo ${selo} e ${naLista} linhas na lista — concordam`;
  });

  await t.passo("3. nenhuma exceção de JavaScript", "✅", async () => {
    if (aba.excecoes.length) throw new Error(aba.excecoes.slice(0, 3).join("\n"));
    return "0 exceção";
  });
}
