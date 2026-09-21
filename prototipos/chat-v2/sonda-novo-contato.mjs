// Sonda: o "+" abre o diálogo de novo contato? Quanto demora?
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
const BASE = process.env.BASE || "http://localhost:3120";
const chrome = await subirChrome({ porta: 9441 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await a.ir(`${BASE}/chat-v2`, { esperar: 3500 });
  console.log("botão +:", await a.js(`return !!document.querySelector('button[aria-label="Novo contato"]');`));
  await a.js(`document.querySelector('button[aria-label="Novo contato"]').click(); return true;`);
  const t0 = Date.now();
  const ok = await a.ate(`document.querySelector('input[inputmode="tel"]')`, { ms: 45_000 });
  console.log("diálogo abriu:", ok, "em", Date.now() - t0, "ms");
  console.log("excecoes", a.excecoes.slice(0, 2), "rede", a.falhasRede.slice(0, 3));
  await a.foto("sonda-novo-contato");
} finally { fecharChrome(chrome); }
