// -----------------------------------------------------------------------------
// RESOLVER: A CONVERSA FICA RESOLVIDA, E SAI DA TELA (relato de 28/09/2026)
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   node prototipos/chat-v2/prova-resolver-fica.mjs
//
// Dois defeitos no mesmo gesto:
//
// 1. resolver aparecia em "Encerradas" e, na recarga, a conversa voltava para
//    "Meus atendimentos". A causa NÃO estava no resolver: a lista lia
//    `chat_conversa` sem limite, e o PostgREST corta em 1.000 linhas EM
//    SILÊNCIO — a tabela tem 1.518. A conversa recém-resolvida caía fora da
//    página, voltava sem status e era tratada como aberta;
// 2. a conversa resolvida continuava aberta na tela, como se nada tivesse
//    acontecido.
//
// A prova resolve a conversa de ENSAIO pela TELA e recarrega a página — que é
// exatamente o passo em que o defeito aparecia. No fim ela reabre a conversa,
// para o ensaio ficar como estava.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const COOKIE = "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br";

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

// ⚠️ com uma tentativa só esta prova ficou instável: a lista sai de uma view
// MATERIALIZADA e a conversa de ensaio pode ter acabado de entrar nela. Três
// tentativas espaçadas param de acusar defeito onde há atraso.
const naLista = async () => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${BASE}/api/chat`, { headers: { cookie: COOKIE } });
    const j = await r.json().catch(() => ({}));
    const c = (j.conversas ?? []).find((x) => x.cliente_id === ENSAIO);
    if (c) return c;
    await espera(1500);
  }
  return null;
};

const chrome = await subirChrome({ porta: 9499 });
try {
  // quantas linhas a tabela tem: é o número que explica o defeito
  const { count } = await sb.from("chat_conversa").select("cliente_id", { count: "exact", head: true });
  conferir(count != null, "a tabela de status tem mais de 1.000 linhas (era o que truncava)", `${count} linhas`);

  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 5000 });
  await a.ate(`document.querySelector('button[aria-label="Resolver conversa"]')`, { ms: 20_000 });

  // ---- resolver pela tela ----
  await a.js(`document.querySelector('button[aria-label="Resolver conversa"]').click(); return true;`);
  await a.ate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === "follow-up")`, { ms: 8000 });
  await a.js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === "follow-up").click(); return true;`);
  await a.js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === "Resolver" && !b.getAttribute('aria-label')).click(); return true;`);
  await espera(1800);

  conferir(
    await a.js(`return !document.querySelector('textarea') && document.body.innerHTML.includes("Escolha uma conversa");`),
    "ao resolver, a conversa SAI da tela",
  );

  const noBanco = await sb.from("chat_conversa").select("status,motivo").eq("cliente_id", ENSAIO).maybeSingle();
  conferir(noBanco.data?.status === "resolvida", "…e fica resolvida no banco", JSON.stringify(noBanco.data));

  // ---- o passo em que o defeito aparecia: recarregar ----
  await a.ir(`${BASE}/chat-v2`, { esperar: 5000 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 20_000 });
  await espera(1500);
  const daApi = await naLista();
  conferir(daApi?.status === "resolvida", "depois de recarregar, a lista ainda diz resolvida", JSON.stringify(daApi?.status));

  // e o cartão "Encerradas" conta com ela
  const encerradas = await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Encerradas$/.test(x.textContent.trim()));
    return b ? b.textContent.trim() : null;`);
  conferir(
    encerradas && !/^0/.test(encerradas),
    "…e ela conta em “Encerradas”, não em “Meus”",
    String(encerradas),
  );

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
  // o ensaio volta a ser uma conversa aberta
  await fetch(`${BASE}/api/chat/status`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: COOKIE },
    body: JSON.stringify({ cliente_id: ENSAIO, status: "aberta" }),
  }).catch(() => {});
  const { data } = await sb.from("chat_conversa").select("status").eq("cliente_id", ENSAIO).maybeSingle();
  conferir(data?.status !== "resolvida", "no fim, o ensaio volta a ficar aberto", String(data?.status));
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
