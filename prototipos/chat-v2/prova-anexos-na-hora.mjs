// -----------------------------------------------------------------------------
// ANEXOS APARECEM NA CONVERSA NA HORA (pedido do piloto, 22/09/2026).
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   node prototipos/chat-v2/prova-anexos-na-hora.mjs
//
// Solta 3 fotos + 1 documento na conversa de ensaio e confere:
//   1. as QUATRO bolhas aparecem antes de qualquer resposta do servidor, a
//      foto com a prévia do próprio arquivo (blob:) e o relógio de "enviando";
//   2. o andamento do upload aparece na bolha;
//   3. liberado o 1º arquivo, SÓ ele troca o relógio pelo tique; os outros
//      seguem esperando;
//   4. um arquivo que falha fica na conversa COM o motivo (não some);
//   5. nenhuma bolha provisória pede a mídia ao servidor (que ainda não a tem).
//
// ⚠️ NADA SAI E NADA SOBE: as três etapas do envio (assinar, subir ao Storage,
// enviar) são interceptadas DENTRO do navegador. Cada arquivo só "sai" quando
// a prova solta a trava dele — é o que permite ver o antes.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9449 });
try {
  for (const largura of [1280, 360]) {
    const a = await novaAba(chrome);
    await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
    await a.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: 860, deviceScaleFactor: 1, mobile: largura < 500 });
    await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 5000 });
    const pronta = await a.ate(`document.querySelector('textarea')`, { ms: 25_000 });
    conferir(pronta, `${largura} px: o ensaio abre com a caixa (janela aberta)`);

    // ---- os três passos do envio, interceptados e com trava ---------------
    await a.js(`
      window.__travas = {};          // nome do arquivo -> resolve()
      window.__midiaPedida = [];     // /api/chat/midia pedidos (não pode haver para tmp:)
      const original = window.fetch;
      window.fetch = function (entrada, opcoes) {
        const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
        if (url.includes('/api/chat/midia')) window.__midiaPedida.push(url);
        if (url.includes('/api/chat/enviar-midia/assinar')) {
          const b = JSON.parse(opcoes.body);
          return Promise.resolve(new Response(JSON.stringify({ path: 'ensaio/' + b.nome, token: 't', mime: b.mime, nome: b.nome }),
            { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        if (url.includes('/api/chat/enviar-midia')) {
          const b = JSON.parse(opcoes.body);
          return new Promise((ok) => {
            window.__travas[b.nome] = (falhar) => ok(falhar
              ? new Response(JSON.stringify({ error: 'ensaio: a Meta recusou este arquivo' }), { status: 400, headers: { 'content-type': 'application/json' } })
              : new Response(JSON.stringify({ ok: true, wamid: 'sim.prova.' + b.nome, tipo: 'image' }), { status: 200, headers: { 'content-type': 'application/json' } }));
          });
        }
        return original.apply(this, arguments);
      };
      // o upload ao Storage é por XHR (para ter o andamento): anda até 50% e fica
      window.XMLHttpRequest = class {
        constructor() { this.upload = {}; this.status = 0; }
        open() {} setRequestHeader() {}
        send() {
          setTimeout(() => this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 }), 150);
          setTimeout(() => { this.status = 200; this.onload && this.onload(); }, 900);
        }
      };
      return true;`);

    // ---- solta 3 fotos + 1 documento --------------------------------------
    const t0 = Date.now();
    // fotos DE VERDADE, desenhadas num canvas: com bytes que não são imagem a
    // prévia aparece quebrada e a prova não enxergaria a miniatura
    await a.js(`
      const cores = ['#621244', '#1a5fa8', '#dd4222'];
      return Promise.all(cores.map((cor) => new Promise((ok) => {
        const c = document.createElement('canvas'); c.width = 320; c.height = 240;
        const g = c.getContext('2d'); g.fillStyle = cor; g.fillRect(0, 0, 320, 240);
        g.fillStyle = '#fff'; g.font = 'bold 48px sans-serif'; g.fillText('ensaio', 70, 135);
        c.toBlob(ok, 'image/png');
      }))).then((f) => { window.__fotos = f; return true; });`);
    await a.js(`
      const alvo = document.querySelector('section');
      const dt = new DataTransfer();
      ['foto1.png','foto2.png','foto3.png'].forEach((n, i) => dt.items.add(new File([window.__fotos[i]], n, { type: 'image/png' })));
      dt.items.add(new File([new Uint8Array([37,80,68,70])], 'pedido.pdf', { type: 'application/pdf' }));
      const ev = (t) => { const e = new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }); alvo.dispatchEvent(e); };
      ev('dragenter'); ev('dragover'); ev('drop');
      return true;`);

    const bolhas = `[...document.querySelectorAll('[data-msg^="tmp:m:"]')]`;
    const apareceram = await a.ate(`${bolhas}.length === 4`, { ms: 3000 });
    conferir(apareceram, `${largura} px: as 4 bolhas aparecem na hora, antes de qualquer resposta`, `${Date.now() - t0} ms`);
    const info = await a.js(`return ${bolhas}.map(b => ({
      blob: !!b.querySelector('img[src^="blob:"]'),
      relogio: !!b.querySelector('[aria-label="enviando"]'),
      doc: /pedido\\.pdf/.test(b.textContent),
    }));`);
    conferir(info.filter((i) => i.blob).length === 3, `${largura} px: as 3 fotos mostram a prévia do próprio arquivo`, JSON.stringify(info));
    conferir(info.every((i) => i.relogio), `${largura} px: todas com o relógio de "enviando"`);
    conferir(info.some((i) => i.doc), `${largura} px: o documento aparece com o nome`);

    const andou = await a.ate(`/50%/.test(${bolhas}.map(b=>b.textContent).join(' '))`, { ms: 4000 });
    conferir(andou, `${largura} px: o andamento do upload aparece na bolha`);
    await a.foto(`anexos-na-hora-subindo-${largura}`);

    // ---- libera SÓ o primeiro --------------------------------------------
    await a.ate(`!!window.__travas['foto1.png']`, { ms: 8000 });
    await a.js(`window.__travas['foto1.png'](false); return true;`);
    const saiu = await a.ate(`(() => { const b = document.querySelector('[data-msg="sim.prova.foto1.png"]'); return b && /✓/.test(b.textContent) && !b.querySelector('[aria-label="enviando"]'); })()`, { ms: 5000 });
    const outrasEsperam = await a.js(`return ${bolhas}.length === 3 && ${bolhas}.every(b => b.querySelector('[aria-label="enviando"]'));`);
    conferir(saiu, `${largura} px: o 1º arquivo enviado troca o relógio pelo tique ✓`);
    conferir(outrasEsperam, `${largura} px: os outros três seguem esperando`);
    const manteve = await a.js(`const b=document.querySelector('[data-msg="sim.prova.foto1.png"]'); return !!(b && b.querySelector('img[src^="blob:"]'));`);
    conferir(manteve, `${largura} px: a foto enviada não pisca (continua com a prévia local)`);

    // ---- um falha, os outros saem -----------------------------------------
    for (const n of ["foto2.png", "foto3.png", "pedido.pdf"]) {
      await a.ate(`!!window.__travas[${JSON.stringify(n)}]`, { ms: 8000 });
      await a.js(`window.__travas[${JSON.stringify(n)}](${n === "foto3.png"}); return true;`);
    }
    const falhaNaBolha = await a.ate(`[...document.querySelectorAll('[data-msg]')].some(b => /Meta recusou/.test(b.textContent))`, { ms: 8000 });
    conferir(falhaNaBolha, `${largura} px: o arquivo que falhou fica na conversa, com o motivo`);
    // e PARA de girar: anel e relógio numa bolha que falhou prometem um envio
    // que não vai acontecer (visto na foto da primeira rodada)
    const parou = await a.js(`const b=[...document.querySelectorAll('[data-msg]')].find(x=>/Meta recusou/.test(x.textContent));
      return !!b && !b.querySelector('[aria-label="enviando"]') && !b.querySelector('svg circle[stroke-dasharray]');`);
    conferir(parou, `${largura} px: a bolha que falhou não gira nem mostra relógio`);
    const fotosOk = await a.js(`return [...document.querySelectorAll('[data-msg] img')].filter(i=>i.src.startsWith('blob:') && i.naturalWidth>0).length;`);
    conferir(fotosOk >= 3, `${largura} px: as miniaturas carregam de verdade`, `${fotosOk} com imagem`);
    const enviados = await a.js(`return document.querySelectorAll('[data-msg^="sim.prova."]').length;`);
    conferir(enviados === 3, `${largura} px: os outros três saíram`, `${enviados} com tique`);
    await a.foto(`anexos-na-hora-fim-${largura}`);

    const pedidoTmp = await a.js(`return window.__midiaPedida.filter(u => /tmp%3A|tmp:/.test(u)).length;`);
    conferir(pedidoTmp === 0, `${largura} px: nenhuma bolha provisória pede a mídia ao servidor`, `${pedidoTmp} pedido(s)`);
    const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
    conferir(!exc.length, `${largura} px: sem exceção`, exc.slice(0, 1).join(""));
    a.enviar("Page.close").catch(() => {}); // a aba some antes de responder
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
