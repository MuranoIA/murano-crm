// Foto do botão de filas e do menu aberto, em 1280 e 360 px.
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
const BASE = process.env.BASE || "http://localhost:3120";
const chrome = await subirChrome({ porta: 9447 });
try {
  for (const w of [360, 1280]) {
    const a = await novaAba(chrome);
    await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
    await a.enviar("Emulation.setDeviceMetricsOverride", { width: w, height: 700, deviceScaleFactor: 1, mobile: w < 500 });
    await a.ir(`${BASE}/chat-v2`, { esperar: 6000 });
    await a.foto(`menu-filas-fechado-${w}`);
    await a.js(`document.querySelector('button[aria-haspopup="menu"]').click(); return true;`);
    await a.ate(`document.querySelector('[role=menuitemradio]')`, { ms: 5000 });
    console.log(await a.foto(`menu-filas-aberto-${w}`));
    await a.enviar("Page.close");
  }
} finally { fecharChrome(chrome); }
