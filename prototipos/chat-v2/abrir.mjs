// Abre o /chat-v2 numa janela de verdade do Chrome, JÁ LOGADO.
//
//   node prototipos/chat-v2/abrir.mjs                 (admin)
//   node prototipos/chat-v2/abrir.mjs --sessao romulo (como um consultor)
//   node prototipos/chat-v2/abrir.mjs --tela /chat     (o chat de hoje, p/ comparar)
//
// Por que existe: o login do CRM é um cookie de texto puro (`crm_sessao`,
// web/lib/papel.ts). Em vez de pedir para digitar senha a cada vez que houver
// algo para ver, esta janela nasce com o cookie posto.
//
// ⚠️ PERFIL PRÓPRIO, separado do Chrome do dia a dia: a janela não enxerga as
// abas nem as contas abertas no navegador pessoal, e o cookie de admin fica
// preso a ela. O perfil é persistente (`.chrome-v2/`, ignorado pelo git), então
// da segunda vez em diante ela já abre logada sozinha.
//
// ⚠️ Aponta para o SERVIDOR LOCAL (porta 3120 por padrão). Nada aqui toca em
// produção.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const arg = (n, p) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : p; };

const BASE = arg("--base", "http://127.0.0.1:3120");
const TELA = arg("--tela", "/chat-v2");
const SESSAO = arg("--sessao", "admin");
const EMAIL = arg("--email", "ia@muranoprofessional.com.br");
const PORTA_CDP = Number(arg("--cdp", 9400));
// metade direita de uma tela 1920x1080 por padrão; `--posicao`/`--tamanho` mudam
const POSICAO = arg("--posicao", "768,0");
const TAMANHO = arg("--tamanho", "768,816");

const CANDIDATOS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : null,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const chrome = CANDIDATOS.find((c) => existsSync(c));
if (!chrome) { console.error("Chrome não encontrado."); process.exit(1); }

// o servidor precisa estar no ar — dizer isso agora é melhor que uma janela
// em branco com "não foi possível acessar o site"
const r = await fetch(`${BASE}${TELA}`).catch(() => null);
if (!r) {
  console.error(`O servidor local não respondeu em ${BASE}.\nSuba com:  cd web && npx next start -p 3120`);
  process.exit(1);
}

const perfil = join(RAIZ, ".chrome-v2");
mkdirSync(perfil, { recursive: true });

// ---- a janela já está aberta? então é só recarregar -----------------------
// Quem está acompanhando o trabalho ao vivo não quer uma janela nova a cada
// mudança: quer a MESMA janela mostrando a versão nova.
let alvo = null;
try {
  const v = await fetch(`http://127.0.0.1:${PORTA_CDP}/json/version`, { signal: AbortSignal.timeout(800) });
  if (v.ok) alvo = await v.json();
} catch { /* não há janela nossa aberta */ }

if (!alvo) {
  // metade direita da tela, para ficar ao lado do editor
  const proc = spawn(
    chrome,
    [
      `--remote-debugging-port=${PORTA_CDP}`,
      `--user-data-dir=${perfil}`,
      "--no-first-run", "--no-default-browser-check", "--disable-sync",
      `--window-position=${POSICAO}`,
      `--window-size=${TAMANHO}`,
      "about:blank",
    ],
    { stdio: "ignore", detached: true },
  );
  proc.unref(); // a janela continua viva depois que este script termina

  for (let i = 0; i < 100 && !alvo; i++) {
    try {
      const v = await fetch(`http://127.0.0.1:${PORTA_CDP}/json/version`);
      if (v.ok) alvo = await v.json();
    } catch { await new Promise((s) => setTimeout(s, 200)); }
  }
  if (!alvo) { console.error("O Chrome abriu, mas a porta de depuração não."); process.exit(1); }
}

// a aba: pega a que já existe (about:blank) em vez de abrir outra
const abas = await (await fetch(`http://127.0.0.1:${PORTA_CDP}/json/list`)).json();
const aba = abas.find((a) => a.type === "page") ?? abas[0];

const ws = new WebSocket(aba.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const enviar = (method, params = {}) =>
  new Promise((res) => {
    const meu = ++id;
    const ouvir = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === meu) { ws.removeEventListener("message", ouvir); res(m.result); }
    };
    ws.addEventListener("message", ouvir);
    ws.send(JSON.stringify({ id: meu, method, params }));
  });

const { hostname } = new URL(BASE);
await enviar("Network.enable");
// `crm_sessao` é o login inteiro (papel.ts); `crm_email` é quem escreve —
// marca de leitura, autoria de nota (chatUsuario.ts)
await enviar("Network.setCookie", { name: "crm_sessao", value: SESSAO, domain: hostname, path: "/" });
await enviar("Network.setCookie", { name: "crm_email", value: EMAIL, domain: hostname, path: "/" });
await enviar("Page.navigate", { url: `${BASE}${TELA}` });
// ⚠️ e recarrega ignorando cache: navegar para a MESMA url de uma janela que já
// estava aberta pode não recarregar nada, e aí a pessoa fica olhando o build
// anterior achando que a mudança não saiu. Custou uma rodada em 20/09/2026.
await new Promise((s) => setTimeout(s, 600));
await enviar("Page.enable");
await enviar("Page.reload", { ignoreCache: true });

console.log(`aberto: ${BASE}${TELA}  (sessão: ${SESSAO})`);
console.log("a janela continua aberta depois que este comando termina.");
setTimeout(() => process.exit(0), 1500);
