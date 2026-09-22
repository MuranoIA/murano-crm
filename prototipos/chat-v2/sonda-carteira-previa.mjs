// Foto da agenda (Minha carteira) com a prévia da última mensagem, a 360 px.
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
const BASE = process.env.BASE || "http://localhost:3120";
const chrome = await subirChrome({ porta: 9455 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "romulo", crm_email: "" }, BASE);
  await a.enviar("Emulation.setDeviceMetricsOverride", { width: 360, height: 760, deviceScaleFactor: 1, mobile: true });
  await a.ir(`${BASE}/chat-v2`, { esperar: 5000 });
  await a.js(`document.querySelector('button[aria-haspopup="menu"]').click(); return true;`);
  await a.ate(`document.querySelector('[role=menuitemradio]')`, { ms: 5000 });
  await a.clicarTexto("[role=menuitemradio]", "Minha carteira");
  await a.ate(`/\d+ clientes?/.test(document.body.textContent)`, { ms: 30_000 });
  const n = await a.js(`return [...document.querySelectorAll('.rolagem button')].filter(b => /Você:|🎤|📷/.test(b.textContent) || b.querySelectorAll('span.block').length >= 3).length;`);
  console.log("linhas com prévia visíveis:", n);
  console.log(await a.foto("carteira-previa-360"));
} finally { fecharChrome(chrome); }
