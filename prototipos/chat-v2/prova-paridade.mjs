// -----------------------------------------------------------------------------
// FASE 5 — as lacunas de paridade fechadas, conferidas no navegador.
//
//   node prototipos/chat-v2/prova-paridade.mjs
//
// Cobre, em 1280 px e em 360 px:
//   · lacuna 10 — a navegação do produto: na barra no desktop, dentro do "⋯"
//     no celular, e SEM rolagem horizontal da página em nenhum dos dois;
//   · lacuna 13 — "devolver para a fila" só onde o servidor aceita (sem dono
//     comercial). Conferido nos DOIS sentidos: uma conversa com dono não pode
//     oferecer, e uma sem dono tem de oferecer — senão o teste passaria com o
//     botão simplesmente removido;
//   · lacuna 2 — Minha carteira: a agenda abre, conta, filtra pela busca;
//   · lacuna 3 — Novo contato: o "+" abre o diálogo e um número JÁ conhecido
//     abre a conversa existente, sem duplicar.
//
// ⚠️ O número digitado é o da conversa de ENSAIO (faixa reservada, 73.1). Nada é
// enviado: criar contato não manda mensagem (§35.2), e o servidor sobe com
// SIMULACAO_ENVIO=1 de qualquer forma.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const COOKIE = "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br";

const passos = [];
const ok = (n, d = "") => passos.push({ n, ok: true, d });
const falha = (n, d = "") => passos.push({ n, ok: false, d });
const conferir = (cond, n, d = "") => (cond ? ok(n, d) : falha(n, d));

const semTransbordo = `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`;

async function abrirTela(chrome, largura, url) {
  const aba = await novaAba(chrome);
  await aba.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await aba.enviar("Emulation.setDeviceMetricsOverride", {
    width: largura, height: largura < 500 ? 780 : 860, deviceScaleFactor: 1, mobile: largura < 500,
  });
  await aba.ir(`${BASE}${url}`, { esperar: 3500 });
  return aba;
}

