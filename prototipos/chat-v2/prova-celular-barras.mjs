// -----------------------------------------------------------------------------
// O CHAT NO CELULAR: as duas barras numa linha só (demanda #47, 28/09/2026)
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   ENSAIO_VISIVEL=1 npx next start -p 3120     (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-celular-barras.mjs
//
// Dois pedidos do dono, com print:
//
//   1. o CABEÇALHO quebrava no meio da fileira e os seis ícones saíam 3 em cima
//      e 3 embaixo — "organize os 6 ícones abaixo do nome da cliente, somente
//      em uma linha";
//   2. o botão de FIGURINHA não aparecia no celular (nem o emoji, nem o
//      template): eles estavam escondidos por uma conta de largura.
//
// A prova mede nas duas larguras que a equipe usa — 390 e 360 —, porque é a
// 360 que a conta aperta. Só lê; nada é enviado.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

/** quantas LINHAS distintas um conjunto de elementos ocupa (pelo topo do meio) */
const LINHAS = (sel) => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent !== null);
  const meios = els.map(e => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2); });
  // agrupa por proximidade: botões de alturas diferentes centrados na MESMA
  // linha têm topos diferentes — medir o topo foi o erro da §41.5
  const linhas = [];
  for (const m of meios.sort((a,b) => a-b)) {
    if (!linhas.length || m - linhas[linhas.length-1] > 14) linhas.push(m);
  }
  return { n: els.length, linhas: linhas.length };
})()`;

async function medir(a, largura) {
  await a.enviar("Emulation.setDeviceMetricsOverride", {
    width: largura, height: 800, deviceScaleFactor: 1, mobile: true,
  });
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 2500 });
  await a.ate(`document.querySelector('textarea')`, { ms: 25_000 });
  await espera(700);
  return a.js(`
    const cab = document.querySelector('header');
    const acoes = cab ? cab.querySelector('div.w-full') : null;
    const pilula = document.querySelector('textarea')?.parentElement ?? null;
    const grupo = pilula ? pilula.querySelector('div.w-full') : null;
    const campo = document.querySelector('textarea');
    const r = campo ? campo.getBoundingClientRect() : null;
    const rot = (x) => x.getAttribute('aria-label') || x.getAttribute('title') || '';
    return {
      largura: window.innerWidth,
      transbordo: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      acoesCab: acoes ? [...acoes.querySelectorAll('button')].map(rot) : null,
      botoesCaixa: grupo ? [...grupo.querySelectorAll('button')].map(rot) : null,
      campoLargura: r ? Math.round(r.width) : 0,
    };`);
}

const chrome = await subirChrome({ porta: 9541 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);

  for (const largura of [390, 360]) {
    const m = await medir(a, largura);
    const cab = await a.js(`return ${LINHAS("header div.w-full button")};`);
    const caixa = await a.js(`return ${LINHAS("textarea ~ *, div.w-full > button")};`);

    conferir(m.transbordo === 0, `${largura}px · nada sai da tela`, `transbordo ${m.transbordo}px`);
    conferir(
      cab.n === 6 && cab.linhas === 1,
      `${largura}px · os seis ícones do cabeçalho numa LINHA SÓ, abaixo do nome`,
      `${cab.n} ícones em ${cab.linhas} linha(s)`,
    );
    conferir(
      (m.botoesCaixa ?? []).includes("Figurinhas"),
      `${largura}px · o botão de FIGURINHA aparece — era o pedido`,
      (m.botoesCaixa ?? []).join(" · "),
    );
    conferir(
      (m.botoesCaixa ?? []).length === 6,
      `${largura}px · e a caixa tem os seis botões do computador`,
      `${(m.botoesCaixa ?? []).length} botões`,
    );
    conferir(
      m.campoLargura > 180,
      `${largura}px · …sem espremer a caixa de texto, que é o que quebrou em 01/09`,
      `caixa de ${m.campoLargura}px`,
    );
    await a.foto(`celular-${largura}`);
  }

  // e o desktop continua numa linha só
  await a.enviar("Emulation.clearDeviceMetricsOverride");
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 2500 });
  await a.ate(`document.querySelector('textarea')`, { ms: 25_000 });
  await espera(700);
  const desk = await a.js(`
    const campo = document.querySelector('textarea');
    const pilula = campo?.parentElement;
    const meio = (e) => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const botoes = pilula ? [...pilula.querySelectorAll('button')] : [];
    return {
      botoes: botoes.length,
      umaLinha: botoes.length > 0 && botoes.every(b => Math.abs(meio(b) - meio(campo)) < 24),
      campo: Math.round(campo.getBoundingClientRect().width),
    };`);
  conferir(desk.umaLinha, "no computador a caixa segue numa linha só, como era", `${desk.botoes} botões · caixa de ${desk.campo}px`);

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
