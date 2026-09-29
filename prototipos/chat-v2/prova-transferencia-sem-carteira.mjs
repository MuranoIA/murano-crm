// -----------------------------------------------------------------------------
// TRANSFERIR PARA QUEM NÃO TEM CARTEIRA (demanda #51, 29/09/2026)
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   ENSAIO_VISIVEL=1 npx next start -p 3120      (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-transferencia-sem-carteira.mjs
//
// O relato: não dava para passar um caso para o pós-venda, para o Home nem para
// o Angelo — a lista "Para quem" só tinha os sete consultores.
//
// ⚠️ O SERVIDOR JÁ ACEITAVA desde 09/09: o destino `u:<email>` está previsto na
// rota de transferir e é validado contra `acesso.atende_chat`. A lacuna era da
// LISTA, e é isso que esta prova fixa — mais o painel novo, que deixa o admin
// escolher quem aparece.
//
// A transferência é feita na conversa de ENSAIO e desfeita no fim.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const MARCA = "prova #51";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const abrirTransferir = async (a) => {
  await a.js(
    "const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === 'Transferir conversa');" +
    "if (b) b.click(); return true;",
  );
  return a.ate("document.querySelector('select')", { ms: 10_000 });
};

const chrome = await subirChrome({ porta: 9561 });
let mexeu = false;
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);

  // ---- 1. a lista de destinos -------------------------------------------
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 2500 });
  await a.ate("document.querySelector('textarea')", { ms: 25_000 });
  await abrirTransferir(a);

  const lista = await a.js(`
    const s = [...document.querySelectorAll('select')].find(x => x.querySelector('option'));
    return {
      grupos: [...s.querySelectorAll('optgroup')].map(g => ({
        rotulo: g.getAttribute('label'),
        itens: [...g.querySelectorAll('option')].map(o => ({ valor: o.value, texto: o.textContent.trim() })),
      })),
    };`);

  const atendimento = lista.grupos.find((g) => /Atendimento/.test(g.rotulo || ""));
  conferir(
    lista.grupos.length === 2,
    "a lista vem em dois grupos — consultor e atendimento não são a mesma coisa",
    lista.grupos.map((g) => `${g.rotulo} (${g.itens.length})`).join(" · "),
  );
  conferir(
    !!atendimento && atendimento.itens.length >= 3,
    "quem atende SEM carteira passou a aparecer — era a queixa",
    (atendimento?.itens ?? []).map((i) => i.texto).join(" · "),
  );
  conferir(
    (atendimento?.itens ?? []).every((i) => i.valor.startsWith("u:")),
    "…endereçados por u:<email>, que é o que a rota de transferir já aceitava",
    (atendimento?.itens ?? [])[0]?.valor ?? "",
  );
  await a.foto("transferir-lista");

  // ---- 2. transferir de verdade ------------------------------------------
  const alvo = (atendimento?.itens ?? [])[0];
  const corpo = JSON.stringify({ cliente_id: ENSAIO, para: alvo?.valor ?? "", observacao: MARCA });
  const r = await a.js(
    "return fetch('/api/chat/transferir', { method: 'POST', headers: { 'content-type': 'application/json' }," +
    ` body: ${JSON.stringify(corpo)} }).then(async x => ({ status: x.status, corpo: await x.json().catch(() => ({})) }));`,
  );
  mexeu = true;
  conferir(r.status === 200, "a transferência para o pós-venda/home é aceita pelo servidor", `http ${r.status}`);

  const { data: t } = await sb.from("chat_transferencia")
    .select("para_carteira,observacao").eq("cliente_id", ENSAIO)
    .order("criada_em", { ascending: false }).limit(1).maybeSingle();
  conferir(t?.para_carteira === alvo?.valor, "…e fica gravada com o endereço da pessoa", String(t?.para_carteira));

  // ---- 3. o painel novo ---------------------------------------------------
  await a.ir(`${BASE}/admin-novo`, { esperar: 2000 });
  await a.ate("/Lista de transfer/.test(document.body.textContent || '')", { ms: 20_000 });
  const painel = await a.js(`
    const caixas = [...document.querySelectorAll('input[type=checkbox]')];
    return {
      titulo: (document.querySelector('h1') || {}).textContent?.trim() ?? null,
      construcao: /em constru/.test(document.body.textContent || ''),
      caixas: caixas.length,
      marcadas: caixas.filter(c => c.checked).length,
      avisa: /encurta a lista/i.test(document.body.textContent || ''),
      grupos: [...document.querySelectorAll('h3')].map(h => h.textContent.trim()),
    };`);
  conferir(painel.titulo === "Admin (novo)" && painel.construcao, "o painel novo abre, e diz que está em construção", painel.titulo ?? "");
  conferir(painel.caixas >= 10, "…com uma caixa por pessoa", `${painel.marcadas}/${painel.caixas} marcadas`);
  conferir(painel.grupos.length === 2, "separando consultores de quem atende sem carteira", painel.grupos.join(" · "));
  conferir(painel.avisa, "e a tela DIZ o que o botão não faz — desmarcar encurta a lista, não tira do atendimento");
  await a.foto("admin-novo-transferencia");

  // ---- 4. desmarcar some da lista do chat --------------------------------
  const email = String(alvo?.valor ?? "").slice(2);
  const patch = (v) =>
    a.js(
      "return fetch('/api/admin/transferencia', { method: 'PATCH', headers: { 'content-type': 'application/json' }," +
      ` body: ${JSON.stringify(JSON.stringify({ email, visivel: v }))} }).then(r => r.status);`,
    );
  await patch(false);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 2500 });
  await a.ate("document.querySelector('textarea')", { ms: 25_000 });
  await abrirTransferir(a);
  const depois = await a.js(`
    const s = [...document.querySelectorAll('select')].find(x => x.querySelector('option'));
    return [...s.querySelectorAll('option')].map(o => o.value);`);
  conferir(!depois.includes(alvo?.valor), "desmarcar no painel TIRA a pessoa da lista do chat", `${depois.length} opções`);
  await patch(true);
  const voltou = await a.js(
    "return fetch('/api/admin/transferencia').then(r => r.json()).then(j => (j.pessoas||[]).every(p => p.visivel));",
  );
  conferir(voltou, "…e marcar de volta a devolve — a prova não deixa ninguém fora da lista");

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  // a conversa de ensaio volta como estava: a prova não deixa lixo na caixa de
  // ninguém (o incidente de 10/09 foi exatamente isso)
  if (mexeu) await sb.from("chat_transferencia").delete().eq("cliente_id", ENSAIO).eq("observacao", MARCA);
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