/** abre o diálogo Transferir e diz se a opção de devolver está lá */
async function temDevolver(aba) {
  await aba.ate(`document.querySelector('button[aria-label="Transferir conversa"]')`, { ms: 20_000 });
  await aba.js(`document.querySelector('button[aria-label="Transferir conversa"]').click(); return true;`);
  const abriu = await aba.ate(`document.querySelector('select option')`, { ms: 10_000 });
  if (!abriu) return null;
  const tem = await aba.js(`return !![...document.querySelectorAll('select option')].find(o=>o.value==='__fila');`);
  await aba.js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); return true;`);
  return tem;
}

const chrome = await subirChrome({ porta: 9431 });
try {
  // ======================= lacuna 10 — a barra ==============================
  const desk = await abrirTela(chrome, 1280, "/chat-v2");
  conferir(
    await desk.ate(`[...document.querySelectorAll('nav[aria-label="Telas do CRM"] a')].some(a=>a.textContent.includes('Templates'))`),
    "desktop: a navegação do produto está na barra (Templates, Indicadores…)",
  );
  conferir(await desk.js(`return ${semTransbordo};`), "desktop: sem rolagem horizontal");
  await desk.foto("paridade-desktop");

  const cel = await abrirTela(chrome, 360, "/chat-v2");
  const navVisivel = await cel.js(`const n=document.querySelector('nav[aria-label="Telas do CRM"]'); return !!n && n.getBoundingClientRect().width>0;`);
  conferir(!navVisivel, "360 px: a barra esconde a navegação (não cabe)");
  conferir(await cel.js(`return ${semTransbordo};`), "360 px: sem rolagem horizontal");
  await cel.js(`document.querySelector('button[aria-label="Mais telas"]')?.click(); return true;`);
  conferir(
    await cel.ate(`[...document.querySelectorAll('a')].some(a=>a.textContent.includes('Indicadores') && a.getBoundingClientRect().width>0)`, { ms: 8000 }),
    "360 px: os itens de navegação estão dentro do ⋯",
  );
  await cel.foto("paridade-360-menu");

  // ======================= lacuna 13 — devolver ============================
  // Uma conversa COM dono comercial, vinda da própria rota da lista.
  const r = await fetch(`${BASE}/api/chat-v2/lista?limite=60`, { headers: { cookie: COOKIE } });
  const lista = (await r.json()).conversas ?? [];
  const comDono = lista.find((c) => c.carteira_dona && !c.na_fila);
  if (!comDono) falha("há conversa com dono comercial para testar", "lista sem nenhuma");
  else {
    const a = await abrirTela(chrome, 1280, `/chat-v2?cliente=${encodeURIComponent(comDono.cliente_id)}`);
    const t = await temDevolver(a);
    conferir(t === false, "com dono comercial: NÃO oferece devolver para a fila", `carteira ${comDono.carteira_dona}, achou=${t}`);
  }
  // A de ensaio: o que o servidor diz do dono dela decide o que se espera.
  const { data: ens } = await sb.from("clientes").select("carteira").eq("id", ENSAIO).maybeSingle();
  {
    const a = await abrirTela(chrome, 1280, `/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`);
    const t = await temDevolver(a);
    const espera_ = !ens?.carteira;
    conferir(t === espera_, `ensaio (carteira=${ens?.carteira ?? "nenhuma"}): devolver ${espera_ ? "oferecido" : "escondido"}`, `achou=${t}`);
  }

  // ======================= lacuna 2 — Minha carteira ========================
  for (const largura of [1280, 360]) {
    const a = await abrirTela(chrome, largura, "/chat-v2");
    await a.clicarTexto("button", "Carteira");
    const veio = await a.ate(`/\\d+ clientes?/.test(document.body.textContent)`, { ms: 45_000 });
    const n = await a.js(`const m=document.body.textContent.match(/(\\d+) clientes?/); return m?Number(m[1]):0;`);
    conferir(veio && n > 0, `${largura} px: a agenda abre e conta os clientes`, `${n} clientes`);
    conferir(await a.js(`return ${semTransbordo};`), `${largura} px: agenda sem rolagem horizontal`);
    // a busca filtra a agenda (pelas 3 primeiras letras do primeiro nome listado)
    const nome = await a.js(`const b=[...document.querySelectorAll('.rolagem button')].find(x=>/\\d+ - /.test(x.textContent)); return b?b.textContent.replace(/^.*?\\d+ - /,'').slice(0,4):'';`);
    if (nome) {
      await a.digitar('input[placeholder="Buscar na carteira"]', nome);
      await espera(600);
      const m = await a.js(`const m=document.body.textContent.match(/(\\d+) clientes?/); return m?Number(m[1]):0;`);
      conferir(m > 0 && m < n, `${largura} px: a busca filtra a agenda`, `"${nome}" → ${m} de ${n}`);
    }
    await a.foto(`paridade-carteira-${largura}`);
  }

  // ======================= lacuna 3 — Novo contato ==========================
  {
    const a = await abrirTela(chrome, 1280, "/chat-v2");
    await a.js(`document.querySelector('button[aria-label="Novo contato"]').click(); return true;`);
    const dialogo = await a.ate(`document.querySelector('input[inputmode="tel"]')`, { ms: 10_000 });
    conferir(dialogo, "o + abre o diálogo de novo contato");
    // o número da conversa de ensaio, SEM o nono dígito e com máscara — é o
    // formato do WhatsApp dela e o normalizador tem de achar a mesma pessoa
    const tel = ENSAIO.replace(/^wa:55/, "");
    await a.digitar('input[inputmode="tel"]', `(${tel.slice(0, 2)}) ${tel.slice(2, 6)}-${tel.slice(6)}`);
    await espera(200);
    await a.clicarTexto("button", "Abrir conversa");
    const abriu = await a.ate(`location.search.includes(${JSON.stringify(encodeURIComponent(ENSAIO))})`, { ms: 20_000 });
    conferir(abriu, "número conhecido abre a conversa EXISTENTE", await a.js(`return location.search;`));
    const { count } = await sb.from("clientes").select("id", { count: "exact", head: true }).like("telefone", `%${tel.slice(-8)}`);
    conferir(count === 1, "não duplicou o contato", `${count} contato(s) com esse final`);
    await a.foto("paridade-novo-contato");
    const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
    conferir(!exc.length, "sem exceção no console", exc.slice(0, 2).join(" | "));
  }
} catch (e) {
  falha("a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
