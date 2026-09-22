// -----------------------------------------------------------------------------
// TOCAR NA FOTO AMPLIA (pedido do piloto, 22/09/2026).
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   node prototipos/chat-v2/prova-imagem-ampliar.mjs
//
// Manda uma foto na conversa de ENSAIO — com o envio interceptado dentro do
// navegador, nada sobe e nada sai — e confere, a 1280 e a 360 px:
//   1. enquanto sobe, a foto NÃO amplia (ainda não é a que a cliente recebeu);
//   2. enviada, tocar nela abre a imagem ampliada, por cima de tudo;
//   3. tocar NA foto ampliada não fecha; tocar fora fecha; Esc fecha;
//   4. "Abrir em nova aba" e "Baixar" estão lá.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });
const dialogo = `document.querySelector('[role=dialog][aria-label="Imagem ampliada"]')`;

const chrome = await subirChrome({ porta: 9457 });
try {
  for (const largura of [1280, 360]) {
    const a = await novaAba(chrome);
    await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
    await a.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: 820, deviceScaleFactor: 1, mobile: largura < 500 });
    await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 5000 });
    await a.ate(`document.querySelector('textarea')`, { ms: 25_000 });

    // envio interceptado: a foto só "sai" quando a prova solta a trava
    await a.js(`
      window.__trava = null;
      const original = window.fetch;
      window.fetch = function (entrada, opcoes) {
        const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
        if (url.includes('/api/chat/enviar-midia/assinar')) {
          const b = JSON.parse(opcoes.body);
          return Promise.resolve(new Response(JSON.stringify({ path: 'ensaio/' + b.nome, token: 't', mime: b.mime, nome: b.nome }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        if (url.includes('/api/chat/enviar-midia')) {
          return new Promise((ok) => { window.__trava = () => ok(new Response(JSON.stringify({ ok: true, wamid: 'sim.amplia.${largura}', tipo: 'image' }), { status: 200, headers: { 'content-type': 'application/json' } })); });
        }
        return original.apply(this, arguments);
      };
      window.XMLHttpRequest = class { constructor() { this.upload = {}; } open() {} setRequestHeader() {}
        send() { setTimeout(() => { this.status = 200; this.onload && this.onload(); }, 300); } };
      return new Promise((ok) => {
        const c = document.createElement('canvas'); c.width = 600; c.height = 400;
        const g = c.getContext('2d'); g.fillStyle = '#1a5fa8'; g.fillRect(0, 0, 600, 400);
        g.fillStyle = '#fff'; g.font = 'bold 60px sans-serif'; g.fillText('ampliar', 170, 220);
        c.toBlob((blob) => {
          const dt = new DataTransfer(); dt.items.add(new File([blob], 'amplia.png', { type: 'image/png' }));
          const alvo = document.querySelector('section');
          for (const t of ['dragenter', 'dragover', 'drop']) alvo.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
          ok(true);
        }, 'image/png');
      });`);

    // 1. subindo: sem botão de ampliar
    await a.ate(`document.querySelector('[data-msg^="tmp:m:"] img')`, { ms: 5000 });
    const ampliaSubindo = await a.js(`return !!document.querySelector('[data-msg^="tmp:m:"] button[aria-label="Ampliar a imagem"]');`);
    conferir(!ampliaSubindo, `${largura} px: enquanto sobe, a foto não amplia`);

    // 2. enviada: tocar amplia
    await a.ate(`!!window.__trava`, { ms: 8000 });
    await a.js(`window.__trava(); return true;`);
    const bolha = `document.querySelector('[data-msg="sim.amplia.${largura}"]')`;
    await a.ate(`${bolha} && ${bolha}.querySelector('button[aria-label="Ampliar a imagem"]')`, { ms: 8000 });
    await a.js(`${bolha}.querySelector('button[aria-label="Ampliar a imagem"]').click(); return true;`);
    const abriu = await a.ate(`${dialogo} && ${dialogo}.querySelector('img')`, { ms: 3000 });
    conferir(abriu, `${largura} px: tocar na foto enviada abre a imagem ampliada`);
    const cobre = await a.js(`const d=${dialogo}.getBoundingClientRect(); return d.width>=innerWidth-1 && d.height>=innerHeight-1;`);
    conferir(cobre, `${largura} px: a imagem ampliada cobre a tela toda`);
    const grande = await a.js(`const i=${dialogo}.querySelector('img').getBoundingClientRect(); return Math.round(i.width);`);
    conferir(grande > 260, `${largura} px: a foto fica maior que na bolha`, `${grande} px de largura`);
    const botoes = await a.js(`return [...${dialogo}.querySelectorAll('a')].map(x=>x.textContent.trim());`);
    conferir(botoes.includes("Abrir em nova aba") && botoes.includes("Baixar"), `${largura} px: "Abrir em nova aba" e "Baixar"`, botoes.join(" · "));
    await a.foto(`imagem-ampliada-${largura}`);

    // 3. tocar na foto não fecha; fora fecha; Esc fecha
    await a.js(`${dialogo}.querySelector('img').click(); return true;`);
    await espera(200);
    conferir(await a.js(`return !!${dialogo};`), `${largura} px: tocar na foto ampliada não fecha`);
    await a.js(`${dialogo}.click(); return true;`);
    conferir(await a.ate(`!${dialogo}`, { ms: 2000 }), `${largura} px: tocar fora fecha`);
    await a.js(`${bolha}.querySelector('button[aria-label="Ampliar a imagem"]').click(); return true;`);
    await a.ate(`${dialogo}`, { ms: 2000 });
    await a.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true;`);
    conferir(await a.ate(`!${dialogo}`, { ms: 2000 }), `${largura} px: Esc fecha`);

    const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
    conferir(!exc.length, `${largura} px: sem exceção`, exc.slice(0, 1).join(""));
    a.enviar("Page.close").catch(() => {});
  }
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
