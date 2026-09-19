// -----------------------------------------------------------------------------
// medir.mjs — a régua da fase 0 do chat-v2, e a mesma régua de cada fase depois.
//
//   1) cd web && npm run build
//   2) cd web && WHATSAPP_TOKEN= \
//        NODE_OPTIONS="--require <abs>/prototipos/chat-v2/instrument.cjs" \
//        npx next start -p 3120
//   3) node prototipos/chat-v2/medir.mjs            (mede /chat)
//      node prototipos/chat-v2/medir.mjs --tela /chat-v2
//
// Mede, como admin, em Chrome headless por CDP (o driver de testes/):
//   · abertura da tela  — TTFB, primeira pintura, quando a LISTA aparece
//   · /api/chat         — tempo e BYTES que chegam ao navegador
//   · abrir conversa    — do clique até a primeira bolha
//   · digitação         — 20 teclas: long tasks e a pior interação (INP de bolso)
//   · idas ao banco     — do instrument.cjs, atribuídas por requisição
//
// ⚠️ O que vale comparar entre versões é CONTAGEM, BYTES e long task. O tempo
// absoluto aqui é de um notebook falando com o Supabase pela internet.
// ⚠️ Só lê. Não envia mensagem, não escreve no banco, não toca em interruptor.
// -----------------------------------------------------------------------------
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const MEDICOES = join(AQUI, "medicoes");
const BASE = process.env.BASE || "http://127.0.0.1:3120";
const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] : padrao;
};
const TELA = arg("--tela", "/chat");
const RODADAS = Number(arg("--rodadas", 3));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const mediana = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

// O observador precisa existir ANTES de a página desenhar: long task e primeira
// pintura acontecem antes de qualquer script nosso rodar depois do load.
const SONDA = `
  window.__m = { longtasks: [], eventos: [], lista: null };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.longtasks.push(Math.round(e.duration)); })
      .observe({ type: "longtask", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__m.eventos.push({ nome: e.name, ms: Math.round(e.duration) });
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch {}
  // quando a LISTA de conversas fica visível: a tela sem lista tem ~12 botões;
  // com lista, passa de 25. Mede o que o vendedor vê, não o que o JS terminou.
  // ⚠️ MutationObserver em document.documentElement NÃO pegou isso (deu null nas
  // 3 rodadas de 19/09). Amostragem simples pega, e o erro é o passo.
  try {
    const t = setInterval(() => {
      if (window.__m.lista === null && document.querySelectorAll("button").length >= 25) {
        window.__m.lista = Math.round(performance.now());
        clearInterval(t);
      }
    }, 50);
  } catch {}
`;

