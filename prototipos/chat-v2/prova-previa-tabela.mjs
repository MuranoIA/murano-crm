// -----------------------------------------------------------------------------
// A PRÉVIA VIRA TABELA (demanda #56, 29/09/2026)
//
//   ENSAIO_VISIVEL=1 npx next start -p 3120     (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-previa-tabela.mjs
//
// Pedido do dono: "em ver quem vai receber deve aparecer a mesma tabela... deve
// mostrar, além do nome, o código, o cpf, o telefone, o rca, o nome do
// vendedor". Antes era uma lista só de nomes — não dava para conferir nada
// antes de gastar.
//
// Só lê e monta público. Nenhum template é enviado.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9631 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/admin-novo`, { esperar: 2500 });
  await a.ate(`/Campanhas/.test(document.body.textContent || '')`, { ms: 20_000 });

  // ---- 1. o servidor devolve a ficha SÓ quando pedida --------------------
  const corpo = (detalhe) => JSON.stringify({
    acao: "previa", ...(detalhe ? { detalhe: true } : {}),
    filtros: { carteiras: ["romulo"], etapas: ["ociosos", "tentativa_contato"], diasRecontato: 4, limite: 5 },
  });
  const pedir = (d) =>
    a.js(
      "return fetch('/api/admin/disparo-massa', { method: 'POST'," +
      " headers: { 'content-type': 'application/json' }," +
      ` body: ${JSON.stringify(corpo(d))} }).then(r => r.json());`,
    );

  const sem = await pedir(false);
  const com = await pedir(true);
  const s0 = (sem.selecionados ?? [])[0] ?? {};
  const c0 = (com.selecionados ?? [])[0] ?? {};

  conferir((com.selecionados ?? []).length > 0, "a prévia devolve público", `${(com.selecionados ?? []).length}`);
  conferir(
    !("cpf" in s0) && !("codcli" in s0),
    "sem `detalhe`, a resposta continua enxuta — a tela antiga não paga pelo que não mostra",
    Object.keys(s0).join(","),
  );
  conferir(
    ["codcli", "cpf", "telefone", "rca"].every((k) => k in c0),
    "com `detalhe`, vêm código, CPF, telefone e RCA",
    JSON.stringify({ codcli: c0.codcli, cpf: c0.cpf, rca: c0.rca }),
  );
  conferir(
    c0.cpf === null || /^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(String(c0.cpf)),
    "…e o documento vem com máscara, para caber legível na coluna",
    String(c0.cpf),
  );

  // ---- 2. a tela desenha a tabela ---------------------------------------
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Nova campanha/.test(x.textContent||''));
    if (b) b.click(); return true;`);
  await a.ate(`/Quem recebe|O template/.test(document.body.textContent || '')`, { ms: 20_000 });
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'romulo');
    if (b) b.click(); return true;`);
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Ver quem vai receber/.test(x.textContent||''));
    if (b) b.click(); return true;`);
  const veio = await a.ate(`document.querySelector('table')`, { ms: 30_000 });
  await espera(600);

  const tabela = await a.js(`
    const t = document.querySelector('table');
    if (!t) return null;
    const linhas = [...t.querySelectorAll('tbody tr')];
    const cel = (tr) => [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
    return {
      colunas: [...t.querySelectorAll('thead th')].map(x => x.textContent.trim()),
      linhas: linhas.length,
      primeira: linhas[0] ? cel(linhas[0]) : [],
    };`);

  conferir(veio && !!tabela, "a prévia agora é uma TABELA, não uma lista de nomes");
  conferir(
    ["Cliente", "Cód.", "CPF/CNPJ", "Telefone", "RCA", "Consultor"].every((c) => tabela.colunas.includes(c)),
    "com as seis colunas que o dono pediu",
    tabela.colunas.join(" · "),
  );
  conferir(tabela.linhas > 0, "e com linhas de verdade", `${tabela.linhas} linhas`);
  conferir(
    tabela.primeira.filter((v) => v && v !== "—").length >= 4,
    "…preenchidas — não uma tabela de traços",
    tabela.primeira.join(" | ").slice(0, 100),
  );
  await a.foto("previa-tabela");

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
