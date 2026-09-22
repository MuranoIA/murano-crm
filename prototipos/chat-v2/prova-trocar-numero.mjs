// -----------------------------------------------------------------------------
// TROCAR O NÚMERO DA CLIENTE PELO CHAT (22/09/2026).
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   node prototipos/chat-v2/prova-trocar-numero.mjs
//
// Na conversa de ENSAIO (faixa reservada 55 91 9 0000-00NN, nunca enviada):
//   1. a rota troca o número, grava em `clientes.telefone`, e VOLTA ao original
//      no fim (a prova não deixa rastro);
//   2. número que já é de OUTRA conversa: recusa, devolve a conversa, nada muda;
//   3. número que no WinThor é de OUTRO cliente: recusa, nada muda;
//   4. o mesmo número: recusa;
//   5. vendedor que não atende a conversa: 403;
//   6. na tela: o botão só libera com os dois números iguais, e o painel mostra
//      o número novo depois da troca.
//
// ⚠️ Os casos 2 e 3 usam números REAIS, mas só para serem RECUSADOS: a prova
// confere que o telefone do ensaio não mudou depois de cada recusa. Os números
// e nomes reais não são impressos (repo público, §15.5).
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const ADMIN = "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br";
const NOVO = "(91) 9000-0078";   // ainda na faixa de ensaio (prefixo 559190000)

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });
const trocar = (telefone, cookie = ADMIN) =>
  fetch(`${BASE}/api/chat/trocar-numero`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ cliente_id: ENSAIO, telefone }),
  }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
const telDoEnsaio = async () => (await sb.from("clientes").select("telefone").eq("id", ENSAIO).maybeSingle()).data?.telefone ?? null;

const original = await telDoEnsaio();
if (!original) { console.log("❌ a conversa de ensaio não existe — rode ensaio.mjs criar"); process.exit(1); }

