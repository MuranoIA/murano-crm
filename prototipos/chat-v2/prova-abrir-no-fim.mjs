// -----------------------------------------------------------------------------
// TROCAR DE CONVERSA ABRE NA ÚLTIMA MENSAGEM (demanda #30, 24/09/2026)
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   node prototipos/chat-v2/prova-abrir-no-fim.mjs
//
// Relato da consultora: ao alternar entre conversas, a seguinte abria NO MEIO
// do histórico, em mensagens antigas, em vez da última.
//
// A causa no v2: a Thread era REUSADA entre conversas, e com ela a régua de
// "estou colado no fim". Quem tinha subido para reler um preço levava esse
// estado para a próxima conversa — e o efeito que rola até o fim só roda na
// montagem, que não acontecia de novo.
//
// A prova monta DUAS conversas na faixa de ensaio (nunca sai mensagem delas,
// §ensaio), sobe a rolagem numa e troca para a outra. Apaga tudo no fim.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const A = process.env.ENSAIO || "wa:559190000077";
const B = "wa:559190000079";
const MARCA = `prova-abrir-no-fim.${Date.now()}`;

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const { data: ref } = await sb.from("mensagens")
  .select("linha_id").eq("cliente_id", A).not("linha_id", "is", null).limit(1).maybeSingle();
const LINHA = ref?.linha_id;
if (!LINHA) { console.log("❌ a conversa de ensaio não existe — rode ensaio.mjs criar"); process.exit(1); }

const agora = Date.now();
const iso = (msAtras) => new Date(agora - msAtras).toISOString();
// 80 mensagens em cada: passa da altura da tela, que é o que faz "abrir no meio"
// ser possível
const recheio = (cliente, n) =>
  Array.from({ length: 80 }, (_, i) => ({
    id: `${MARCA}.${n}.${i}`, cliente_id: cliente, tipo: "mensagem", status: "success",
    linha_id: LINHA, enviada_por: i % 2 ? "customer" : "operator",
    conteudo: `${n} — mensagem ${i}`, criada_em: iso(600_000 - i * 1000),
  }));

// ⚠️ As duas conversas precisam estar COM QUEM TESTA. A fila que abre por
// padrão é "Meus atendimentos", e conversa sem dono mora na fila de espera —
// sem isto a busca não acha a conversa e a prova falha por motivo errado.
const EU = "ia@muranoprofessional.com.br";
const minhas = [A, B].map((c) => ({
  cliente_id: c, de_carteira: null, para_carteira: EU, por: "prova", observacao: MARCA,
}));

const limpar = async () => {
  await sb.from("mensagens").delete().like("id", `${MARCA}%`);
  await sb.from("chat_transferencia").delete().eq("observacao", MARCA);
  await sb.from("clientes").delete().eq("id", B);
};

// Onde a rolagem parou, em relação ao fim.
// ⚠️ O painel da ESQUERDA também rola e também tem a classe `rolagem` — medir
// o primeiro que aparece mede a lista de conversas, não a conversa (a 1ª versão
// desta prova reprovou o código certo por isso). O da thread é o que contém as
// bolhas (`[data-msg]`).
const ONDE = `(() => {
  const bolha = document.querySelector('[data-msg]');
  let el = bolha;
  while (el && !(el.scrollHeight > el.clientHeight + 10 && getComputedStyle(el).overflowY !== 'visible')) el = el.parentElement;
  if (!el) return null;
  return { doFim: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight), alt: Math.round(el.scrollHeight) };
})()`;

/** A lista vem de uma view MATERIALIZADA, atualizada a cada 2 min pelo pg_cron:
 *  a conversa nova não aparece na hora. Esperar é parte do caso, não folga. */
