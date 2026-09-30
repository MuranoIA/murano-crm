// -----------------------------------------------------------------------------
// O TEMA ALCANÇA O PAINEL NOVO (demanda #53, 29/09/2026)
//
//   node prototipos/chat-v2/prova-tema-admin-novo.mjs
//
// Relato do dono: "no chat temos a escolha de tema, mas no admin novo o tema
// não persiste". O painel novo usava a folha do v2 mas não lia o cookie, então
// abria sempre no Murano, qualquer que fosse a escolha feita no chat.
//
// A prova confere as duas direções — escolher no chat vale no painel, e
// escolher no painel vale no chat — porque é o MESMO cookie. Dois cookies
// seriam duas preferências para a mesma pergunta.
//
// Devolve o tema ao Murano no fim.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

/** o que o tema manda na raiz `.v2` e na barra do topo */
const CORES = `(() => {
  const v = document.querySelector('.v2');
  if (!v) return null;
  const e = getComputedStyle(v);
  const barra = document.querySelector('header');
  return {
    tema: v.getAttribute('data-tema'),
    vinho: e.getPropertyValue('--color-v2-vinho').trim(),
    acao: e.getPropertyValue('--color-v2-azul').trim(),
    barra: barra ? getComputedStyle(barra).backgroundColor : null,
  };
})()`;

const escolher = async (a, nome) => {
  await a.js(`document.querySelector('button[aria-label="Tema da tela"]').click(); return true;`);
  await a.ate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(nome)})`, { ms: 8000 });
  await a.js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(nome)}).click(); return true;`);
  await espera(500);
};

const chrome = await subirChrome({ porta: 9601 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);

  // ---- 1. escolho no CHAT ------------------------------------------------
  await a.ir(`${BASE}/chat-v2`, { esperar: 3000 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 25_000 });
  await escolher(a, "Atlântico");
  const noChat = await a.js(`return ${CORES};`);
  conferir(noChat?.tema === "atlantico", "escolho Atlântico no chat", JSON.stringify(noChat?.vinho));

  // ---- 2. …e o painel novo abre nele -------------------------------------
  await a.ir(`${BASE}/admin-novo`, { esperar: 2500 });
  await a.ate(`/Lista de transfer/.test(document.body.textContent || '')`, { ms: 20_000 });
  const noPainel = await a.js(`return ${CORES};`);
  conferir(
    noPainel?.tema === "atlantico",
    "o painel novo ABRE no tema escolhido — era isto que não acontecia",
    String(noPainel?.tema),
  );
  conferir(noPainel?.vinho === "#1a5fa8", "…com a cor da marca do tema", String(noPainel?.vinho));
  conferir(
    noPainel?.acao === "#a35c12",
    "…e a ação em latão, como no chat: ação azul dentro de uma interface azul desapareceria",
    String(noPainel?.acao),
  );
  conferir(
    /^rgb\(26, 95, 168\)/.test(String(noPainel?.barra ?? "")),
    "inclusive a barra do topo do painel",
    String(noPainel?.barra),
  );
  await a.foto("admin-novo-tema-atlantico");

  // ---- 3. o seletor está AQUI também, e a volta vale no chat --------------
  const temSeletor = await a.js(`return !!document.querySelector('button[aria-label="Tema da tela"]');`);
  conferir(temSeletor, "o seletor de tema também existe no painel — não é preciso ir ao chat para trocar");

  await escolher(a, "Café");
  const cafe = await a.js(`return ${CORES};`);
  conferir(cafe?.tema === "cafe" && cafe?.vinho === "#5b3a29", "trocar no painel muda na hora", String(cafe?.vinho));

  await a.ir(`${BASE}/chat-v2`, { esperar: 3000 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 25_000 });
  const voltaNoChat = await a.js(`return ${CORES};`);
  conferir(
    voltaNoChat?.tema === "cafe",
    "…e o CHAT abre nele — é o mesmo cookie, uma preferência só",
    String(voltaNoChat?.tema),
  );

  // devolve ao padrão, para a próxima abertura não herdar o teste
  await escolher(a, "Murano");
  conferir((await a.js(`return ${CORES};`))?.tema === "murano", "a prova devolve o tema ao Murano no fim");

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
