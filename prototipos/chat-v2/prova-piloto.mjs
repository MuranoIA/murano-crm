// -----------------------------------------------------------------------------
// FASE 6 — o `middleware.ts` que manda quem está em piloto para o chat-v2.
//
//   node prototipos/chat-v2/prova-piloto.mjs
//
// NADA É ESCRITO NO BANCO. O caminho "está em piloto" é exercitado plantando o
// cookie de decisão (`crm_chat_desenho`) — que é exatamente o que o middleware
// lê antes de ir ao banco. O caminho "vai ao banco" é exercitado sem cookie, e
// o desenho global de hoje (não-v2) aparece no cabeçalho `x-chat-desenho`.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const EMAIL = "ia@muranoprofessional.com.br";
const SESSAO = `crm_sessao=admin; crm_email=${EMAIL}`;
const CLI = "wa:559190000077";

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });
const pedir = (caminho, cookie) =>
  fetch(`${BASE}${caminho}`, { redirect: "manual", headers: cookie ? { cookie } : {} });

// 1. sem piloto, sem memória: vai ao banco e NÃO redireciona
{
  const t0 = Date.now();
  const r = await pedir(`/chat?cliente=${encodeURIComponent(CLI)}`, SESSAO);
  const h = r.headers.get("x-chat-desenho") ?? "";
  conferir(r.status === 200 && !/falhou/.test(h) && h !== "",
    "sem piloto: /chat abre o chat de hoje, com o desenho LIDO do banco", `${r.status} · "${h}" · ${Date.now() - t0} ms`);
  const guardado = r.headers.get("set-cookie") ?? "";
  conferir(/crm_chat_desenho=/.test(guardado) && /HttpOnly/i.test(guardado) && /Max-Age=60/i.test(guardado),
    "a decisão é guardada por 60 s, httpOnly", guardado.slice(0, 90));

  // 2. a segunda abertura não vai ao banco
  const valor = (guardado.match(/crm_chat_desenho=([^;]+)/) ?? [])[1] ?? "";
  const t1 = Date.now();
  const r2 = await pedir("/chat", `${SESSAO}; crm_chat_desenho=${valor}`);
  conferir(/lembrado/.test(r2.headers.get("x-chat-desenho") ?? ""),
    "a segunda abertura usa a memória, sem ir ao banco", `"${r2.headers.get("x-chat-desenho")}" · ${Date.now() - t1} ms`);
}

// 3. EM PILOTO: redireciona, preservando ?cliente= e embed=1
{
  const piloto = `${SESSAO}; crm_chat_desenho=${encodeURIComponent(`${EMAIL}|v2`)}`;
  const r = await pedir(`/chat?cliente=${encodeURIComponent(CLI)}&embed=1`, piloto);
  const loc = r.headers.get("location") ?? "";
  const u = loc ? new URL(loc, BASE) : null;
  conferir(r.status === 307 && u?.pathname === "/chat-v2", "em piloto: /chat vai para /chat-v2 (307)", `${r.status} → ${loc}`);
  conferir(u?.searchParams.get("cliente") === CLI && u?.searchParams.get("embed") === "1",
    "o ?cliente= e o embed=1 vão junto (link do board, push, lupa)", loc);
}

// 4. memória de OUTRA pessoa não vale para mim
{
  const alheio = `${SESSAO}; crm_chat_desenho=${encodeURIComponent("outra@x.com|v2")}`;
  const r = await pedir("/chat", alheio);
  conferir(r.status === 200, "a decisão guardada de outro usuário é ignorada", `${r.status} · "${r.headers.get("x-chat-desenho")}"`);
}

// 5. o que o middleware NÃO pode tocar
{
  const semSessao = await pedir("/chat");
  conferir(semSessao.status === 200 && !semSessao.headers.get("x-chat-desenho"),
    "sem sessão: passa direto, sem consulta", String(semSessao.status));
  const ind = await pedir("/chat/indicadores", SESSAO);
  conferir(!ind.headers.get("x-chat-desenho") && ind.status !== 307,
    "/chat/indicadores não passa pelo middleware", String(ind.status));
  const v2 = await pedir("/chat-v2", SESSAO);
  conferir(v2.status === 200 && !v2.headers.get("x-chat-desenho"), "/chat-v2 direto não passa pelo middleware", String(v2.status));
}

// 6. no navegador: o v2 grava `/chat` como tela a lembrar (o SSO do hub volta
//    por ela; gravar `/chat-v2` prenderia a pessoa no v2 depois do rollback)
const chrome = await subirChrome({ porta: 9445 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: EMAIL }, BASE);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(CLI)}`, { esperar: 5000 });
  const { cookies } = await a.enviar("Network.getCookies", { urls: [BASE] });
  const tela = decodeURIComponent(cookies.find((c) => c.name === "crm_tela")?.value ?? "");
  conferir(tela.startsWith("/chat?") && tela.includes("cliente="), "o v2 lembra a tela como /chat, não /chat-v2", tela);
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
