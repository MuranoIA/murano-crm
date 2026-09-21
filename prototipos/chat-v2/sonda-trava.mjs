// Sonda: a página trava a thread principal ao abrir uma conversa?
//   node prototipos/chat-v2/sonda-trava.mjs [cliente_id] [largura]
// Mede o tempo de um `Runtime.evaluate` trivial a cada meio segundo. Página
// saudável responde em milissegundos; laço de render responde em dezenas de
// segundos ou estoura o timeout do driver.
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const COOKIE = "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br";
let alvo = process.argv[2];
const largura = Number(process.argv[3] || 1280);
if (!alvo) {
  const r = await fetch(`${BASE}/api/chat-v2/lista?limite=60`, { headers: { cookie: COOKIE } });
  alvo = ((await r.json()).conversas ?? []).find((c) => c.carteira_dona && !c.na_fila)?.cliente_id;
}
console.log("alvo", alvo, "largura", largura);
const chrome = await subirChrome({ porta: 9437 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: 860, deviceScaleFactor: 1, mobile: largura < 500 });
  await a.enviar("Page.navigate", { url: `${BASE}/chat-v2?cliente=${encodeURIComponent(alvo)}` });
  for (let i = 0; i < 16; i++) {
    const t0 = Date.now();
    let ok = true;
    try { await a.js(`return document.querySelectorAll('*').length;`); } catch (e) { ok = String(e.message).slice(0, 60); }
    console.log(`t=${i * 0.5}s  resposta em ${Date.now() - t0} ms  ${ok === true ? "" : ok}`);
    await espera(500);
  }
  console.log("excecoes:", a.excecoes.slice(0, 3));
  console.log("console:", a.console.filter((c) => /error|warn/i.test(c)).slice(0, 5));
} finally {
  fecharChrome(chrome);
}
