// -----------------------------------------------------------------------------
// Driver de navegador por CDP, sem puppeteer.
//
// Node 24 tem WebSocket nativo — falar CDP direto custa este arquivo e nenhuma
// dependência. A receita é a da §35.1 do CLAUDE.md, que foi o que achou o board
// caído por `charAt` de null depois de a leitura de código ter falhado:
//
//     chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<temp>
//     Runtime.enable + Console.enable -> Network.setCookie -> Page.navigate
//
// ⚠️ ARMADILHAS JÁ PAGAS, não redescobrir:
//  - em headless sem layout `innerText` volta VAZIO mesmo com a página
//    renderizada. Meça por `innerHTML.length`, `document.title`,
//    `querySelectorAll` ou screenshot (§3 da definição do agente).
//  - screenshot decide layout; sonda numérica mede o que você lembrou de
//    perguntar (§41.5).
// -----------------------------------------------------------------------------
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SAIDAS = join(RAIZ, "testes", "saidas");

const CANDIDATOS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

export function acharChrome() {
  for (const c of CANDIDATOS) if (existsSync(c)) return c;
  return null;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sobe um Chrome headless isolado e devolve o endereço do WebSocket. */
export async function subirChrome({ porta = 9222, headless = true } = {}) {
  const bin = acharChrome();
  if (!bin) throw new Error("Chrome não encontrado — driver de navegador indisponível");
  const perfil = mkdtempSync(join(tmpdir(), "crm-qa-"));
  const args = [
    `--remote-debugging-port=${porta}`,
    `--user-data-dir=${perfil}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-sync",
    "--window-size=1440,900",
    // O CRM roda EMBUTIDO no hub (§17), e testar isso exige avaliar JS DENTRO
    // do quadro. Com site isolation ligado, um iframe de outra origem vira um
    // PROCESSO separado (OOPIF) e o contexto dele nao aparece no alvo da pagina:
    // `Runtime.executionContextCreated` nunca menciona o quadro, e a sonda
    // conclui "o iframe nao carregou" quando ele carregou muito bem.
    //
    // Estes dois flags mantem o quadro no mesmo processo. NAO afetam o que
    // estamos medindo: permissions policy (`allow=`) e cookie de terceiro sao
    // regras de documento, nao do modelo de processos.
    "--disable-site-isolation-trials",
    "--disable-features=IsolateOrigins,site-per-process,Translate,MediaRouter",
  ];
  if (headless) args.push("--headless=new", "--disable-gpu");
  const proc = spawn(bin, args, { stdio: "ignore", detached: false });

  // A porta demora a abrir; /json/version é o sinal de pronto.
  let alvo = null;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/json/version`);
      if (r.ok) { alvo = (await r.json()).webSocketDebuggerUrl; break; }
    } catch { /* ainda subindo */ }
    await espera(200);
  }
  if (!alvo) { try { proc.kill(); } catch {} throw new Error("Chrome não abriu a porta de depuração"); }
  return { proc, porta, perfil, alvo };
}

/**
 * Uma aba. Guarda console e exceções desde o primeiro instante — é o que revela
 * o defeito que não aparece na tela (§3): "Application error: a client-side
 * exception has occurred" não diz nada; `Runtime.exceptionThrown` diz tudo.
 */
export class Aba {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pendentes = new Map();
    this.console = [];
    this.excecoes = [];
    this.falhasRede = [];
    this.ouvintes = [];
    ws.addEventListener("message", (ev) => this.#recebeu(JSON.parse(ev.data)));
  }

