// -----------------------------------------------------------------------------
// O PACOTE DE FIGURINHAS (demanda #37, 28/09/2026) — migration 0144
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   node prototipos/chat-v2/prova-figurinhas.mjs
//
// Receber figurinha já funcionava; faltavam as duas pontas: SALVAR no pacote e
// MANDAR de volta. A prova exercita a rota inteira com um `.webp` de verdade e
// depois apaga tudo — o pacote fica como estava.
//
// ⚠️ O envio sai para a conversa de ENSAIO, cuja faixa de telefone nunca chega
// à Meta (lib/ensaio.ts): nenhuma cliente recebe figurinha de teste.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const COOKIE = "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br";

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

// um WebP 2×2 de verdade (o menor que o Chrome aceita desenhar)
const WEBP = Buffer.from(
  "UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA",
  "base64",
);

let criada = null;
try {
  // ---- 1. salvar no pacote (arquivo novo) ----
  const corpo = new FormData();
  corpo.set("arquivo", new File([WEBP], "joinha.webp", { type: "image/webp" }));
  const r1 = await fetch(`${BASE}/api/chat/figurinhas`, { method: "POST", headers: { cookie: COOKIE }, body: corpo });
  const j1 = await r1.json();
  criada = j1?.figurinha?.id ?? null;
  conferir(r1.status === 200 && criada, "um .webp entra no pacote", `${r1.status} ${j1?.error ?? ""}`);
  conferir(!!j1?.figurinha?.url, "…e volta com a URL assinada para a grade desenhar");

  // ---- 2. o pacote lista o que eu posso enviar ----
  const r2 = await fetch(`${BASE}/api/chat/figurinhas`, { headers: { cookie: COOKIE } });
  const j2 = await r2.json();
  conferir(
    (j2.figurinhas ?? []).some((f) => f.id === criada),
    "a figurinha aparece no pacote",
    `${(j2.figurinhas ?? []).length} no pacote`,
  );

  // ---- 3. o que NÃO é figurinha é recusado ----
  const ruim = new FormData();
  ruim.set("arquivo", new File([Buffer.from("nao sou webp")], "x.png", { type: "image/png" }));
  const r3 = await fetch(`${BASE}/api/chat/figurinhas`, { method: "POST", headers: { cookie: COOKIE }, body: ruim });
  conferir(r3.status === 415, "arquivo que não é .webp é recusado, com o motivo", `${r3.status}`);

  // ---- 4. enviar a figurinha do pacote para a conversa ----
  const r4 = await fetch(`${BASE}/api/chat/enviar-midia`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: COOKIE },
    body: JSON.stringify({ cliente_id: ENSAIO, figurinha_id: criada }),
  });
  const j4 = await r4.json();
  conferir(r4.status === 200 && j4?.tipo === "sticker", "a figurinha sai como FIGURINHA, não como imagem", `${r4.status} ${j4?.tipo ?? j4?.error ?? ""}`);

  if (j4?.wamid) {
    const { data: msg } = await sb.from("mensagens")
      .select("id,midia_tipo,midia_path,enviada_por").eq("id", j4.wamid).maybeSingle();
    conferir(msg?.midia_tipo === "sticker" && msg?.enviada_por === "operator", "…e é espelhada na conversa");
    conferir(
      msg?.midia_path && !String(msg.midia_path).startsWith("figurinhas/"),
      "…com uma CÓPIA do arquivo, não apontando para o pacote",
      String(msg?.midia_path ?? "").slice(0, 24),
    );
    await sb.from("mensagens").delete().eq("id", j4.wamid);
    if (msg?.midia_path) await sb.storage.from("wa-midia").remove([msg.midia_path]);
  }

  // ---- 5. a tela: o botão e a gaveta ----
  const chrome = await subirChrome({ porta: 9497 });
  try {
    const a = await novaAba(chrome);
    await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
    await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 5000 });
    await a.ate(`document.querySelector('textarea')`, { ms: 20_000 });
    conferir(
      await a.js(`return !!document.querySelector('button[aria-label="Figurinhas"]');`),
      "o botão de figurinhas está na caixa de mensagem, ao lado do emoji",
    );
    await a.js(`document.querySelector('button[aria-label="Figurinhas"]').click(); return true;`);
    await a.ate(`[...document.querySelectorAll('span')].some(s => s.textContent.trim() === "figurinhas")`, { ms: 8000 });
    await espera(900);
    const naGaveta = await a.js(`
      const g = [...document.querySelectorAll('div')].find(d => d.textContent.trim().startsWith("figurinhas"));
      return g ? g.querySelectorAll('img').length : -1;`);
    conferir(naGaveta >= 1, "a gaveta abre com as figurinhas do pacote", `${naGaveta} na grade`);
    await a.foto("figurinhas");
    const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
    conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
  } finally { fecharChrome(chrome); }
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  if (criada) await fetch(`${BASE}/api/chat/figurinhas?id=${criada}`, { method: "DELETE", headers: { cookie: COOKIE } });
  const { count } = await sb.from("chat_figurinha").select("id", { count: "exact", head: true });
  conferir(!count, "a prova não deixou figurinha no pacote", `${count ?? 0} no pacote`);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