function idasDoServidor(desde) {
  // o preload roda em vários processos (npm, npx, next): vale o arquivo maior
  let melhor = null;
  for (const f of readdirSync(MEDICOES).filter((f) => f.endsWith(".jsonl"))) {
    const linhas = readFileSync(join(MEDICOES, f), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    if (!melhor || linhas.length > melhor.length) melhor = linhas;
  }
  if (!melhor) return [];
  return melhor.filter((l) => l.em >= desde);
}

function resumoDasIdas(linhas, rota) {
  const reqs = linhas.filter((l) => l.tipo === "requisicao" && l.rota === rota);
  const idas = linhas.filter((l) => l.tipo === "ida" && l.de === rota);
  const porAlvo = {};
  for (const i of idas) porAlvo[i.alvo] = (porAlvo[i.alvo] || 0) + 1;
  return {
    requisicoes: reqs.length,
    idas_por_requisicao: reqs.length ? +(idas.length / reqs.length).toFixed(1) : idas.length,
    bytes_do_banco: reqs.length ? Math.round(reqs.reduce((s, r) => s + r.bytes_banco, 0) / reqs.length) : 0,
    ms_servidor: reqs.length ? mediana(reqs.map((r) => r.ms)) : null,
    alvos: Object.entries(porAlvo).sort((a, b) => b[1] - a[1]).slice(0, 12),
  };
}

const chrome = await subirChrome({ porta: 9380 });
const rodadas = [];

for (let n = 1; n <= RODADAS; n++) {
  const aba = await novaAba(chrome);
  await aba.preparar();
  await aba.enviar("Network.clearBrowserCache");
  await aba.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await aba.enviar("Page.addScriptToEvaluateOnNewDocument", { source: SONDA });

  const t0 = new Date().toISOString();
  await aba.ir(`${BASE}${TELA}`, { esperar: 0 });
  await aba.ate("window.__m && window.__m.lista !== null", { ms: 30_000, passo: 100 });
  await espera(1500);

  const abertura = await aba.js(`
    const n = performance.getEntriesByType("navigation")[0] || {};
    const p = performance.getEntriesByType("paint");
    const r = performance.getEntriesByType("resource").filter(r => /\\/api\\//.test(r.name));
    return {
      ttfb: Math.round(n.responseStart || 0),
      dcl: Math.round(n.domContentLoadedEventEnd || 0),
      fcp: Math.round((p.find(x => x.name === "first-contentful-paint") || {}).startTime || 0),
      lista_visivel: window.__m.lista,
      botoes: document.querySelectorAll("button").length,
      erro: /Application error|client-side exception/.test(document.body.textContent || ""),
      rotas: r.map(x => ({ n: x.name.split("/api/")[1].slice(0, 40), ms: Math.round(x.duration), bytes: x.transferSize, em: Math.round(x.startTime) })),
      api_chat_vezes: r.filter(x => x.name.split("?")[0].endsWith("/api/chat")).length,
      api_bytes_total: r.reduce((s, x) => s + (x.transferSize || 0), 0),
      js_bytes: performance.getEntriesByType("resource").filter(x => /\\.js(\\?|$)/.test(x.name)).reduce((s, x) => s + (x.transferSize || 0), 0),
    };
  `);

  // --- abrir uma conversa: a linha da lista traz a hora da última mensagem ----
  const clicou = await aba.js(`
    const b = [...document.querySelectorAll("button")].filter(x => /\\d{2}:\\d{2}/.test(x.textContent || "") && (x.textContent || "").length > 12);
    if (!b.length) return null;
    window.__m.clique = Math.round(performance.now());
    b[0].click();
    return (b[0].textContent || "").replace(/\\s+/g, " ").slice(0, 40);
  `);
  const abriu = await aba.ate("document.querySelector('textarea')", { ms: 20_000, passo: 100 });
  // o compositor aparece antes da conversa: a thread chega depois, e é ela que
  // o vendedor precisa ler. Medir só o compositor contaria uma história boa
  // demais.
  // sem barra invertida em regex aqui: este texto passa por um template literal
  // antes de virar JS na página, e `\/` vira `/` no caminho (a armadilha de
  // escape do CLAUDE.md §36.4). `includes` não tem esse problema.
  await aba.ate("performance.getEntriesByType('resource').some(r=>r.name.includes('chat/thread'))", { ms: 20_000, passo: 100 });
  const conversa = await aba.js(`
    const r = performance.getEntriesByType("resource").filter(r => /chat\\/thread/.test(r.name)).pop();
    return {
      ate_compositor: Math.round(performance.now()) - (window.__m.clique || 0),
      thread_ms: r ? Math.round(r.duration) : null,
      thread_bytes: r ? r.transferSize : null,
      ate_thread: r ? Math.round(r.responseEnd) - (window.__m.clique || 0) : null,
    };
  `);

  // --- digitar 20 teclas, com teclado de verdade ------------------------------
  let digitacao = null;
  if (abriu) {
    await aba.js(`const t=document.querySelector('textarea'); if(t){t.focus();} window.__m.longtasks=[]; window.__m.eventos=[]; window.__m.t0=performance.now(); return true;`);
    for (const ch of "bom dia, tudo bem com") {
      await aba.enviar("Input.dispatchKeyEvent", { type: "keyDown", text: ch, unmodifiedText: ch });
      await aba.enviar("Input.dispatchKeyEvent", { type: "keyUp", text: ch, unmodifiedText: ch });
      await espera(90);
    }
    await espera(700);
    digitacao = await aba.js(`
      const e = window.__m.eventos.filter(x => /key|input/.test(x.nome));
      return {
        teclas_no_campo: (document.querySelector("textarea") || {}).value?.length ?? 0,
        longtasks: window.__m.longtasks.length,
        longtask_pior: window.__m.longtasks.length ? Math.max(...window.__m.longtasks) : 0,
        longtask_soma: window.__m.longtasks.reduce((s, x) => s + x, 0),
        interacao_pior: e.length ? Math.max(...e.map(x => x.ms)) : 0,
      };
    `);
    // não deixa texto na caixa de ninguém: o rascunho é só do navegador, mas
    // limpar é barato e evita susto em screenshot futuro
    await aba.js(`const t=document.querySelector('textarea'); if(t){const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; s.call(t,''); t.dispatchEvent(new Event('input',{bubbles:true}));} return true;`);
  }

  if (n === RODADAS) await aba.foto(`medicao-${TELA.replace(/\W/g, "") || "chat"}`);
  rodadas.push({ n, abertura, conversa: { ...conversa, clicou, abriu }, digitacao, servidor: idasDoServidor(t0) });
  await aba.enviar("Page.close").catch(() => {});
}

fecharChrome(chrome);

const ab = rodadas.map((r) => r.abertura);
const co = rodadas.map((r) => r.conversa);
const di = rodadas.map((r) => r.digitacao).filter(Boolean);
const todasIdas = rodadas.flatMap((r) => r.servidor);

const apiChat = ab.flatMap((a) => a.rotas.filter((r) => r.n === "chat"));
const relatorio = {
  tela: TELA,
  base: BASE,
  em: new Date().toISOString(),
  rodadas: RODADAS,
  navegador: {
    ttfb_ms: mediana(ab.map((a) => a.ttfb)),
    fcp_ms: mediana(ab.map((a) => a.fcp)),
    lista_visivel_ms: mediana(ab.map((a) => a.lista_visivel ?? 0)),
    js_baixado_kb: Math.round(mediana(ab.map((a) => a.js_bytes)) / 1024),
    erro_na_tela: ab.some((a) => a.erro),
  },
  api_chat: {
    ms: apiChat.length ? mediana(apiChat.map((r) => r.ms)) : null,
    kb: apiChat.length ? Math.round(mediana(apiChat.map((r) => r.bytes)) / 1024) : null,
  },
  repeticao: {
    api_chat_vezes_por_sessao: mediana(ab.map((a) => a.api_chat_vezes)),
    api_bytes_kb_por_sessao: Math.round(mediana(ab.map((a) => a.api_bytes_total)) / 1024),
  },
  abrir_conversa: {
    ate_compositor_ms: mediana(co.map((c) => c.ate_compositor ?? 0)),
    ate_thread_ms: mediana(co.map((c) => c.ate_thread ?? 0)),
    thread_ms: mediana(co.map((c) => c.thread_ms ?? 0)),
    thread_kb: Math.round(mediana(co.map((c) => c.thread_bytes ?? 0)) / 1024),
  },
  digitar_20_teclas: di.length
    ? {
        longtasks: mediana(di.map((d) => d.longtasks)),
        longtask_pior_ms: mediana(di.map((d) => d.longtask_pior)),
        longtask_soma_ms: mediana(di.map((d) => d.longtask_soma)),
        interacao_pior_ms: mediana(di.map((d) => d.interacao_pior)),
      }
    : null,
  banco: {
    por_rota: Object.fromEntries(
      [...new Set(todasIdas.filter((l) => l.tipo === "requisicao").map((l) => l.rota))]
        .filter((r) => /\/api\//.test(r))
        .map((r) => [r.split("?")[0], resumoDasIdas(todasIdas, r)])
        .sort((a, b) => b[1].idas_por_requisicao - a[1].idas_por_requisicao)
        .slice(0, 10),
    ),
  },
};

mkdirSync(MEDICOES, { recursive: true });
const destino = join(MEDICOES, `relatorio-${TELA.replace(/\W/g, "") || "chat"}.json`);
writeFileSync(destino, JSON.stringify({ relatorio, rodadas }, null, 2));
console.log(JSON.stringify(relatorio, null, 2));
console.log(`\n-> ${destino}`);
