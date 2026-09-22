// Sonda: o painel do cliente abre a 360 px na conversa de ensaio?
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
const BASE = process.env.BASE || "http://localhost:3120";
const chrome = await subirChrome({ porta: 9439 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.enviar("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent("wa:559190000077")}`, { esperar: 4000 });
  await a.ate(`document.querySelector('button[aria-label="Dados do cliente"]')`, { ms: 20000 });
  console.log("botões Dados do cliente:", await a.js(`return document.querySelectorAll('button[aria-label="Dados do cliente"]').length;`));
  await a.js(`document.querySelector('button[aria-label="Dados do cliente"]').click(); return true;`);
  for (let i = 0; i < 12; i++) {
    await espera(1500);
    const r = await a.js(`const t=document.body.textContent; return {ficha:t.includes('Ficha para o WinThor'), esq:document.querySelectorAll('.esqueleto').length, erro:(document.querySelector('aside .text-v2-erro')||{}).textContent||null, aside:document.querySelectorAll('aside').length};`);
    console.log(i, JSON.stringify(r));
    if (r.ficha) break;
  }
  console.log(await a.foto("sonda-painel-360"));
  console.log("excecoes", a.excecoes.slice(0, 2));
} finally { fecharChrome(chrome); }