async function esperarNaLista(id) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${BASE}/api/chat`, { headers: { cookie: "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br" } });
    const j = await r.json().catch(() => ({}));
    if ((j.conversas ?? []).some((c) => c.cliente_id === id)) return true;
    await espera(6000);
  }
  return false;
}

/** Clicar na conversa PELA LISTA — que é o gesto do relato.
 *  ⚠️ A lista é virtualizada: quem está fora da janela não existe no DOM. Por
 *  isso a prova busca por nome antes de clicar, em vez de procurar o botão
 *  numa lista de milhares. */
async function trocarPelaLista(a, nome) {
  await a.js(`
    const c = document.querySelector('input[placeholder*="Buscar"]');
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(c, "ENSAIO chat-v2");
    c.dispatchEvent(new Event('input', { bubbles: true }));
    return true;`);
  await a.ate(`[...document.querySelectorAll('button')].some(x => x.textContent.includes(${JSON.stringify(nome)}))`, { ms: 10_000 });
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(nome)}));
    b.click(); return true;`);
}

try {
  await sb.from("clientes").upsert(
    { id: B, nome_completo: "ENSAIO chat-v2 · B (não é cliente)", telefone: "559190000079", carteira: null },
    { onConflict: "id" },
  );
  const { error } = await sb.from("mensagens").upsert([...recheio(A, "A"), ...recheio(B, "B")], { onConflict: "id" });
  if (error) throw new Error(`não consegui montar o caso: ${error.message}`);
  const t = await sb.from("chat_transferencia").insert(minhas);
  if (t.error) throw new Error(`não consegui atribuir as conversas: ${t.error.message}`);

  conferir(await esperarNaLista(B), "a conversa nova entra na lista (view materializada, até 2 min)");

  const chrome = await subirChrome({ porta: 9485 });
  try {
    const a = await novaAba(chrome);
    await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);

    // ---- 1. entrar na conversa A ----
    await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(A)}`, { esperar: 5000 });
    await a.ate(`document.body.innerHTML.includes("A — mensagem 79")`, { ms: 20_000 });
    await espera(900);
    const naA = await a.js(`return ${ONDE};`);
    conferir(naA && naA.doFim <= 40, "a conversa abre na última mensagem", JSON.stringify(naA));

    // ---- 2. subir a rolagem, como quem relê um preço ----
    await a.js(`
      let el = document.querySelector('[data-msg]');
      while (el && !(el.scrollHeight > el.clientHeight + 10 && getComputedStyle(el).overflowY !== 'visible')) el = el.parentElement;
      el.scrollTop = 0; el.dispatchEvent(new Event('scroll'));
      return true;`);
    await espera(400);
    const subiu = await a.js(`return ${ONDE};`);
    conferir(subiu && subiu.doFim > 200, "…e dá para subir para o passado sem ser puxada de volta", JSON.stringify(subiu));

    // ---- 3. trocar para a conversa B ----
    await trocarPelaLista(a, "ENSAIO chat-v2 · B");
    // ⚠️ esperar a BOLHA, não o texto na página: a prévia da conversa na lista
    // também mostra a última mensagem, e esperar por ela mede a tela antes de a
    // conversa ter carregado
    await a.ate(`[...document.querySelectorAll('[data-msg]')].some(e => e.textContent.includes("B — mensagem 79"))`, { ms: 20_000 });
    await espera(900);
    const naB = await a.js(`return ${ONDE};`);
    conferir(naB && naB.doFim <= 40, "trocando de conversa, a nova abre NA ÚLTIMA mensagem", JSON.stringify(naB));

    // ---- 4. e voltando também ----
    await trocarPelaLista(a, "ENSAIO chat-v2 (");
    await a.ate(`[...document.querySelectorAll('[data-msg]')].some(e => e.textContent.includes("A — mensagem 79"))`, { ms: 20_000 });
    await espera(900);
    const voltou = await a.js(`return ${ONDE};`);
    conferir(voltou && voltou.doFim <= 40, "…e voltando para a primeira, idem", JSON.stringify(voltou));

    await a.foto("abrir-no-fim");
    const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
    conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
  } finally { fecharChrome(chrome); }
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  await limpar();
  const { count } = await sb.from("mensagens").select("id", { count: "exact", head: true }).like("id", `${MARCA}%`);
  conferir(!count, "a prova não deixou rastro", String(count ?? 0));
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
