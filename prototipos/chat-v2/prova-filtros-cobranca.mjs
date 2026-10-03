// -----------------------------------------------------------------------------
// OS FILTROS DE COBRANÇA, E O CABEÇALHO MAIS BAIXO (demanda #64, 03/10/2026)
//
//   npx next start -p 3122      (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-filtros-cobranca.mjs
//
// Duas entregas do mesmo pedido do dono, que vieram juntas porque uma resolve
// a outra: o cabeçalho da lista encolheu, e os filtros de cobrança moram num
// popover — que custa zero altura quando fechado.
//
// ⚠️ SÓ LÊ. Não cria cobrança, não envia nada.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3122";
const EU = "ia@muranoprofessional.com.br";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9699 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: EU }, BASE);
  await a.ir(`${BASE}/chat-v2`, { esperar: 4000 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 30_000 });
  await espera(3000);

  // ---- 1. o cabeçalho encolheu -----------------------------------------
  //
  // ⚠️ MEDIDO CONTRA O NÚMERO DE ANTES, não contra "parece menor". O
  // cabeçalho ocupava 353 px de uma janela de 804 — 44% de controle. O alvo
  // é ficar abaixo de 300.
  const alto = await a.js(`
    const cands = [...document.querySelectorAll('div')].filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 250 && r.width < 430 && r.height > 250 && e.scrollHeight > e.clientHeight + 40;
    }).sort((x, y) => y.getBoundingClientRect().height - x.getBoundingClientRect().height);
    const r = cands[0] && cands[0].getBoundingClientRect();
    return r ? { topo: Math.round(r.top), janela: innerHeight } : null;`);
  conferir(
    alto && alto.topo < 300,
    "o cabeçalho da lista cabe em menos de 300 px (antes: 353)",
    alto ? `${alto.topo} px de ${alto.janela}` : "não medi",
  );

  // ---- 2. a ordenação virou texto, não botão ---------------------------
  // ⚠️ A ordenação passou por TRÊS formas em 03/10 (rótulo, texto, quadrado).
  // Por isso esta prova afirma a FORMA e o LUGAR, não o texto: um teste que
  // procurasse "↓ recentes" quebraria a cada volta do desenho sem que nada
  // estivesse errado.
  const ordem = await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /primeiro$/.test(x.getAttribute('aria-label')||''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const busca = document.querySelector('input[placeholder*="Buscar"]');
    const rb = busca && busca.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), abaixoDaBusca: !!(rb && r.top > rb.bottom) };`);
  conferir(!!ordem, "a ordenação está na tela", ordem ? `${ordem.w}x${ordem.h}` : "não achei");
  conferir(ordem && ordem.w === ordem.h, "…como botão QUADRADO", ordem ? `${ordem.w}x${ordem.h}` : "");
  conferir(
    ordem && ordem.abaixoDaBusca,
    "…e na faixa dos filtros, não na linha da busca — onde o dono quis",
  );

  // ---- 3. o quadrado de dívida -----------------------------------------
  const quad = await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === 'Com dívida');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), temContador: !!b.querySelector('span') };`);
  conferir(quad && quad.w === quad.h && quad.w <= 44, "o filtro de dívida é um quadrado", quad ? `${quad.w}x${quad.h}` : "não achei");

  // ---- 4. o popover SÓ aparece com o filtro ligado ---------------------
  //
  // ⚠️ É a regra que protege o gesto de todo dia: "mostre quem deve" tem de
  // custar UM clique. Se o botão de filtros existisse sempre, ele seria mais
  // um ícone competindo pelo espaço que esta mesma entrega foi recuperar.
  const antes = await a.js(`
    return !![...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === 'Filtros de cobrança');`);
  conferir(!antes, "com o filtro DESLIGADO, o botão de filtros nem existe");

  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === 'Com dívida');
    if (b) b.click(); return !!b;`);
  const apareceu = await a.ate(
    `!![...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === 'Filtros de cobrança')`,
    { ms: 20_000 },
  );
  conferir(apareceu, "…e aparece assim que o filtro liga");

  // ---- 5. o popover abre com as três perguntas ------------------------
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === 'Filtros de cobrança');
    if (b) b.click(); return !!b;`);
  const abriu = await a.ate(`/Tempo de atraso/.test(document.body.textContent || '')`, { ms: 20_000 });
  conferir(abriu, "o popover abre");

  const dentro = await a.js(`
    const t = (document.body.textContent || '').replace(/\\s+/g, ' ');
    const faixas = ['Tudo em aberto','Ainda a vencer','Até 30 dias','31 a 90 dias','91 a 180 dias','Mais de 180 dias'];
    const ordens = ['Atividade','Maior valor','Maior atraso','Nome'];
    return {
      temAtraso: /Tempo de atraso/.test(t),
      temVendeu: /Quem vendeu/.test(t),
      temOrdenar: /Ordenar por/.test(t),
      faixas: faixas.filter(f => t.includes(f)).length,
      ordens: ordens.filter(o => t.includes(o)).length,
      // cada faixa traz o próprio número de clientes
      comContagem: [...document.querySelectorAll('button')]
        .filter(b => /^(Tudo em aberto|Ainda a vencer|Até 30 dias|31 a 90 dias|91 a 180 dias|Mais de 180 dias) \\d+$/.test((b.textContent||'').replace(/\\s+/g,' ').trim())).length,
    };`);
  conferir(dentro.temAtraso && dentro.temVendeu && dentro.temOrdenar, "…com as três perguntas do painel de cobrança");
  conferir(dentro.faixas === 6, "…as seis faixas de atraso", `${dentro.faixas} de 6`);
  conferir(dentro.ordens === 4, "…as quatro ordenações", `${dentro.ordens} de 4`);
  conferir(
    dentro.comContagem >= 5,
    "…e cada faixa diz QUANTOS clientes tem — senão a lista vazia não se explica",
    `${dentro.comContagem} faixas com contagem`,
  );

  // ---- 6. ordenar por valor MUDA a lista, e avisa ----------------------
  // ⚠️ ESPERA POR CONDIÇÃO, não por relógio. Ligar o filtro manda buscar a
  // LISTA INTEIRA (os devedores podem não estar na primeira página), e com um
  // `sleep` fixo a prova media a lista ainda vazia: ela acusava "a ordenação
  // não funciona" comparando duas listas de zero itens. O produto estava certo
  // nas duas vezes em que isso aconteceu.
  await a.ate(
    `[...document.querySelectorAll('button')].filter(b => /\\d{1,5} - [A-Z\u00c0-\u00da]/.test((b.textContent||'').replace(/\\s+/g,' ')) && b.getBoundingClientRect().height > 50).length > 0`,
    { ms: 30_000 },
  );

  const antesDaOrdem = await a.js(`
    // ⚠️ as linhas sao achadas pelo FORMATO do rotulo (codigo - NOME), nao
    // por um container rolavel: com o filtro ligado a lista encurta, para de
    // rolar, e o seletor por container devolvia null -- a prova entao comparava
    // duas listas VAZIAS e concluia que nada tinha reordenado.
    const its = [...document.querySelectorAll('button')].filter(
      (b) => /\\d{1,5} - [A-Z\u00c0-\u00da]/.test((b.textContent || '').replace(/\\s+/g, ' ')) && b.getBoundingClientRect().height > 50,
    );
    return its.slice(0, 5).map(b => (b.textContent||'').slice(0, 24));`);
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Maior valor');
    if (b) b.click(); return !!b;`);
  await espera(900);
  const depoisDaOrdem = await a.js(`
    // ⚠️ as linhas sao achadas pelo FORMATO do rotulo (codigo - NOME), nao
    // por um container rolavel: com o filtro ligado a lista encurta, para de
    // rolar, e o seletor por container devolvia null -- a prova entao comparava
    // duas listas VAZIAS e concluia que nada tinha reordenado.
    const its = [...document.querySelectorAll('button')].filter(
      (b) => /\\d{1,5} - [A-Z\u00c0-\u00da]/.test((b.textContent || '').replace(/\\s+/g, ' ')) && b.getBoundingClientRect().height > 50,
    );
    return {
      topo: its.slice(0, 5).map(b => (b.textContent||'').slice(0, 24)),
      avisa: /sai da ordem por atividade/.test(document.body.textContent || ''),
    };`);
  conferir(
    JSON.stringify(antesDaOrdem) !== JSON.stringify(depoisDaOrdem.topo),
    "ordenar por maior valor REORDENA a lista de verdade",
  );
  conferir(
    depoisDaOrdem.avisa,
    "…e a tela avisa que saiu da ordem cronológica — ninguém fica sem entender",
  );

  // ---- 7. desligar o filtro devolve a ordem ---------------------------
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === 'Com dívida');
    if (b) b.click(); return !!b;`);
  await espera(900);
  const limpo = await a.js(`
    return {
      aindaAvisa: /sai da ordem por atividade/.test(document.body.textContent || ''),
      temBotaoFiltros: !![...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === 'Filtros de cobrança'),
    };`);
  conferir(!limpo.aindaAvisa && !limpo.temBotaoFiltros, "desligar o filtro devolve a ordem e recolhe os controles");

  await a.foto("filtros-cobranca");

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "OK " : "XX "} ${p.n}${p.d ? `  -- ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
