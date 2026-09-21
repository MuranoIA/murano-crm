// -----------------------------------------------------------------------------
// FASE 5 — segunda leva de lacunas, conferida no navegador.
//
//   node prototipos/chat-v2/ensaio.mjs criar      # a conversa de ensaio, com janela aberta
//   node prototipos/chat-v2/prova-paridade-b.mjs
//
//   · lacuna 4  — o chip "Recados" existe e conta (0 é um número válido);
//   · lacuna 11 — a ordenação inverte a lista;
//   · lacunas 7/8/9 — o "⋯" da conversa: pausa, pedir localização e PDF;
//     PEDIR LOCALIZAÇÃO é clicado de verdade (o servidor sobe com
//     SIMULACAO_ENVIO=1: o wamid é `sim.` e nada sai para ninguém);
//   · lacunas 5/6 — a ficha do WinThor no painel de um contato sem ERP, e o
//     "Pedir os dados" escrevendo NA CAIXA, sem enviar;
//   · lacuna 12 — o rodapé "＋ Nova resposta rápida" abre o formulário (sem
//     salvar: a tabela é compartilhada com o time);
//   · REGRESSÃO achada nesta fase: a rota das respostas devolve `corpo`, e o
//     compositor lia `texto`. Filtrar por um trecho que não batesse no atalho
//     derrubava a tela; colar punha "undefined" na caixa.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

// ⚠️ Cada passo abre uma aba NOVA — e a primeira versão nunca as fechava: no
// fim havia sete abas do chat vivas, cada uma com o seu Realtime, e numa
// máquina com pouca memória os últimos passos estouravam o tempo (o "+" do novo
// contato "falhou" assim; sozinho ele abre em 345 ms). A aba anterior é
// fechada antes de abrir a próxima.
let abaAnterior = null;
async function abrirTela(chrome, largura, url) {
  if (abaAnterior) { try { await abaAnterior.enviar("Page.close"); } catch {} }
  const aba = await novaAba(chrome);
  abaAnterior = aba;
  await aba.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await aba.enviar("Emulation.setDeviceMetricsOverride", {
    width: largura, height: largura < 500 ? 780 : 900, deviceScaleFactor: 1, mobile: largura < 500,
  });
  await aba.ir(`${BASE}${url}`, { esperar: 3500 });
  return aba;
}
const textoDaCaixa = `(document.querySelector('textarea')||{}).value||''`;

