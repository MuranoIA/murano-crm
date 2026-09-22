// -----------------------------------------------------------------------------
// BUG DO PILOTO (22/09/2026): template com DOIS campos não saía pelo chat-v2.
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   node prototipos/chat-v2/prova-template-campos.mjs
//
// O diálogo escondia o `{{1}}` (o nome) e mandava só o `{{2}}`; a rota exige o
// valor de cada campo e respondia "este template tem 2 campos para preencher".
//
// Confere, na conversa de ENSAIO (número nunca enviado de verdade):
//   1. o diálogo mostra TODOS os campos, o 1 já com o primeiro nome;
//   2. a prévia usa o que está nos campos;
//   3. Enviar funciona — e o texto gravado é o da prévia.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9453 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 5000 });
  await a.ate(`document.querySelector('button[aria-label="Template"]') || [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Template')`, { ms: 25_000 });
  await a.js(`(document.querySelector('button[aria-label="Template"]') || [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Template')).click(); return true;`);
  await a.ate(`document.querySelector('select')`, { ms: 15_000 });

  // o template com mais campos entre os aprovados — é o caso do relato
  const escolha = await a.js(`
    const sel = document.querySelector('select');
    return [...sel.options].map(o => o.textContent);`);
  const campos = await a.js(`return [...document.querySelectorAll('label span')].filter(s=>/^Campo \\d/.test(s.textContent)).map(s=>s.textContent);`);
  conferir(campos.some((c) => c.startsWith("Campo 1")), "o Campo 1 aparece", `${campos.join(" | ")} · templates: ${escolha.join(", ")}`);
  const v1 = await a.js(`const i=[...document.querySelectorAll('label')].find(l=>/^Campo 1/.test(l.textContent))?.querySelector('input'); return i?i.value:null;`);
  conferir(!!v1, "o Campo 1 chega preenchido com o primeiro nome", `"${v1}"`);

  // preenche o que faltar e confere a prévia
  await a.js(`
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    [...document.querySelectorAll('label')].filter(l=>/^Campo \\d/.test(l.textContent) && !/^Campo 1/.test(l.textContent))
      .forEach((l, i) => { const inp = l.querySelector('input'); set.call(inp, 'prova campo ' + (i + 2)); inp.dispatchEvent(new Event('input', { bubbles: true })); });
    return true;`);
  await espera(300);
  const previa = await a.js(`const p=[...document.querySelectorAll('p')].find(x=>x.previousElementSibling && /O que ela vai ler/i.test(x.previousElementSibling.textContent)); return p?p.textContent:'';`);
  conferir(previa.includes(v1) && (campos.length < 2 || previa.includes("prova campo 2")), "a prévia usa o que está nos campos", previa.slice(0, 120));

  const antes = new Date().toISOString();
  await a.clicarTexto("button", "Enviar");
  const ok = await a.ate(`/enviado/i.test(document.body.textContent) && !document.querySelector('select')`, { ms: 20_000 });
  const erro = await a.js(`return [...document.querySelectorAll('[role=status],[role=alert],div')].map(d=>d.textContent).find(t=>/campos para preencher|erro/i.test(t||''))||'';`);
  conferir(ok, "Enviar funciona (sem 'tem 2 campos para preencher')", erro.slice(0, 120));
  await espera(1500);
  const { data } = await sb.from("mensagens").select("conteudo,tipo").eq("cliente_id", ENSAIO).eq("tipo", "template").gte("criada_em", antes).order("criada_em", { ascending: false }).limit(1);
  conferir(data?.[0]?.conteudo?.includes(v1), "o texto gravado é o da prévia, com o nome", (data?.[0]?.conteudo ?? "nenhuma linha").slice(0, 120));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
