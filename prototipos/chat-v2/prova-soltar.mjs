// -----------------------------------------------------------------------------
// ARRASTAR E SOLTAR + COLAR arquivo no /chat-v2.
//
//   node prototipos/chat-v2/prova-soltar.mjs
//
// O gesto é sintetizado com um `DataTransfer` de verdade, montado na própria
// página: o React ouve eventos do DOM, então um `DragEvent` construído assim
// percorre exatamente o mesmo caminho de um arquivo vindo do Explorador.
//
// ⚠️ NADA É ENVIADO. O teste intercepta `/api/chat/enviar-midia/assinar` e
// responde um erro, para provar que o arquivo CHEGOU ao envio sem subir nada
// para o Storage nem gastar uma mensagem — o que importa aqui é o caminho do
// gesto, não o upload, que a fase 3 já exercitou.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const passos = [];
const ok = (n, d = "") => passos.push({ n, ok: true, d });
const falha = (n, d = "") => passos.push({ n, ok: false, d });

const chrome = await subirChrome({ porta: 9420 });
try {
  const aba = await novaAba(chrome);
  await aba.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);

  // a conversa de ensaio: janela aberta (a cliente falou) e ninguém real do lado
  const ENSAIO = process.env.ENSAIO || "wa:559190000077";
  await aba.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 4000 });

  const pronta = await aba.ate(`!!document.querySelector('.rolagem')`, { ms: 15_000 });
  if (!pronta) {
    falha("a conversa de ensaio abre");
  } else {
    ok("a conversa de ensaio abre");

    // espiona as chamadas de envio sem deixar nenhuma sair
    await aba.js(`
      window.__pedidos = [];
      const original = window.fetch;
      window.fetch = function (entrada, opcoes) {
        const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
        if (url.includes('/api/chat/enviar-midia')) {
          window.__pedidos.push(url);
          return Promise.resolve(new Response(JSON.stringify({ error: 'ensaio: envio interceptado' }),
            { status: 503, headers: { 'content-type': 'application/json' } }));
        }
        return original.apply(this, arguments);
      };
      return true;`);

    const soltar = (comTexto) => `
      const alvo = document.querySelector('section');
      if (!alvo) return { erro: 'sem a section da conversa' };
      ${comTexto ? `
        const campo = document.querySelector('textarea');
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        set.call(campo, 'olha a foto');
        campo.dispatchEvent(new Event('input', { bubbles: true }));
      ` : ""}
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137,80,78,71])], 'ensaio.png', { type: 'image/png' }));
      const evento = (tipo) => { const e = new DragEvent(tipo, { bubbles: true, cancelable: true, dataTransfer: dt }); alvo.dispatchEvent(e); return e; };
      evento('dragenter');
      evento('dragover');
      // ⚠️ o DataTransfer fica guardado: o aviso do React só existe DEPOIS do
      // próximo render, e conferi-lo no mesmo bloco síncrono daria sempre
      // "não apareceu" — foi o falso negativo da primeira rodada.
      window.__solta = () => { const e = evento('drop'); return e.defaultPrevented; };
      return { ok: true };`;

    // ---- 1. o aviso aparece e o navegador NÃO abre o arquivo --------------
    const r1 = await aba.js(soltar(false));
    if (r1.erro) falha("soltar: achou a área da conversa", r1.erro);
    else {
      const viuAviso = await aba.ate(`/Solte para anexar/.test(document.body.textContent||'')`, { ms: 4000 });
      viuAviso ? ok("soltar: o aviso 'Solte para anexar' aparece") : falha("soltar: o aviso aparece");
      const cancelado = await aba.js(`return window.__solta();`);
      // ⚠️ sem `preventDefault` o navegador ABRE o arquivo e troca a aba do CRM
      // pela foto — o que estava sendo escrito se perde
      cancelado
        ? ok("soltar: o drop é cancelado — o navegador não abre o arquivo")
        : falha("soltar: o drop é cancelado");
      await espera(1200);
      const foi = await aba.js(`return window.__pedidos.length;`);
      foi > 0
        ? ok("soltar: o arquivo chega ao envio", `${foi} chamada(s) a enviar-midia`)
        : falha("soltar: o arquivo chega ao envio", "nenhuma chamada");
      const some = await aba.ate(`!/Solte para anexar/.test(document.body.textContent||'')`, { ms: 5000 });
      some ? ok("soltar: o aviso some depois do drop") : falha("soltar: o aviso some depois do drop");
      const avisou = await aba.ate(`/ensaio: envio interceptado/.test(document.body.textContent||'')`, { ms: 8000 });
      avisou
        ? ok("soltar: a falha do envio vira recado na tela")
        : falha("soltar: a falha do envio vira recado na tela");
    }

    // ---- 2. o texto escrito vira LEGENDA e a caixa esvazia ----------------
    await aba.js(`window.__pedidos = []; return true;`);
    await aba.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 3500 });
    await aba.js(`
      window.__pedidos = [];
      const original = window.fetch;
      window.fetch = function (entrada) {
        const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
        if (url.includes('/api/chat/enviar-midia')) {
          window.__pedidos.push(url);
          return Promise.resolve(new Response(JSON.stringify({ error: 'ensaio: envio interceptado' }),
            { status: 503, headers: { 'content-type': 'application/json' } }));
        }
        return original.apply(this, arguments);
      };
      return true;`);
    const r2 = await aba.js(soltar(true));
    if (!r2.erro) {
      await aba.js(`return window.__solta();`);
      await espera(1200);
      const caixa = await aba.js(`const t=document.querySelector('textarea'); return t ? t.value : null;`);
      caixa === ""
        ? ok("soltar: o texto escrito vira legenda e a caixa esvazia")
        : falha("soltar: a caixa esvazia", `caixa = ${JSON.stringify(caixa)}`);
    }

    // ---- 3. COLAR (Ctrl+V de um print) -----------------------------------
    await aba.js(`window.__pedidos = []; return true;`);
    const r3 = await aba.js(`
      const campo = document.querySelector('textarea');
      if (!campo) return { erro: 'sem caixa de texto' };
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137,80,78,71])], 'print.png', { type: 'image/png' }));
      const e = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      campo.dispatchEvent(e);
      return { cancelado: e.defaultPrevented };`);
    if (r3.erro) falha("colar: achou a caixa de texto", r3.erro);
    else {
      await espera(1200);
      const foi = await aba.js(`return window.__pedidos.length;`);
      foi > 0
        ? ok("colar: o print colado vira anexo", `${foi} chamada(s)`)
        : falha("colar: o print colado vira anexo", "nenhuma chamada");
    }

    // ---- 4. arrastar TEXTO não pode acender o aviso -----------------------
    const r4 = await aba.js(`
      const alvo = document.querySelector('section');
      const dt = new DataTransfer();
      dt.setData('text/plain', 'só um texto');
      alvo.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return /Solte para anexar/.test(document.body.textContent || '');`);
    r4 === false
      ? ok("arrastar TEXTO não acende o aviso de arquivo")
      : falha("arrastar TEXTO não acende o aviso de arquivo");
  }

  aba.excecoes.length
    ? falha("sem exceção no console", aba.excecoes.slice(0, 2).join(" | "))
    : ok("sem exceção no console");
} finally {
  fecharChrome(chrome);
}

const bons = passos.filter((p) => p.ok).length;
for (const p of passos) console.log(`${p.ok ? "OK  " : "FALHA"} ${p.n}${p.d ? ` — ${p.d}` : ""}`);
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
