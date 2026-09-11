// -----------------------------------------------------------------------------
// Regressão — clicar na citação leva até a mensagem citada.
//
// A queixa (11/09/2026): "o cliente marca imagens referenciando elas, mas não é
// possível clicar na miniatura de referência para levar até a imagem como
// acontece no WhatsApp comum". Com cinco fotos seguidas e um "esse" citando a
// terceira, a miniatura diz QUAL — mas só se a vendedora conseguir voltar até
// ela.
//
// MEDIDO antes de construir, sobre as 601 citações do banco (amostra de 200 com
// a distância calculada): a mensagem citada está a mediana de 2 mensagens de
// distância, p90 14, p95 19, a mais longe a 68. A thread abre com as últimas
// 200, então o alvo praticamente sempre já está desenhado — o clique é rolar,
// não buscar. 8% das citações apontam para mensagem que não está no nosso
// banco, e nessas o bloco NÃO vira botão.
//
// ⚠️ DOIS CUIDADOS DE MEDIÇÃO, aprendidos aqui:
//   · `/api/chat` leva segundos nesta máquina. Esperar por TEMPO fixo depois do
//     navigate pega a tela em "Carregando conversas…" e o caso falha por culpa
//     da sonda. Espera-se pela CONDIÇÃO.
//   · a janela é encolhida de propósito: num monitor alto as 16 mensagens cabem
//     inteiras, o alvo já nasce visível e o teste passaria sem provar nada.
// -----------------------------------------------------------------------------
import { espera } from "../ajuda.mjs";
import { clienteEscreve, clienteResponde, idFicticio, resolverLinha, limparEnsaio } from "../simulacao.mjs";

export const ciclo = "Regressão — clicar na citação rola até a mensagem";

