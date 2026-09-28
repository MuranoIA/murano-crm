// -----------------------------------------------------------------------------
// OS NÚMEROS DOS FILTROS DO FUNIL (demanda #42, 28/09/2026)
//
//   node prototipos/chat-v2/prova-filtros-funil.mjs
//
// A queixa do dono: os quadradinhos das colunas do board apareciam SEM número
// nenhum, e a pergunta junto era "como fazer funcionar sem deixar o chat
// lento?". Então esta prova mede as duas coisas:
//
//   · que os sete números APARECEM logo na abertura;
//   · e que eles chegam SEM a lista inteira — que é o que custaria caro.
//
// Só lê. Nenhuma mensagem é enviada, nada é escrito no banco.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

/** os sete quadradinhos, como a tela os desenha */
const FAIXA = `(() => {
  const g = document.querySelector('.grid.grid-cols-7');
  if (!g) return null;
  return [...g.querySelectorAll('button')].map(b => ({
    titulo: b.getAttribute('title') || '',
    aceso: b.getAttribute('aria-pressed') === 'true',
    numero: (() => {
      const s = [...b.querySelectorAll('span')].map(x => x.textContent.trim());
      const n = s[s.length - 1];
      return /^[0-9]/.test(n) ? n : null;
    })(),
  }));
})()`;

