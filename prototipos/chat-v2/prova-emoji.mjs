// -----------------------------------------------------------------------------
// EMOJI NA CAIXA DE MENSAGEM DO CHAT-V2 (22/09/2026)
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   node prototipos/chat-v2/prova-emoji.mjs
//
// NADA É ENVIADO e nada é escrito no banco: a prova só digita na caixa e
// confere o texto. O envio nem é clicado.
//
// O que ela afirma:
//   1. o botão existe no computador e abre uma grade de 40 emoji;
//   2. clicar num emoji INSERE NO CURSOR, não no fim — é o ponto que engana
//      (quem clica no meio de uma frase espera continuar dali);
//   3. clicar fora fecha;
//   4. a 360 px o botão NÃO aparece: ali o teclado do aparelho já tem emoji e a
//      barra não tem largura sobrando (§67).
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const BOTAO = `document.querySelector('button[aria-label="Emoji"]')`;
const GRADE = `document.querySelectorAll('.grid-cols-10 button')`;
const CAIXA = `document.querySelector('textarea')`;

const chrome = await subirChrome({ porta: 9473 });
try {
  // ---- computador ----
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 4000 });
  const temCaixa = await a.ate(CAIXA, { ms: 20_000 });
  conferir(temCaixa, "a caixa de mensagem está aberta (janela de 24h do ensaio)");

  conferir(await a.js(`return !!${BOTAO};`), "o botão de emoji existe na caixa");
  await a.js(`${BOTAO}.click(); return true;`);
  await a.ate(`${GRADE}.length > 0`, { ms: 5000 });
  const quantos = await a.js(`return ${GRADE}.length;`);
  conferir(quantos === 40, "a grade abre com os 40 emoji", `${quantos}`);

  // escreve uma frase e põe o cursor no MEIO
  await a.js(`
    const el = ${CAIXA};
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    s.call(el, "bom dia tudo bem");
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.focus(); el.setSelectionRange(8, 8);   // logo depois de "bom dia "
    return true;`);
  await espera(150);
  await a.js(`${GRADE}[4].click(); return true;`);   // 😊, o 5º da grade
  await espera(250);
  const valor = await a.js(`return ${CAIXA}.value;`);
  conferir(valor === "bom dia 😊tudo bem", "o emoji entra NO CURSOR, não no fim", JSON.stringify(valor));
  const cursor = await a.js(`return ${CAIXA}.selectionStart;`);
  conferir(cursor === 10, "e o cursor fica depois dele, para continuar digitando", `${cursor}`);

  // clicar fora fecha
  await a.js(`document.querySelector('.fixed.inset-0').click(); return true;`);
  await espera(200);
  conferir(await a.js(`return ${GRADE}.length === 0;`), "clicar fora fecha a grade");
  await a.foto("emoji-desktop");
  await a.fechar?.();

  // ---- celular: o botão não aparece ----
  const m = await novaAba(chrome);
  await m.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await m.enviar("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await m.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 4000 });
  await m.ate(CAIXA, { ms: 20_000 });
  const visivel = await m.js(`const b = ${BOTAO}; return !!b && b.getBoundingClientRect().width > 0;`);
  conferir(!visivel, "a 360 px o botão fica fora (o teclado do aparelho já tem emoji)");
  const largura = await m.js(`return Math.round(${CAIXA}.getBoundingClientRect().width);`);
  conferir(largura >= 100, "e a caixa de texto continua com largura de sobra", `${largura}px`);
  const semLado = await m.js(`return document.documentElement.scrollWidth <= document.documentElement.clientWidth;`);
  conferir(semLado, "nenhuma rolagem lateral a 360 px");
  await m.foto("emoji-mobile");

  const exc = [...a.excecoes, ...m.excecoes].filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção nas duas telas", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
