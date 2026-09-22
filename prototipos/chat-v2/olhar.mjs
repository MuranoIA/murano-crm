// Abre o /chat-v2 no Chrome headless, tira foto em várias larguras e diz se
// houve exceção ou rolagem horizontal. Screenshot decide layout (§41.5).
//
//   node prototipos/chat-v2/olhar.mjs [--tela /chat-v2] [--cliente <id>]
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:3120";
const arg = (n, p) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : p; };
const TELA = arg("--tela", "/chat-v2");
const LARGURAS = [360, 390, 768, 1024, 1440];

const chrome = await subirChrome({ porta: 9390 });
const aba = await novaAba(chrome);
await aba.preparar();
await aba.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);

for (const largura of LARGURAS) {
  await aba.enviar("Emulation.setDeviceMetricsOverride", {
    width: largura, height: largura < 500 ? 780 : 900, deviceScaleFactor: 1, mobile: largura < 500,
  });
  await aba.ir(`${BASE}${TELA}`, { esperar: 3500 });

  const info = await aba.js(`
    const d = document.documentElement;
    const conversas = [...document.querySelectorAll("button")].filter(b => /\\d{2}:\\d{2}|ontem/.test(b.textContent||"") && (b.textContent||"").length > 12);
    return {
      titulo: document.title,
      erro: /Application error|client-side exception/.test(document.body.textContent||""),
      conversas: conversas.length,
      chips: [...document.querySelectorAll("button")].slice(0,12).map(b=>(b.textContent||"").trim().slice(0,22)).filter(Boolean),
      transborda: d.scrollWidth > d.clientWidth ? d.scrollWidth + " > " + d.clientWidth : "não",
      html: document.body.innerHTML.length,
    };
  `);
  const foto = await aba.foto(`v2-${largura}`);
  console.log(largura + "px", JSON.stringify(info), "->", foto);

  // com a primeira conversa aberta (só na largura de desktop e no celular)
  if (largura === 1440 || largura === 390) {
    const abriu = await aba.js(`
      const b = [...document.querySelectorAll("button")].filter(x => /\\d{2}:\\d{2}|ontem/.test(x.textContent||"") && (x.textContent||"").length > 12);
      if (!b.length) return null; b[0].click(); return (b[0].textContent||"").replace(/\\s+/g," ").slice(0,40);
    `);
    await aba.ate("document.querySelector('textarea')", { ms: 20000, passo: 100 });
    await new Promise((r) => setTimeout(r, 2500));
    if (largura === 1440) {
      await aba.js(`const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('title')==='Dados do cliente'); if(b) b.click(); return true;`);
      await new Promise((r) => setTimeout(r, 2500));
    }
    const dentro = await aba.js(`
      const d=document.documentElement;
      return { bolhas: document.querySelectorAll("[data-msg]").length,
               janela: (document.body.textContent||"").includes("Janela") ,
               transborda: d.scrollWidth > d.clientWidth ? d.scrollWidth+" > "+d.clientWidth : "não" };
    `);
    console.log("   conversa aberta:", abriu, JSON.stringify(dentro), "->", await aba.foto(`v2-${largura}-conversa`));
  }
}

console.log("exceções:", aba.excecoes.length ? aba.excecoes : "nenhuma");
console.log("console:", aba.console.filter((l) => /error/i.test(l)).slice(0, 5));
fecharChrome(chrome);