  #recebeu(m) {
    if (m.id !== undefined) {
      const p = this.pendentes.get(m.id);
      if (!p) return;
      this.pendentes.delete(m.id);
      if (m.error) p.rej(new Error(`${m.error.message}${m.error.data ? " — " + m.error.data : ""}`));
      else p.res(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      this.excecoes.push(d.exception?.description ?? d.text ?? JSON.stringify(d));
    } else if (m.method === "Runtime.consoleAPICalled") {
      const txt = (m.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(" ");
      this.console.push(`${m.params.type}: ${txt}`);
    } else if (m.method === "Log.entryAdded") {
      const e = m.params.entry;
      this.console.push(`${e.level}: ${e.text}`);
      if (e.level === "error") this.falhasRede.push(e.text);
    }
    for (const o of this.ouvintes) o(m);
  }

  enviar(metodo, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pendentes.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method: metodo, params }));
      setTimeout(() => {
        if (this.pendentes.has(id)) { this.pendentes.delete(id); rej(new Error(`timeout em ${metodo}`)); }
      }, 45_000);
    });
  }

  ouvir(fn) { this.ouvintes.push(fn); return () => { this.ouvintes = this.ouvintes.filter((o) => o !== fn); }; }

  async preparar() {
    await this.enviar("Runtime.enable");
    await this.enviar("Page.enable");
    await this.enviar("Log.enable");
    await this.enviar("Network.enable");
  }

  /** Cookie de sessão do CRM. Precisa vir ANTES do Page.navigate. */
  async cookies(mapa, url = "http://localhost:3100") {
    const { hostname } = new URL(url);
    for (const [nome, valor] of Object.entries(mapa)) {
      await this.enviar("Network.setCookie", { name: nome, value: String(valor), domain: hostname, path: "/" });
    }
  }

  async ir(url, { esperar = 1500 } = {}) {
    await this.enviar("Page.navigate", { url });
    await this.carregou();
    await espera(esperar);
  }

  carregou() {
    return new Promise((res) => {
      const parar = this.ouvir((m) => {
        if (m.method === "Page.loadEventFired") { parar(); res(); }
      });
      setTimeout(() => { parar(); res(); }, 30_000);
    });
  }

  /** Avalia JS na página. Devolve o valor por JSON (funciona com objetos). */
  async js(expr) {
    const r = await this.enviar("Runtime.evaluate", {
      expression: `(function(){ ${expr} })()`,
      returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`js: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result?.value;
  }

  /** Espera uma condição JS virar verdadeira. Devolve false no estouro. */
  async ate(expr, { ms = 15_000, passo = 250 } = {}) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      try { if (await this.js(`return !!(${expr});`)) return true; } catch { /* ainda montando */ }
      await espera(passo);
    }
    return false;
  }

  /**
   * Clica no primeiro elemento cujo texto casa. Usa `textContent`, NÃO
   * `innerText`: em headless sem layout o segundo volta vazio.
   */
  async clicarTexto(seletor, texto) {
    return this.js(`
      const alvos=[...document.querySelectorAll(${JSON.stringify(seletor)})];
      const t=${JSON.stringify(String(texto))};
      const el=alvos.find(e=>(e.textContent||'').trim().includes(t));
      if(!el) return false;
      el.click(); return true;
    `);
  }

  async digitar(seletor, texto) {
    return this.js(`
      const el=document.querySelector(${JSON.stringify(seletor)});
      if(!el) return false;
      const set=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;
      set.call(el, ${JSON.stringify(texto)});
      el.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    `);
  }

  /** PNG em testes/saidas. Screenshot decide layout (§41.5). */
  async foto(nome) {
    mkdirSync(SAIDAS, { recursive: true });
    const r = await this.enviar("Page.captureScreenshot", { format: "png" });
    const caminho = join(SAIDAS, `${nome}.png`);
    writeFileSync(caminho, Buffer.from(r.data, "base64"));
    return caminho;
  }

  /** Resumo do que a página tem, sem depender de innerText. */
  async panorama() {
    return this.js(`
      return {
        titulo: document.title,
        html: document.body ? document.body.innerHTML.length : 0,
        botoes: document.querySelectorAll('button').length,
        erroNext: document.body ? /Application error|client-side exception/.test(document.body.textContent||'') : false,
        texto: (document.body ? (document.body.textContent||'') : '').replace(/\\s+/g,' ').slice(0,4000)
      };
    `);
  }
}

/** Abre uma aba nova e devolve o objeto Aba já preparado. */
export async function novaAba(chrome, url = "about:blank") {
  const r = await fetch(`http://127.0.0.1:${chrome.porta}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const alvo = await r.json();
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("websocket da aba não abriu")), { once: true });
  });
  const aba = new Aba(ws);
  await aba.preparar();
  aba.alvoId = alvo.id;
  return aba;
}

export function fecharChrome(chrome) {
  try { chrome.proc.kill(); } catch { /* já morreu */ }
}

/**
 * Uma aba com JARRO DE COOKIES PRÓPRIO.
 *
 * ⚠️ Por que isto existe: `novaAba()` cria a aba pelo endpoint HTTP
 * `/json/new`, que a coloca no **contexto padrão** do navegador — e contexto é
 * quem guarda o cookie. Duas abas de lá dividem a MESMA sessão: setar
 * `crm_sessao=admin` na segunda **derruba** o `crm_sessao=romulo` da primeira,
 * sem erro nenhum.
 *
 * Isso produziu um falso positivo caro em 27/08/2026: o teste de presença do
 * ciclo 4 acusou "o aviso 👀 não apareceu" quando na verdade as duas abas eram
 * a MESMA pessoa — e o chat, corretamente, não avisa que você está onde você
 * está (§21: o filtro é por rótulo, não por aba, justamente para o PC e o
 * celular do mesmo vendedor não virarem "outra pessoa"). A foto denunciou:
 * a aba que deveria ser do consultor mostrava o avatar Admin.
 *
 * `Target.createBrowserContext` é o equivalente de uma janela anônima
 * separada. Use SEMPRE que o teste tiver duas pessoas ao mesmo tempo.
 */
export async function novaAbaIsolada(chrome, url = "about:blank") {
  const bws = new WebSocket(chrome.alvo);
  await new Promise((res, rej) => {
    bws.addEventListener("open", res, { once: true });
    bws.addEventListener("error", () => rej(new Error("websocket do navegador não abriu")), { once: true });
  });
  const chamar = (metodo, params) =>
    new Promise((res, rej) => {
      const id = Math.floor(Math.random() * 1e9);
      const ouvir = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id !== id) return;
        bws.removeEventListener("message", ouvir);
        m.error ? rej(new Error(`${metodo}: ${m.error.message}`)) : res(m.result);
      };
      bws.addEventListener("message", ouvir);
      bws.send(JSON.stringify({ id, method: metodo, params }));
    });

  // disposeOnDetach:false — senão fechar este socket levaria o contexto junto,
  // e a aba morreria no meio do teste.
  const { browserContextId } = await chamar("Target.createBrowserContext", { disposeOnDetach: false });
  const { targetId } = await chamar("Target.createTarget", { url, browserContextId });
  try { bws.close(); } catch { /* já foi */ }

  const ws = new WebSocket(`ws://127.0.0.1:${chrome.porta}/devtools/page/${targetId}`);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("websocket da aba isolada não abriu")), { once: true });
  });
  const aba = new Aba(ws);
  await aba.preparar();
  aba.alvoId = targetId;
  aba.contextoId = browserContextId;
  return aba;
}
