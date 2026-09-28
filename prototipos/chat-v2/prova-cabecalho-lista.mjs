// -----------------------------------------------------------------------------
// O CABEÇALHO DA LISTA, NO FORMATO QUE O TIME PEDIU (demanda #35, 27/09/2026)
//
//   node prototipos/chat-v2/prova-cabecalho-lista.mjs
//
// O time usou o chat-v2 e sentiu falta do cabeçalho do chat antigo. O print que
// veio com o pedido tem, de cima para baixo: a fila escolhida + três atalhos ·
// quatro mini-cards com número · busca + (+) · as colunas do board em quadrados
// · a ordenação.
//
// A prova SÓ LÊ: nenhuma mensagem é enviada e nada é escrito no banco.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const LADO = `document.querySelector('aside, [class*="w-[320px]"]') || document.body`;
const TEXTOS = `[...document.querySelectorAll('button')].map(b => b.textContent.trim())`;

const chrome = await subirChrome({ porta: 9491 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2`, { esperar: 5000 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 20_000 });

  // ---- 1. os quatro mini-cards ----
  const cards = await a.js(`return ${TEXTOS}.filter(t => /^(—|\\d+)\\s*(Esperando|Meus|Sem dono|Encerradas)$/.test(t));`);
  conferir(cards.length === 4, "os quatro mini-cards estão na tela", JSON.stringify(cards));

  // ---- 2. os três atalhos ao lado da fila ----
  const atalhos = await a.js(`
    return ["Fila de espera", "Recados da supervisão", "Minha carteira"]
      .map(r => !!document.querySelector('button[aria-label="' + r + '"]'));`);
  conferir(atalhos.every(Boolean), "os três atalhos (fila, recados, carteira) estão ao lado da fila", JSON.stringify(atalhos));

  // ---- 3. o botão da fila continua mostrando a escolhida ----
  conferir(
    await a.js(`return ${TEXTOS}.some(t => t.startsWith("Meus atendimentos"));`),
    "o botão da fila continua dizendo qual está aberta",
  );

  // ---- 4. as colunas do board, quadradas e fora do painel de Filtros ----
  const colunas = await a.js(`
    const b = [...document.querySelectorAll('button[aria-pressed]')].filter(x => x.title && /prospec|cadastro|ocioso|tentativa|negocia|pedido|vender/i.test(x.title));
    return { quantos: b.length, raio: b[0] ? getComputedStyle(b[0]).borderRadius : null, titulos: b.map(x => x.title) };`);
  conferir(colunas.quantos === 7, "as sete colunas do board aparecem no cabeçalho", `${colunas.quantos}`);
  conferir(
    colunas.raio && parseFloat(colunas.raio) <= 8,
    "…em quadrados de canto pequeno, não em pílulas",
    String(colunas.raio),
  );

  // ---- 5. o consultor virou SELETOR COM LISTA, não painel de chips ----
  conferir(
    await a.js(`return ${TEXTOS}.some(t => t.startsWith("Todos os consultores"));`),
    "o recorte por consultor é um seletor que diz o que está sendo visto",
  );
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith("Todos os consultores"));
    b.click(); return true;`);
  await espera(600);
  const noMenu = await a.js(`
    const m = document.querySelector('[role="menu"]');
    return m ? [...m.querySelectorAll('button')].map(b => b.textContent.trim()) : null;`);
  conferir(
    noMenu && noMenu.length > 1 && /^Todos os consultores/.test(noMenu[0]),
    "…e abre a lista de consultores, com o “todos” em primeiro",
    JSON.stringify((noMenu ?? []).slice(0, 3)),
  );
  await a.js(`document.querySelector('[role="menu"]').previousElementSibling.click(); return true;`);
  await espera(300);
  conferir(
    !(await a.js(`return [...document.querySelectorAll('p')].some(p => p.textContent.includes("Coluna do board"));`)),
    "e o painel de filtros não existe mais (uma escolha, um controle)",
  );

  // ---- 5b. a barra do produto: sem sublinhado e sem emoji ----
  const barra = await a.js(`
    const as = [...document.querySelectorAll('nav a, nav button')];
    return {
      sublinhado: as.map(x => getComputedStyle(x).textDecorationLine),
      rotulos: as.map(x => x.textContent.trim()),
    };`);
  conferir(
    barra.sublinhado.every((d) => d === "none"),
    "a barra do produto não tem link sublinhado",
    JSON.stringify(barra.sublinhado.slice(0, 3)),
  );
  conferir(
    !barra.rotulos.some((t) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)),
    "…nem emoji junto dos títulos",
    JSON.stringify(barra.rotulos),
  );

  // ---- 5c. a linha da conversa: código no nome e de quem é ----
  const naLinha = await a.js(`
    const b = document.querySelector('[data-ripple][aria-current], .rolagem button');
    const t = b ? b.textContent : "";
    // sem "\d" aqui: isto vive dentro de um template literal, e a barra
    // invertida é comida antes de virar regex — o teste passava a procurar a
    // letra "d". Classe explícita resolve.
    return { texto: t.slice(0, 80), temCodigo: /[0-9]+ - /.test(t) };`);
  conferir(naLinha.temCodigo, "o nome do contato vem montado como “1234 - NOME”", naLinha.texto.slice(0, 40));
  const tags = await a.js(`
    return [...document.querySelectorAll('.rolagem span[title^="atende "]')].length;`);
  conferir(tags > 0, "quem vê todas as carteiras vê de quem é cada conversa", `${tags} etiquetas`);

  // ---- 6. clicar num mini-card troca a fila de verdade ----
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Sem dono$/.test(x.textContent.trim()));
    b.click(); return true;`);
  await espera(900);
  conferir(
    await a.js(`return ${TEXTOS}.some(t => t.startsWith("Fila de espera"));`),
    "clicar em “Sem dono” abre a fila de espera",
  );
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Meus$/.test(x.textContent.trim()));
    b.click(); return true;`);
  await espera(900);

  // ---- 7. a ordem dos blocos é a do print ----
  const ordem = await a.js(`
    const y = (el) => el ? Math.round(el.getBoundingClientRect().top) : -1;
    const acha = (t) => [...document.querySelectorAll('button')].find(b => new RegExp(t).test(b.textContent.trim()));
    return {
      fila: y([...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith("Meus atendimentos"))),
      cards: y(acha("Esperando$")),
      busca: y(document.querySelector('input[placeholder*="Buscar"]')),
      colunas: y([...document.querySelectorAll('button[aria-pressed]')].find(x => x.title && /prospec/i.test(x.title))),
      ordena: y(acha("Recentes|Antigas")),
    };`);
  const seq = [ordem.fila, ordem.cards, ordem.busca, ordem.colunas, ordem.ordena];
  conferir(
    seq.every((v, i) => v > 0 && (i === 0 || v > seq[i - 1])),
    "a ordem é a do print: fila · cards · busca · colunas · ordenação",
    JSON.stringify(ordem),
  );

  await a.foto("cabecalho-lista");

  // ---- 8. o celular: nada sai da tela ----
  await a.enviar("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await espera(700);
  conferir(
    await a.js(`return document.documentElement.scrollWidth <= document.documentElement.clientWidth;`),
    "a 360 px não há rolagem lateral",
  );
  const alturaCabecalho = await a.js(`
    const i = document.querySelector('input[placeholder*="Buscar"]');
    let el = i; while (el && !el.className.includes('border-b')) el = el.parentElement;
    return el ? Math.round(el.getBoundingClientRect().height) : null;`);
  // 290: o cabeçalho cresceu de propósito em 28/09 — a fila e os três atalhos
  // passaram a ter a altura de um campo (pedido do dono, por simetria com a
  // busca), e o consultor ganhou linha própria. Ainda sobra tela para 6 linhas
  // da lista num aparelho de 780 px.
  conferir(alturaCabecalho != null && alturaCabecalho < 290, "…e o cabeçalho não come a lista", `${alturaCabecalho}px`);
  await a.foto("cabecalho-lista-360");

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