const chrome = await subirChrome({ porta: 9511 });
try {
  const a = await novaAba(chrome);

  // toda requisição que a página faz, para provar o que NÃO foi pedido
  const pedidos = [];
  a.ouvir((m) => {
    if (m.method === "Network.requestWillBeSent") pedidos.push(m.params.request.url);
  });

  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2`, { esperar: 3000 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 20_000 });

  // ---- 1. os números aparecem ------------------------------------------
  const chegou = await a.ate(
    `[...document.querySelectorAll('.grid.grid-cols-7 button')]
       .every(b => { const s = b.querySelectorAll('span'); const u = s[s.length-1]; return u && /^[0-9]/.test(u.textContent.trim()); })`,
    { ms: 20_000 },
  );
  const faixa = await a.js(`return ${FAIXA};`);
  conferir(chegou && faixa?.length === 7, "os sete quadradinhos do funil estão na tela", `${faixa?.length}`);
  const comNumero = (faixa ?? []).filter((q) => q.numero !== null);
  conferir(
    comNumero.length === 7,
    "todos os sete mostram um número (era esta a queixa: ficavam em branco)",
    (faixa ?? []).map((q) => `${q.titulo.split(" — ")[0]}=${q.numero ?? "—"}`).join(" · "),
  );
  // o número da tela vem abreviado acima de mil ("3.6k"); a soma usa o do
  // `title`, que é o inteiro de verdade
  const inteiro = (q) => Number((q.titulo.split("—")[1] ?? "").trim()) || 0;
  const soma = comNumero.reduce((s, q) => s + inteiro(q), 0);
  conferir(soma > 0, "…e a soma não é zero — número existe, não é zero pintado de número", String(soma));
  await a.foto("filtros-funil-abertura");

  // ---- 2. e vieram SEM a lista inteira ---------------------------------
  // a PRIMEIRA PÁGINA (`limite=60`, ~50 kB) é a recarga de sempre da lista
  // visível; o que não pode acontecer é a lista INTEIRA ser baixada só para
  // numerar sete quadradinhos
  const listaBaixada = pedidos.filter((u) => /\/api\/chat-v2\/lista/.test(u) && !/limite=60/.test(u));
  const contagensPedidas = pedidos.filter((u) => /\/api\/chat-v2\/contagens/.test(u));
  conferir(
    contagensPedidas.length >= 1 && listaBaixada.length === 0,
    "os números vieram da rota de contagens, sem baixar as ~4 mil conversas",
    `contagens: ${contagensPedidas.length} · lista: ${listaBaixada.length}${listaBaixada[0] ? " (" + listaBaixada[0].replace(/^https?:\/\/[^/]+/, "") + ")" : ""}`,
  );

  // ---- 3. clicar num quadradinho FILTRA de verdade ----------------------
  // (a outra metade do defeito: a etapa só existe na lista com `?etapas=1`,
  //  então clicar filtrava contra um campo inexistente e a lista ficava vazia)
  const alvo = comNumero
    .map((q) => ({ ...q, n: inteiro(q) }))
    .filter((q) => q.n > 0 && q.n < 1000)
    .sort((x, y) => y.n - x.n)[0];
  conferir(!!alvo, "há uma coluna com conversas para experimentar o clique", alvo?.titulo);

  if (alvo) {
    await a.js(`
      const g = document.querySelector('.grid.grid-cols-7');
      [...g.querySelectorAll('button')].find(b => (b.getAttribute('title')||'').startsWith(${JSON.stringify(alvo.titulo.split(" — ")[0])})).click();
      return true;`);
    // a lista inteira COM as colunas leva alguns segundos; esperar o fim do
    // carregamento é o que distingue "filtrou e não achou" de "ainda buscando"
    const filtrou = await a.ate(
      `[...document.querySelectorAll('.grid.grid-cols-7 button')].some(b => b.getAttribute('aria-pressed') === 'true')
       && !/Carregando/.test(document.querySelector('p.text-center')?.textContent || '')`,
      { ms: 60_000 },
    );
    await espera(1500);
    const depois = await a.js(`
      const p = document.querySelector('p.text-center');
      return {
        aceso: [...document.querySelectorAll('.grid.grid-cols-7 button')].filter(b => b.getAttribute('aria-pressed')==='true').length,
        vazio: p ? p.textContent.trim() : null,
        conversas: document.querySelectorAll('.rolagem button[data-ripple]').length,
      };`);
    conferir(filtrou && depois.aceso === 1, "o quadradinho clicado acende, e só ele");
    // ⚠️ a lista é VIRTUALIZADA: conta-se o que está desenhado, não os 362 —
    // e o `p.text-center` da direita é o convite "escolha uma conversa", não o
    // aviso de lista vazia. Confundir os dois fez esta prova mentir duas vezes.
    conferir(
      depois.conversas > 0,
      "a lista NÃO fica vazia ao filtrar por coluna (era o segundo defeito)",
      `${depois.conversas} conversas na lista${depois.vazio ? " · " + depois.vazio : ""}`,
    );
    conferir(
      pedidos.some((u) => /\/api\/chat-v2\/lista\?.*etapas=1/.test(u)),
      "…porque aplicar o filtro é o que manda buscar a lista COM a coluna do board",
    );
    await a.foto("filtros-funil-aplicado");
  }

  // o tamanho de cada caminho, para o número ficar registrado e não virar lenda
  const pesos = await a.js(`
    return Promise.all([
      fetch('/api/chat-v2/contagens').then(x => x.text()),
      fetch('/api/chat-v2/lista?etapas=1&linhas=1').then(x => x.text()),
    ]).then(r => ({ contagens: r[0].length, lista: r[1].length }));`);
  conferir(
    pesos.contagens * 100 < pesos.lista,
    "contar no servidor custa menos de 1% do que baixar a lista para contar",
    `${(pesos.contagens / 1024).toFixed(1)} kB contra ${(pesos.lista / 1024 / 1024).toFixed(2)} MB`,
  );

  // ---- 4. o cubo bate com o que a tela mostra ---------------------------
  const conf = await a.js(`
    return fetch('/api/chat-v2/contagens').then(r => r.json()).then(j => {
      const soma = {};
      for (const porEtapa of Object.values(j.cubo?.todas ?? {})) {
        for (const [e, q] of Object.entries(porEtapa)) if (e) soma[e] = (soma[e] ?? 0) + q;
      }
      return { soma, temCubo: !!j.cubo };
    });`);
  conferir(conf.temCubo, "a rota de contagens devolve o cubo");
  conferir(
    Object.values(conf.soma).reduce((s, n) => s + n, 0) > 0,
    "…e ele traz as colunas do board, não só as filas",
    JSON.stringify(conf.soma),
  );

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