const N = 93;
/** Acha a área que realmente rola, subindo a partir da bolha. */
const ACHA_ROLAGEM = `
  let cx = document.querySelector('[data-msg]');
  while (cx && cx.scrollHeight <= cx.clientHeight + 4) cx = cx.parentElement;
`;

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  const ID = idFicticio(N);
  const NOME = `Cliente Ensaio ${N}`;
  await resolverLinha(db);

  let alvoWamid = null;

  /** Abre a conversa e espera as bolhas existirem de verdade. */
  async function abrirConversa() {
    const aba = await t.aba();
    await aba.cookies(api.SESSOES.admin, api.BASE);
    // viewport curta: ver o segundo cuidado no cabeçalho
    try { await aba.enviar("Emulation.setDeviceMetricsOverride", { width: 1000, height: 520, deviceScaleFactor: 1, mobile: false }); } catch {}
    await aba.ir(`${api.BASE}/chat?cliente=${encodeURIComponent(ID)}`, { esperar: 2000 });
    const pronto = await aba.ate("document.querySelectorAll('[data-msg]').length > 0", { ms: 90_000, passo: 500 });
    api.ok(pronto, "a conversa não chegou a desenhar nenhuma bolha em 90s");
    return aba;
  }

  // ---------------------------------------------------------------- passo 1
  await t.passo("1. a cliente manda várias mensagens e responde citando a primeira", "✅", async () => {
    const primeira = await clienteEscreve(N, "[QA] ESTA E A CITADA", NOME);
    api.igual(primeira.status, 200, "webhook da primeira mensagem");
    alvoWamid = primeira.wamid;
    db.anotarRastro(`ensaio ${ID}`, async () => { await limparEnsaio(db.sb); });

    for (let i = 0; i < 14; i++) {
      const r = await clienteEscreve(N, `[QA] enchendo a conversa ${i + 1}`, NOME);
      api.igual(r.status, 200, `webhook do recheio ${i + 1}`);
    }

    const resp = await clienteResponde(N, "[QA] esse", alvoWamid);
    api.igual(resp.status, 200, "webhook da resposta citada");

    const { data: m } = await db.sb.from("mensagens")
      .select("id,resposta_a").eq("id", resp.wamid).maybeSingle();
    api.ok(m, "a resposta não foi gravada");
    api.igual(m.resposta_a, alvoWamid, "`resposta_a` não apontou para a mensagem citada");
    return `citada ${alvoWamid.slice(0, 18)}… com 14 mensagens de distância`;
  });

  // ---------------------------------------------------------------- passo 2
  await t.passo("2. clicar na citação rola a conversa até a mensagem, e ela acende", "✅", async () => {
    let chrome;
    try { chrome = await t.chrome(); }
    catch (e) { throw new Error("PULAR:" + String(e.message).replace(/^PULAR:/, "")); }

    const aba = await abrirConversa();
    const p = await aba.panorama();
    api.ok(!p.erroNext, `o chat abriu com erro de cliente: ${JSON.stringify(aba.excecoes.slice(0, 3))}`);

    // a conversa abre no fim: o alvo tem de estar FORA da área visível
    const antes = await aba.js(`
      ${ACHA_ROLAGEM}
      const el = document.querySelector('[data-msg="${alvoWamid}"]');
      if (!cx) return { erro: 'nada rola: a conversa coube inteira na tela' };
      if (!el) return { erro: 'alvo nao desenhado' };
      const r = el.getBoundingClientRect(), rc = cx.getBoundingClientRect();
      return { visivel: r.top < rc.bottom && r.bottom > rc.top, scrollTop: cx.scrollTop };
    `);
    api.ok(!antes.erro, `antes do clique: ${antes.erro}`);
    api.ok(antes.visivel === false, "o alvo já estava visível — assim o caso não prova nada");

    // o bloco de citação da ÚLTIMA bolha (a resposta "esse")
    const clicou = await aba.js(`
      const blocos = [...document.querySelectorAll('[role="button"][title]')]
        .filter(e => /citada/i.test(e.getAttribute('title') || ''));
      const alvo = blocos[blocos.length - 1];
      if (!alvo) return false;
      alvo.click();
      return true;
    `);
    api.ok(clicou, "não achei o bloco de citação clicável (role=button + title)");

    await espera(1200);   // a rolagem é `smooth`

    const depois = await aba.js(`
      ${ACHA_ROLAGEM}
      const el = document.querySelector('[data-msg="${alvoWamid}"]');
      if (!cx || !el) return { erro: 'sumiu' };
      const r = el.getBoundingClientRect(), rc = cx.getBoundingClientRect();
      return {
        visivel: r.top < rc.bottom && r.bottom > rc.top,
        aceso: /outline-offset/.test(el.querySelector('div')?.getAttribute('style') || ''),
        scrollTop: cx.scrollTop,
      };
    `);
    const foto = await aba.foto("citacao_rolou");
    api.ok(!depois.erro, `depois do clique: ${depois.erro}`);
    api.ok(depois.visivel, `o clique não trouxe a mensagem citada para a área visível — foto ${foto}`);
    api.ok(depois.aceso, `a mensagem citada não ficou destacada — foto ${foto}`);
    api.ok(aba.excecoes.length === 0, `exceção de JS ao rolar: ${JSON.stringify(aba.excecoes.slice(0, 3))}`);

    return `rolou de ${antes.scrollTop} para ${depois.scrollTop}, alvo visível e destacado · foto ${foto}`;
  });

  // ---------------------------------------------------------------- passo 3
  await t.passo("3. o destaque some sozinho, sem deixar a bolha marcada", "✅", async () => {
    const aba = await abrirConversa();
    await aba.js(`
      const b = [...document.querySelectorAll('[role="button"][title]')].filter(e => /citada/i.test(e.getAttribute('title')||''));
      b[b.length-1]?.click(); return true;
    `);
    await espera(600);
    const aceso = await aba.js(`return /outline-offset/.test(document.querySelector('[data-msg="${alvoWamid}"] div')?.getAttribute('style')||'');`);
    await espera(2400);
    const apagou = await aba.js(`return !/outline-offset/.test(document.querySelector('[data-msg="${alvoWamid}"] div')?.getAttribute('style')||'');`);
    api.ok(aceso, "não acendeu no clique");
    api.ok(apagou, "o destaque ficou na bolha depois de 3s — vira sujeira permanente na tela");
    return "acende no clique e apaga sozinho em ~2s";
  });

  // ---------------------------------------------------------------- passo 4
  await t.passo("4. a faixa de ensaio sai do banco", "✅", async () => {
    const relato = await limparEnsaio(db.sb);
    return relato.join(" · ");
  });
}