try {
  // ---- 4. o mesmo número ----
  // ⚠️ o ensaio tem 8 dígitos locais (9000-0077): a 1ª versão usou 90000-0077,
  // que é OUTRO número, e a rota trocou de verdade — o teste estava errado
  const mesmo = await trocar("(91) 9000-0077");
  conferir(mesmo.status === 400, "o mesmo número é recusado", `${mesmo.status}`);

  // ---- 4b. só o DDD muda: é uma TROCA, não o mesmo número ----
  // (22/09: a 1ª versão comparava só os 8 últimos dígitos e recusava a
  // correção de DDD errado — o caso mais comum no WinThor)
  const soDdd = await trocar("(94) 9000-0077");
  conferir(soDdd.status === 200 && (await telDoEnsaio())?.slice(2, 4) === "94",
    "trocar só o DDD é aceito", `${soDdd.status} ${soDdd.j?.error ?? ""}`);
  await sb.from("clientes").update({ telefone: original }).eq("id", ENSAIO);

  // ---- 2. número de OUTRA conversa ----
  const { data: outra } = await sb.from("clientes").select("id,telefone").like("id", "wa:%").neq("id", ENSAIO)
    .not("telefone", "is", null).limit(1).maybeSingle();
  const r2 = await trocar(String(outra.telefone).replace(/^55/, ""));
  conferir(r2.status === 409 && r2.j?.conflito?.cliente_id === outra.id,
    "número de outra conversa: recusa e devolve a conversa existente", `${r2.status}`);
  conferir((await telDoEnsaio()) === original, "…e o telefone do ensaio não mudou");

  // ---- 3. número de OUTRO cliente no WinThor (e de nenhuma conversa) ----
  const { data: erps } = await sb.from("wth_carteira").select("codcli,telefone,tel8").eq("ativo", true)
    .not("tel8", "is", null).limit(200);
  let alvo = null;
  for (const w of erps ?? []) {
    const d = String(w.telefone ?? "").replace(/\D/g, "");
    if (d.length < 10 || d.length > 11) continue;
    const { count } = await sb.from("clientes").select("id", { count: "exact", head: true }).like("telefone", `%${w.tel8}`);
    if (!count) { alvo = d; break; }
  }
  if (alvo) {
    const r3 = await trocar(alvo);
    conferir(r3.status === 409 && !!r3.j?.erpOutro, "número de outro cliente no WinThor: recusa", `${r3.status}`);
    conferir((await telDoEnsaio()) === original, "…e o telefone do ensaio não mudou");
  } else conferir(false, "achar um número do WinThor sem conversa para o caso 3");

  // ---- 5. quem pode (demanda da Tati, 22/09) ----
  // A conversa de ensaio nasce SEM dono (fila). Para exercitar a recusa, ela é
  // transferida para uma carteira e a linha é apagada logo depois — é a única
  // escrita fora do ensaio que esta prova faz, e ela desfaz.
  const r5fila = await trocar(NOVO, "crm_sessao=thiago");
  conferir(r5fila.status === 200, "conversa na FILA: qualquer vendedor pode (a fila é de todos)", `${r5fila.status}`);
  await sb.from("clientes").update({ telefone: original }).eq("id", ENSAIO);

  const { data: tr } = await sb.from("chat_transferencia")
    .insert({ cliente_id: ENSAIO, de_carteira: null, para_carteira: "romulo", por: "prova", observacao: "prova trocar-numero" })
    .select("id").maybeSingle();
  try {
    const r5v = await trocar(NOVO, "crm_sessao=thiago");
    conferir(r5v.status === 403, "conversa COM dono: vendedor de outra carteira é recusado", `${r5v.status}`);
    conferir((await telDoEnsaio()) === original, "…e o telefone do ensaio não mudou");

    const r5p = await trocar(NOVO, "crm_sessao=pos-venda");
    conferir(r5p.status === 200, "PÓS-VENDA pode, mesmo sem ser o dono", `${r5p.status} ${r5p.j?.error ?? ""}`);
    await sb.from("clientes").update({ telefone: original }).eq("id", ENSAIO);

    const r5h = await trocar(NOVO, "crm_sessao=home");
    conferir(r5h.status === 200, "home também pode", `${r5h.status}`);
    await sb.from("clientes").update({ telefone: original }).eq("id", ENSAIO);
  } finally {
    if (tr?.id) await sb.from("chat_transferencia").delete().eq("id", tr.id);
  }

  // ---- 1. a troca de verdade (e a volta) ----
  const r1 = await trocar(NOVO);
  const depois = await telDoEnsaio();
  conferir(r1.status === 200 && depois?.endsWith("90000078"), "a troca grava o número novo em clientes.telefone", `${r1.status} · fila=${r1.j?.fila}`);
  conferir(r1.j?.fila === null, "conversa sem cadastro no WinThor não vai para a fila (não há o que corrigir lá)");

  // ---- 6. a tela ----
  const chrome = await subirChrome({ porta: 9461 });
  try {
    const a = await novaAba(chrome);
    await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
    await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 5000 });
    await a.ate(`document.querySelector('button[aria-label="Dados do cliente"]')`, { ms: 20_000 });
    await a.js(`document.querySelector('button[aria-label="Dados do cliente"]').click(); return true;`);
    await a.ate(`[...document.querySelectorAll('aside button')].some(b=>b.textContent.trim()==='Trocar número')`, { ms: 20_000 });
    const mostra = await a.js(`return /9000-0078/.test(document.querySelector('aside').textContent);`);
    conferir(mostra, "o painel mostra o número novo");
    await a.clicarTexto("aside button", "Trocar número");
    await a.ate(`document.querySelectorAll('aside input[inputmode="tel"]').length === 2`, { ms: 5000 });
    const set = (i, v) => a.js(`const el=document.querySelectorAll('aside input[inputmode="tel"]')[${i}]; const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true;`);
    const botao = `[...document.querySelectorAll('aside button')].find(b=>b.textContent.trim()==='Trocar')`;
    await set(0, "(91) 9000-0077"); await set(1, "(91) 9000-0079");
    await espera(200);
    conferir(await a.js(`return ${botao}.disabled;`), "com os dois números diferentes, o botão fica travado");
    await set(1, "(91) 9000-0077");
    await espera(200);
    conferir(await a.js(`return !${botao}.disabled;`), "com os dois iguais, libera");
    // volta ao número original PELA TELA — é o teste do caminho feliz na tela
    await a.js(`${botao}.click(); return true;`);
    const voltou = await a.ate(`/9000-0077/.test(document.querySelector('aside').textContent) && !document.querySelector('aside input[inputmode="tel"]')`, { ms: 10_000 });
    conferir(voltou, "pela tela, a troca volta ao número original e o painel atualiza");
    await a.foto("trocar-numero");
    const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
    conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
  } finally { fecharChrome(chrome); }
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  // a prova não deixa rastro: o ensaio volta ao número original, pela rota ou direto
  if ((await telDoEnsaio()) !== original) await sb.from("clientes").update({ telefone: original }).eq("id", ENSAIO);
}
conferir((await telDoEnsaio()) === original, "no fim, o ensaio está com o número original");

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
