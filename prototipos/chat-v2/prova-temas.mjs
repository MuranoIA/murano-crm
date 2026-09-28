// -----------------------------------------------------------------------------
// OS TEMAS CLAROS DO CHAT (28/09/2026, pedido do dono)
//
//   node prototipos/chat-v2/prova-temas.mjs
//
// Três temas do Café Code — Murano, Atlântico e Café —, valendo SÓ no /chat-v2.
// A prova confere o que interessa: que a troca muda a cor de verdade, que ela
// sobrevive à recarga (o cookie é lido no servidor, então a tela não pisca no
// tema errado) e que nenhum componente precisou saber disso.
//
// Só lê e escreve o próprio cookie. Nada vai para o banco.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

/** a cor que o tema manda na barra do produto (a ficha da marca) */
const CORES = `(() => {
  const v = document.querySelector('.v2');
  const e = getComputedStyle(v);
  const barra = document.querySelector('header');
  return {
    tema: v.getAttribute('data-tema'),
    vinho: e.getPropertyValue('--color-v2-vinho').trim(),
    acao: e.getPropertyValue('--color-v2-azul').trim(),
    fundo: e.getPropertyValue('--color-v2-fundo').trim(),
    barra: barra ? getComputedStyle(barra).backgroundColor : null,
  };
})()`;

const chrome = await subirChrome({ porta: 9501 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2`, { esperar: 5000 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 20_000 });

  const murano = await a.js(`return ${CORES};`);
  conferir(murano.tema === "murano" && murano.vinho === "#621244", "a tela nasce no Murano", JSON.stringify(murano.vinho));

  // ---- trocar para o Atlântico ----
  await a.js(`document.querySelector('button[aria-label="Tema da tela"]').click(); return true;`);
  await a.ate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === "Atlântico")`, { ms: 6000 });
  await a.js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === "Atlântico").click(); return true;`);
  await espera(600);

  const atl = await a.js(`return ${CORES};`);
  conferir(atl.tema === "atlantico" && atl.vinho === "#1a5fa8", "trocar para Atlântico muda a marca na hora", JSON.stringify(atl.vinho));
  conferir(
    atl.acao === "#a35c12",
    "…e a AÇÃO vira latão — ação azul dentro de uma interface azul desapareceria",
    JSON.stringify(atl.acao),
  );
  conferir(atl.fundo !== murano.fundo, "…e o fundo muda junto", `${murano.fundo} → ${atl.fundo}`);
  await a.foto("tema-atlantico");

  // ---- a recarga: o cookie é lido no SERVIDOR ----
  await a.ir(`${BASE}/chat-v2`, { esperar: 5000 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 20_000 });
  const depois = await a.js(`return ${CORES};`);
  conferir(depois.tema === "atlantico", "depois de recarregar, a tela JÁ NASCE no tema escolhido (sem piscar)");
  conferir(
    /^rgb\(26, 95, 168\)/.test(String(depois.barra ?? "")),
    "…inclusive a barra do topo",
    String(depois.barra),
  );

  // ---- Café ----
  await a.js(`document.querySelector('button[aria-label="Tema da tela"]').click(); return true;`);
  await a.ate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === "Café")`, { ms: 6000 });
  await a.js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === "Café").click(); return true;`);
  await espera(600);
  const cafe = await a.js(`return ${CORES};`);
  conferir(cafe.tema === "cafe" && cafe.vinho === "#5b3a29", "o Café também", JSON.stringify(cafe.vinho));
  await a.foto("tema-cafe");

  // ---- e a câmera, que entrou junto ----
  await a.js(`
    const b = document.querySelector('.rolagem button');
    if (b) b.click();
    return true;`);
  await a.ate(`document.querySelector('textarea')`, { ms: 20_000 });
  conferir(
    await a.js(`return !!document.querySelector('button[aria-label="Tirar foto"]');`),
    "o botão de tirar foto está na caixa de mensagem",
  );

  // volta ao Murano, para a próxima abertura não herdar o teste
  await a.js(`document.querySelector('button[aria-label="Tema da tela"]').click(); return true;`);
  await a.ate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === "Murano")`, { ms: 6000 });
  await a.js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === "Murano").click(); return true;`);
  await espera(400);
  conferir((await a.js(`return ${CORES};`)).tema === "murano", "a prova volta o tema para o Murano no fim");

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