const chrome = await subirChrome({ porta: 9433 });
try {
  // ======================= lista: recados e ordenação =======================
  {
    const a = await abrirTela(chrome, 1280, "/chat-v2");
    conferir(await a.ate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('Recados'))`),
      "o chip Recados existe");
    const primeiro = () => a.js(`const b=[...document.querySelectorAll('.rolagem [aria-current], .rolagem button')].find(x=>x.querySelector('span[aria-hidden]')); return b? b.textContent.slice(0,40):'';`);
    await a.ate(`document.querySelectorAll('.rolagem button').length>5`);
    const antes = await primeiro();
    await a.clicarTexto("button", "Mais recentes");
    await a.ate(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Mais antigas'))`, { ms: 30_000 });
    await espera(1500);
    const depois = await primeiro();
    conferir(antes && depois && antes !== depois, "a ordenação inverte a lista", `${antes.slice(0, 18)} → ${depois.slice(0, 18)}`);
    const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
    conferir(!exc.length, "lista: sem exceção", exc.slice(0, 1).join(""));
  }

  // ======================= a conversa de ensaio =============================
  for (const largura of [1280, 360]) {
    const a = await abrirTela(chrome, largura, `/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`);
    const pronta = await a.ate(`document.querySelector('textarea')`, { ms: 25_000 });
    conferir(pronta, `${largura} px: o ensaio abre com a caixa (janela aberta)`);

    // ---- o "⋯" da conversa ----
    await a.js(`document.querySelector('button[aria-label="Mais ações"]').click(); return true;`);
    const menu = await a.ate(`document.querySelector('[role=menu]')`, { ms: 5000 });
    const itens = await a.js(`return [...document.querySelectorAll('[role=menuitem]')].map(b=>b.textContent+'|'+b.disabled);`);
    conferir(menu && itens.length === 3, `${largura} px: o ⋯ traz pausa, localização e PDF`, JSON.stringify(itens).slice(0, 160));
    conferir(await a.js(`const m=document.querySelector('[role=menu]').getBoundingClientRect(); return m.left>=0 && m.right<=innerWidth;`),
      `${largura} px: o menu cabe na tela`);
    await a.foto(`paridade-b-mais-${largura}`);

    if (largura === 1280) {
      const antes = await sb.from("mensagens").select("id", { count: "exact", head: true }).eq("cliente_id", ENSAIO);
      await a.clicarTexto('[role=menuitem]', "Pedir a localização");
      const ok = await a.ate(`document.body.textContent.includes('Pedido de localização enviado')`, { ms: 15_000 });
      await espera(800);
      const depois = await sb.from("mensagens").select("id", { count: "exact", head: true }).eq("cliente_id", ENSAIO);
      conferir(ok && depois.count === antes.count + 1, "pedir localização: envia (simulado) e grava a mensagem",
        `${antes.count} → ${depois.count}`);
    } else {
      await a.js(`document.querySelector('[role=menu]')?.previousElementSibling?.click(); return true;`);
    }

    // ---- painel: ficha e "pedir os dados" ----
    await a.js(`document.querySelector('button[aria-label="Dados do cliente"]').click(); return true;`);
    // ⚠️ só o painel VISÍVEL conta: a primeira versão desta prova achava o
    // texto no painel escondido de desktop e passava com a folha em esqueleto
    const ficha = await a.ate(`[...document.querySelectorAll('aside')].some(e=>e.getBoundingClientRect().width>0 && e.textContent.includes('Ficha para o WinThor'))`, { ms: 30_000 });
    conferir(await a.js(`return document.querySelectorAll('aside').length;`) === 1, `${largura} px: um painel montado, não dois`);
    conferir(ficha, `${largura} px: contato sem ERP mostra a ficha do WinThor`);
    conferir(!(await a.js(`return document.body.textContent.includes('Salvar contato (nome e CPF)');`)),
      `${largura} px: o editor antigo nome+CPF saiu (a ficha o substitui)`);
    await a.clicarTexto("button", "Pedir os dados à cliente");
    const escreveu = await a.ate(`${textoDaCaixa}.length>20`, { ms: 5000 });
    conferir(escreveu, `${largura} px: "Pedir os dados" escreve NA CAIXA`, (await a.js(`return ${textoDaCaixa};`)).slice(0, 50));
    await a.foto(`paridade-b-ficha-${largura}`);
    await a.digitar("textarea", "");

    // ---- respostas rápidas: a regressão do `corpo` e o criar ----
    await a.digitar("textarea", "/");
    await a.ate(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Nova resposta rápida'))`, { ms: 10_000 });
    const semUndefined = await a.js(`return ![...document.querySelectorAll('button')].some(b=>b.textContent.includes('undefined'));`);
    conferir(semUndefined, `${largura} px: as respostas mostram o texto (não "undefined")`);
    await a.digitar("textarea", "/zzqq");
    await espera(400);
    const vivo = await a.js(`return !!document.querySelector('textarea') && !/Application error/.test(document.body.textContent);`);
    conferir(vivo, `${largura} px: filtrar por um trecho sem atalho não derruba a tela`);
    await a.clicarTexto("button", "Nova resposta rápida");
    const form = await a.ate(`document.querySelector('input[aria-label="Atalho da resposta"]')`, { ms: 5000 });
    const atalho = await a.js(`return document.querySelector('input[aria-label="Atalho da resposta"]')?.value;`);
    conferir(form && atalho === "zzqq", `${largura} px: "＋ Nova resposta rápida" abre o formulário com o atalho digitado`, atalho);
    await a.digitar("textarea", "");

    const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
    conferir(!exc.length, `${largura} px: conversa sem exceção`, exc.slice(0, 1).join(""));
  }
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
