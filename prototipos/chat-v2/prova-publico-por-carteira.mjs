// -----------------------------------------------------------------------------
// O PÚBLICO RESPEITA A CARTEIRA ESCOLHIDA (demanda #54, 29/09/2026)
//
//   ENSAIO_VISIVEL=1 npx next start -p 3120     (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-publico-por-carteira.mjs
//
// O relato, com print: "selecionei a carteira romulo, meu objetivo era que
// fosse somente clientes que pertencessem ao rca do romulo". O disparo saiu com
// clientes de QUATRO carteiras — e só apareceu depois, na coluna "era de" da
// planilha da campanha.
//
// A causa: a tela nova mandava os filtros SOLTOS no corpo, e a rota lê
// `b.filtros`. Com `b.filtros` indefinido, `lerFiltros({})` roda com todos os
// padrões — carteira nenhuma, ou seja, a base inteira.
//
// A prova mede as duas metades do conserto: a tela manda no formato certo, e a
// rota RECUSA o formato errado em vez de rodar com os padrões.
//
// Só lê. Nenhum template é enviado.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const previa = (a, corpo) =>
  a.js(
    "return fetch('/api/admin/disparo-massa', { method: 'POST'," +
    " headers: { 'content-type': 'application/json' }," +
    ` body: ${JSON.stringify(JSON.stringify(corpo))} })` +
    ".then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));",
  );

const chrome = await subirChrome({ porta: 9611 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/admin-novo`, { esperar: 2500 });
  await a.ate(`/Campanhas/.test(document.body.textContent || '')`, { ms: 20_000 });

  // ---- 1. o formato CERTO recorta mesmo -----------------------------------
  const certo = await previa(a, {
    acao: "previa",
    filtros: { carteiras: ["romulo"], etapas: ["ociosos", "tentativa_contato"], diasMin: 0, diasRecontato: 4, porVendedor: 0, limite: 20 },
  });
  const sel = certo.j?.selecionados ?? [];
  const porV = {};
  for (const x of sel) porV[x.vendedor ?? "(sem)"] = (porV[x.vendedor ?? "(sem)"] ?? 0) + 1;

  conferir(certo.status === 200 && sel.length > 0, "a prévia responde com público", `${sel.length} clientes`);
  conferir(
    Object.keys(porV).length === 1 && porV.romulo === sel.length,
    "TODOS são da carteira escolhida — era o pedido",
    JSON.stringify(porV),
  );
  conferir(
    (certo.j?.carteirasUsadas ?? []).join(",") === "romulo",
    "…e a rota devolve qual carteira usou, em vez de ficar calada",
    JSON.stringify(certo.j?.carteirasUsadas),
  );

  // ---- 2. o formato ERRADO é recusado, não adivinhado ---------------------
  const errado = await previa(a, {
    acao: "previa",
    carteiras: ["romulo"], etapas: ["ociosos"], diasMin: 0, diasRecontato: 4, porVendedor: 0, limite: 20,
  });
  conferir(errado.status === 400, "filtro solto no corpo é RECUSADO", `http ${errado.status}`);
  conferir(
    /filtros/.test(String(errado.j?.error ?? "")) && /carteiras/.test(String(errado.j?.error ?? "")),
    "…com um erro que diz o que fazer e o que estava em risco",
    String(errado.j?.error ?? "").slice(0, 110),
  );

  // ---- 3. e a TELA manda no formato certo ---------------------------------
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Nova campanha/.test(x.textContent||''));
    if (b) b.click(); return true;`);
  await a.ate(`/O template|Quem recebe/.test(document.body.textContent || '')`, { ms: 20_000 });

  const corpos = [];
  a.ouvir((m) => {
    if (m.method === "Network.requestWillBeSent" && /disparo-massa/.test(m.params.request.url)) {
      corpos.push(m.params.request.postData ?? "");
    }
  });
  // marca uma carteira e pede a prévia pela própria tela
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'romulo');
    if (b) b.click(); return true;`);
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Ver quem vai receber/.test(x.textContent||''));
    if (b) b.click(); return true;`);
  await espera(6000);

  const corpo = corpos.map((c) => { try { return JSON.parse(c); } catch { return null; } }).filter(Boolean).pop();
  conferir(!!corpo?.filtros, "a TELA manda os filtros dentro de `filtros`", corpo ? Object.keys(corpo).join(",") : "");
  conferir(
    (corpo?.filtros?.carteiras ?? []).includes("romulo"),
    "…com a carteira que foi marcada na tela",
    JSON.stringify(corpo?.filtros?.carteiras),
  );
  await a.foto("publico-por-carteira");

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
