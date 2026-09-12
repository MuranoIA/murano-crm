// -----------------------------------------------------------------------------
// Regressão — o envio de arquivos de UMA conversa não trava as outras.
//
// Relatado em 12/09/2026 com dois prints: o consultor manda 19 fotos para a
// cliente A, abre a cliente B para mandar outras, e em B aparece
// "enviando 9 de 19" — o contador de A — com o clipe DESABILITADO. Duas
// conversas, uma trava só.
//
// A causa era estado do COMPONENTE em vez de estado da CONVERSA:
// `enviandoArquivo` (booleano) e `fila` ({feito,total,pct}) eram globais do
// /chat. `enviarArquivos` já guardava a conversa de origem e já protegia as
// MENSAGENS (`sePermanece`); faltou o progresso.
//
// ⚠️ Escreve na faixa de ensaio, que NUNCA chega à Meta (lib/ensaio.ts) — e a
// limpeza remove também os objetos do bucket.
// -----------------------------------------------------------------------------
import { espera } from "../ajuda.mjs";
import { clienteEscreve, idFicticio, resolverLinha, limparEnsaio, arquivosDeEnsaio } from "../simulacao.mjs";

export const ciclo = "Regressão — envio de arquivos é por conversa, não do chat";

const A = 81, B = 82;

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  const IDA = idFicticio(A), IDB = idFicticio(B);
  await resolverLinha(db);

  await t.passo("1. duas clientes de ensaio, cada uma com conversa", "✅", async () => {
    for (const [n, id] of [[A, IDA], [B, IDB]]) {
      const r = await clienteEscreve(n, `[QA] oi, sou a ${n}`, `Cliente Ensaio ${n}`);
      api.igual(r.status, 200, `webhook da cliente ${n}`);
      db.anotarRastro(`ensaio ${id}`, async () => { await limparEnsaio(db.sb); });
    }
    return `${IDA} e ${IDB}`;
  });

  await t.passo("2. enviando em A, a conversa B continua livre", "✅", async () => {
    let chrome;
    try { chrome = await t.chrome(); }
    catch (e) { throw new Error("PULAR:" + String(e.message).replace(/^PULAR:/, "")); }

    const aba = await t.aba();
    await aba.cookies(api.SESSOES.admin, api.BASE);
    await aba.ir(`${api.BASE}/chat?cliente=${encodeURIComponent(IDA)}`, { esperar: 2000 });
    api.ok(await aba.ate("!!document.querySelector('textarea')", { ms: 90_000, passo: 500 }),
      "a conversa A não abriu");

    // Estado do clipe: o rótulo vira contador enquanto envia, e ele desabilita.
    //
    // ⚠️ Escrito como EXPRESSÃO, não como bloco com `return`. `aba.js` embrulha
    // em função (precisa de `return`) e `aba.ate` embrulha em `!!(...)` (precisa
    // de expressão) — um texto só para os dois vira `( ...statements... )()`,
    // que é erro de sintaxe. E `ate` engole a exceção, então a falha aparecia
    // como "o envio não chegou a começar", culpando o produto.
    const CLIPE = `(() => { const b = [...document.querySelectorAll('button')]`
      + `.find(x => /Anexar|anexo|arquivo|foto/i.test(x.getAttribute('title') || ''));`
      + ` return b ? { txt: (b.textContent || '').trim(), travado: b.disabled } : null; })()`;
    const lerClipe = () => aba.js(`return ${CLIPE};`);
    // ⚠️ BUSCA a conversa B em vez de procurá-la na lista aberta. A sidebar
    // nasce em "Meus atendimentos", e cliente de ensaio entra SEM DONO — ficava
    // fora daquela fila, e o teste acusava o produto ("não consegui abrir a
    // conversa B") por uma escolha de filtro. A busca é local e não depende de
    // qual fila está selecionada.
    api.ok(await aba.ate("!!document.querySelector('input[placeholder*=\"Buscar\"]')", { ms: 90_000, passo: 1000 }),
      "a barra lateral não carregou (sem campo de busca)");
    // A fila "Sem dono" primeiro: a busca filtra DENTRO da fila aberta, e a
    // sidebar nasce em "Meus atendimentos".
    api.ok(await aba.js(`
      const alvo = [...document.querySelectorAll('button,div')]
        .filter(e => /Sem dono/.test(e.textContent || '') && e.children.length <= 3)
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
      if (!alvo) return false;
      (alvo.closest('button') || alvo).click();
      return true;
    `), 'não achei a fila "Sem dono"');
    await espera(800);
    api.ok(await aba.digitar('input[placeholder*="Buscar"]', `Ensaio ${B}`), "não consegui digitar na busca");
    api.ok(await aba.ate(`document.body.textContent.includes("Cliente Ensaio ${B}")`, { ms: 30_000, passo: 500 }),
      `a busca não achou a Cliente Ensaio ${B}`);

    const antes = await lerClipe();
    api.ok(antes, "não achei o botão de anexo");
    api.ok(!antes.travado, "o clipe já nasceu travado, sem nenhum envio em andamento");

    // ---- dispara um lote em A ----------------------------------------------
    // Vários arquivos para o envio durar o suficiente para trocar de conversa.
    const { imagem } = arquivosDeEnsaio();
    const caminhos = [];
    const fs = await import("node:fs");
    const { Buffer } = await import("node:buffer");
    const os = await import("node:os");
    const path = await import("node:path");
    // ⚠️ ARQUIVOS GRANDES de propósito. Com os JPEGs de 1x1 da suíte (600 bytes)
    // o lote inteiro subia entre duas leituras da sonda e o teste não via o
    // contador — falhava dizendo "o envio não chegou a começar", que é sintoma
    // da MEDIÇÃO, não do produto. ~2,5 MB cada também exercita a barra de
    // porcentagem, que só aparece acima de 2 MB.
    const enchimento = Buffer.alloc(2_500_000, 0);
    for (let i = 0; i < 4; i++) {
      const p = path.join(os.tmpdir(), `qa-envio-${i}.jpg`);
      fs.writeFileSync(p, Buffer.concat([imagem.bytes, enchimento]));
      caminhos.push(p);
    }
    const no = await aba.enviar("DOM.getDocument", { depth: -1 });
    const achado = await aba.enviar("DOM.querySelector", { nodeId: no.root.nodeId, selector: 'input[type="file"]' });
    api.ok(achado.nodeId, "não achei o input de arquivo");
    await aba.enviar("DOM.setFileInputFiles", { nodeId: achado.nodeId, files: caminhos });

    // espera o envio COMEÇAR (o clipe vira contador)
    const comecou = await aba.ate(`${CLIPE}?.travado === true`, { ms: 20_000, passo: 200 });
    api.ok(comecou, "o envio não chegou a começar — o clipe nunca travou");
    const emA = await lerClipe();

    // ---- troca para B NO MEIO do envio -------------------------------------
    // Troca pela SIDEBAR, nunca por navegação: um `Page.navigate` remontaria a
    // tela e mataria o envio em andamento — que é justamente o que o caso mede.
    const trocou = await aba.js(`
      const alvos = [...document.querySelectorAll('*')].filter(e =>
        e.children.length === 0 && (e.textContent || '').includes('Cliente Ensaio ${B}'));
      for (const a of alvos) {
        let n = a;
        for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.cursor === 'pointer' || n.onclick) { n.click(); return { ok: true, via: n.tagName }; }
        }
      }
      return { ok: false, candidatos: alvos.length,
               amostra: [...document.querySelectorAll('*')]
                 .filter(e => e.children.length === 0 && /Ensaio/.test(e.textContent||''))
                 .slice(0,6).map(e => (e.textContent||'').trim().slice(0,40)) };
    `);
    api.ok(trocou.ok,
      `não consegui abrir a conversa da Cliente Ensaio ${B} — candidatos: ${trocou.candidatos}, na tela: ${JSON.stringify(trocou.amostra)}`);
    await espera(1200);

    const emB = await lerClipe();
    const foto = await aba.foto("envio_por_conversa");

    api.ok(emB, "o clipe sumiu na conversa B");
    api.ok(!emB.travado,
      `a conversa B ficou TRAVADA pelo envio da A (clipe "${emB.txt}") — foto ${foto}`);
    api.ok(emB.txt !== emA.txt,
      `a conversa B está mostrando o contador da A ("${emB.txt}") — foto ${foto}`);
    api.ok(aba.excecoes.length === 0, `exceção de JS: ${JSON.stringify(aba.excecoes.slice(0, 3))}`);

    return `A mostrava "${emA.txt}" (travado) e B ficou "${emB.txt}" (livre) · foto ${foto}`;
  });

  await t.passo("3. a faixa de ensaio sai do banco e do bucket", "✅", async () => {
    const relato = await limparEnsaio(db.sb);
    return relato.join(" · ");
  });
}
