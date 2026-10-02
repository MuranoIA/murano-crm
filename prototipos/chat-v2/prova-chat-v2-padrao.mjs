// -----------------------------------------------------------------------------
// O CHAT NOVO VIRA O DESENHO DE TODOS (demanda #57, 02/10/2026)
//
//   npx next start -p 3122      (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-chat-v2-padrao.mjs
//
// Pedido do dono: "quero que chat-v2 seja o padrão, e as outras opções sejam
// desabilitadas. posteriormente, depois de alguns dias de testes, vamos
// eliminar definitivamente todas as demais".
//
// ⚠️ O QUE FAZ ESTA PROVA VALER é que ela mede com um desenho APOSENTADO
// gravado no banco. Se fosse preciso a migration 0150 rodar antes para a equipe
// ir para o v2, um deploy sem ela deixaria todo mundo na tela antiga — e
// ninguém descobriria até alguém reclamar. A afirmação aqui é mais forte: a
// régua está no CÓDIGO, e a coluna pode estar velha.
//
// E é A/B de verdade: a MESMA sessão, no MESMO banco, contra a PRODUÇÃO (que
// roda o master, sem o conserto) e contra o build local (com).
//
// ⚠️ O desenho velho entra como PILOTO de um e-mail de ensaio, e não mexendo no
// global. Trocar o global por dez segundos mandaria a equipe inteira para a
// tela antiga no meio do expediente — e o piloto prova a mesma coisa, porque é
// a mesma função (`layoutEfetivo`) que decide os dois. A linha é apagada no
// `finally`, e nasce com `ativo = false`: ela não dá acesso a nada.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3122";
const PROD = process.env.PROD || "https://crm.muranoprofessional.com.br";
const ENSAIO = "ensaio-desenho-aposentado@muranoprofessional.com.br";
const APOSENTADO = "bancada";   // tem tela construída; é o que estava em vigor
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

/** Para onde /chat manda, sem seguir o redirecionamento. */
async function paraOnde(base, email) {
  const r = await fetch(`${base}/chat`, {
    redirect: "manual",
    headers: { cookie: `crm_sessao=admin; crm_email=${email}`, "cache-control": "no-cache" },
  });
  return {
    status: r.status,
    destino: r.headers.get("location") ?? "(ficou no /chat)",
    desenho: r.headers.get("x-chat-desenho") ?? null,
  };
}

const chrome = await subirChrome({ porta: 9671 });
let criouAcesso = false;
try {
  // ---- o cenário: alguém com um desenho APOSENTADO gravado ---------------
  await sb.from("acesso").upsert(
    { email: ENSAIO, nome: "ENSAIO desenho aposentado", papel: "vendedor", ativo: false, chat_layout: APOSENTADO },
    { onConflict: "email" },
  );
  criouAcesso = true;
  const { data: linha } = await sb.from("acesso").select("chat_layout").eq("email", ENSAIO).maybeSingle();
  conferir(linha?.chat_layout === APOSENTADO, "no banco, a pessoa está com um desenho aposentado",
    `chat_layout = ${linha?.chat_layout}`);

  // ---- 1. A/B: a MESMA sessão, no MESMO banco, nos dois builds -----------
  const antes = await paraOnde(PROD, ENSAIO);
  const depois = await paraOnde(BASE, ENSAIO);

  conferir(
    antes.status === 200,
    "em PRODUÇÃO (sem o conserto) ela continua indo para o chat antigo",
    `http ${antes.status} · ${antes.desenho ?? "—"}`,
  );
  conferir(
    depois.status === 307 && /\/chat-v2/.test(depois.destino),
    "com o conserto, a MESMA sessão vai para o chat NOVO",
    `http ${depois.status} -> ${depois.destino}`,
  );
  conferir(
    linha?.chat_layout === APOSENTADO,
    "…e a coluna continua dizendo o desenho velho — a régua está no código, não no banco",
    `chat_layout = ${linha?.chat_layout}`,
  );

  // ---- 2. o /admin recusa estabelecer um aposentado ----------------------
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/admin`, { esperar: 2000 });

  const tentar = (layout) =>
    a.js(
      "return fetch('/api/admin/chat-layout', { method: 'PUT'," +
      " headers: { 'content-type': 'application/json' }," +
      ` body: ${JSON.stringify(JSON.stringify({ layout }))} })` +
      ".then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));",
    );

  for (const velho of ["original", "continuidade", "bancada"]) {
    const r = await tentar(velho);
    conferir(r.status === 409, `o servidor recusa estabelecer "${velho}"`, `http ${r.status}`);
    conferir(
      /aposentad/i.test(String(r.j?.error ?? "")),
      `…dizendo que foi APOSENTADO, e não que falta construir a tela`,
      String(r.j?.error ?? "").slice(0, 80),
    );
  }

  // ---- 3. a tela do admin mostra o estado real ---------------------------
  const painel = await a.js(
    "return fetch('/api/admin/chat-layout', { cache: 'no-store' })" +
    ".then(r => r.json()).then(j => ({" +
    "  efetivo: j['chat-layout'].efetivo," +
    "  aposentados: j['chat-layout'].opcoes.filter(o => o.aposentado).map(o => o.id)," +
    "  ativaveis: j['chat-layout'].opcoes.filter(o => o.implementado && !o.aposentado).map(o => o.id)," +
    "}));",
  );
  conferir(painel.efetivo === "v2", "o /admin anuncia o desenho EFETIVO, não a coluna crua", String(painel.efetivo));
  conferir(
    ["original", "continuidade", "bancada"].every((x) => painel.aposentados.includes(x)),
    "os três desenhos com tela construída estão marcados como aposentados",
    painel.aposentados.join(","),
  );
  conferir(
    painel.ativaveis.length === 1 && painel.ativaveis[0] === "v2",
    "…e sobra UMA opção escolhível: o chat novo",
    painel.ativaveis.join(","),
  );

  // ---- 4. e a tela desenha isso ------------------------------------------
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Desenho do chat/i.test(x.textContent||''));
    if (b) b.click(); return true;`);
  await a.ate(`/Aposentado/.test(document.body.textContent || '')`, { ms: 20_000 });
  const tela = await a.js(`
    const radios = [...document.querySelectorAll('input[name="chat-layout"]')];
    return {
      total: radios.length,
      habilitados: radios.filter(r => !r.disabled).map(r => r.value),
      selos: (document.body.textContent.match(/Aposentado/g) || []).length,
    };`);
  conferir(
    tela.habilitados.length === 1 && tela.habilitados[0] === "v2",
    "na tela, só o chat novo pode ser marcado",
    `${tela.habilitados.join(",")} de ${tela.total}`,
  );
  conferir(tela.selos >= 3, "…e os aposentados aparecem com o selo, em vez de sumirem", `${tela.selos} selos`);
  await a.foto("chat-v2-padrao-admin");

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  if (criouAcesso) await sb.from("acesso").delete().eq("email", ENSAIO);
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
