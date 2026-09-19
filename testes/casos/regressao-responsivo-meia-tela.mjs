// -----------------------------------------------------------------------------
// Regressão: o CRM com a janela PELA METADE (demanda 11).
//
// O relato: a consultora divide o monitor em duas janelas do Chrome e o sistema
// fica com metade da largura — 683 px num monitor de 1366, 960 num de 1920. Ali
// "itens se sobrepõem". A tela só conhecia "celular" (< 768) e "mesa" (todo o
// resto), e meia janela cai justamente no meio.
//
// O que foi MEDIDO antes de mexer (Chrome headless, 900 px de altura):
//
//   board   768 px   página com 974 px de largura (206 px de transbordo), com o
//                    tema, o "⋯" e o "Sair" fora da tela
//   board   960 px   14 px de transbordo: "Sair" cortado
//   chat    768 px   204 px de transbordo; o painel do cliente virava uma faixa
//                    por cima da conversa
//   chat    960 px   três colunas (lista 320 + conversa + painel 320) deixavam a
//                    conversa com ~320 px: "Cliente" cobria o nome, Favoritar e
//                    PDF saíam cortados, TEMPLATE ficava em cima do enviar
//
// Nada disso dá erro: `tsc` e `next build` passam limpos (§61.5). O que pega é
// medir `scrollWidth` contra `clientWidth` em cada largura — e olhar a captura,
// porque sonda numérica não diz que um botão está em cima de outro (§41.5).
//
// ⚠️ Este caso NÃO depende de o board terminar de carregar os cards: mede o
// cabeçalho e a estrutura, que existem desde a primeira pintura.
// -----------------------------------------------------------------------------
export const ciclo = "Regressão — o CRM com a janela pela metade";

// 683 = metade de 1366 · 768 = a fronteira do celular · 960 = metade de 1920 ·
// 1064 = onde a navegação volta à barra · 1184 = onde voltam as três colunas.
const LARGURAS = (process.env.CRM_LARGURAS ?? "683,768,960,1064,1184,1280,1440").split(",").map(Number);
const LIMITE_CELULAR = 768, LIMITE_NAVEGACAO = 1064, LIMITE_TRES_COLUNAS = 1184;

// Elemento largo DENTRO de uma faixa que rola na horizontal não é transbordo: é
// a faixa fazendo o trabalho dela (o board rola de lado por desenho; a régua de
// abas da ficha do cliente também). Sem esta ressalva o teste vira flaky e
// ensina a ignorar o próprio alarme.
const SONDA_TRANSBORDO = `
  const W = document.documentElement.clientWidth;
  const rolaDeLado = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) return true;
    }
    return false;
  };
  const fora = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right <= W + 1 && r.left >= -1) continue;
    if (rolaDeLado(el)) continue;
    fora.push({ tag: el.tagName, l: Math.round(r.left), r: Math.round(r.right),
                txt: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) });
  }
  return { W, scrollW: document.documentElement.scrollWidth, fora: fora.slice(0, 6), total: fora.length };
`;

async function janela(t, larg) {
  const aba = await t.aba();
  await aba.enviar("Emulation.setDeviceMetricsOverride", { width: larg, height: 900, deviceScaleFactor: 1, mobile: false });
  await aba.cookies(t.api.SESSOES.admin);
  return aba;
}

function exigirSemTransbordo(api, s, onde, foto) {
  api.ok(
    s.total === 0 && s.scrollW <= s.W + 1,
    `${onde}: a página mede ${s.scrollW}px numa janela de ${s.W}px — ${s.total} elemento(s) fora. `
    + `${JSON.stringify(s.fora)} — foto ${foto}`,
  );
}

const fim = (foto) => foto.split(/[\\/]/).pop();

export default async function (t) {
  const { api } = t;
  if (!t.servidorNoAr) { t.pular("(meia tela)", "✅", `servidor fora do ar em ${api.BASE}`); return; }
  try { await t.chrome(); }
  catch (e) { t.pular("(meia tela)", "✅", String(e.message).replace(/^PULAR:/, "")); return; }

  // Uma conversa real para abrir por link direto (?cliente=). Não pode ser id
  // sintético (winthor:, venda:) — esses não têm conversa para abrir.
  const lista = await api.chamar("/api/chat", { sessao: api.SESSOES.admin });
  const conversa = (lista.json?.conversas ?? []).find(
    (c) => c.cliente_id && !/^(winthor|venda):/.test(c.cliente_id),
  );

  for (const larg of LARGURAS) {
    const recolhida = larg < LIMITE_NAVEGACAO;
    const emFolha = larg < LIMITE_TRES_COLUNAS;

    // ---------------------------------------------------------------- board
    await t.passo(`board em ${larg}px: o cabeçalho cabe e ${recolhida ? "a navegação recolhe no ☰" : "a navegação fica na barra"}`, "✅", async () => {
      const aba = await janela(t, larg);
      try {
        await aba.ir(`${api.BASE}/`, { esperar: 3000 });
        if (!(await aba.ate(`[...document.querySelectorAll('a,button')].some(e => e.title === 'Menu' || /Chat/.test(e.textContent||''))`, { ms: 60_000 }))) {
          throw new Error("o cabeçalho do board não apareceu");
        }
        api.ok(aba.excecoes.length === 0, `exceção de JS: ${aba.excecoes.slice(0, 2).join(" | ")}`);
        const s = await aba.js(SONDA_TRANSBORDO);
        const foto = await aba.foto(`meia_tela_board_${larg}`);
        exigirSemTransbordo(api, s, "board", foto);

        const cab = await aba.js(`
          const menu = [...document.querySelectorAll('button')].find(b => b.title === 'Menu');
          const sair = [...document.querySelectorAll('button')].find(b => /^Sair$/.test((b.textContent||'').trim()));
          const r = sair ? sair.getBoundingClientRect() : null;
          return { temMenu: !!menu, temSair: !!sair, sairDireita: r ? Math.round(r.right) : null };
        `);
        if (recolhida) {
          api.ok(cab.temMenu, `a ${larg}px a navegação devia estar atrás do ☰ e o botão não existe — foto ${foto}`);
          api.ok(!cab.temSair, `a ${larg}px o "Sair" devia ter ido para o menu, mas continua na barra — foto ${foto}`);
        } else {
          api.ok(!cab.temMenu, `a ${larg}px cabe tudo na barra, mas o ☰ apareceu — foto ${foto}`);
          api.ok(cab.temSair && cab.sairDireita <= s.W, `a ${larg}px o "Sair" está fora da janela (${cab.sairDireita} > ${s.W}) — foto ${foto}`);
        }
        return `${s.scrollW}px em ${s.W}px · ${recolhida ? "☰" : "barra completa"} · foto ${fim(foto)}`;
      } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
    });

    if (recolhida) {
      await t.passo(`board em ${larg}px: o menu ☰ aberto também cabe, e leva ao "Sair"`, "✅", async () => {
        const aba = await janela(t, larg);
        try {
          await aba.ir(`${api.BASE}/`, { esperar: 3000 });
          if (!(await aba.ate(`[...document.querySelectorAll('button')].some(b => b.title === 'Menu')`, { ms: 60_000 }))) {
            throw new Error("o botão ☰ não apareceu");
          }
          await aba.js(`[...document.querySelectorAll('button')].find(b => b.title === 'Menu').click(); return true;`);
          await new Promise((r) => setTimeout(r, 700));
          const s = await aba.js(SONDA_TRANSBORDO);
          const foto = await aba.foto(`meia_tela_board_menu_${larg}`);
          exigirSemTransbordo(api, s, "menu ☰ aberto", foto);
          const temSair = await aba.js(`return [...document.querySelectorAll('button')].some(b => /^Sair$/.test((b.textContent||'').trim()));`);
          api.ok(temSair, `o menu ☰ abriu sem o "Sair" — a saída ficou inalcançável a ${larg}px. foto ${foto}`);
          return `menu aberto sem transbordo · foto ${fim(foto)}`;
        } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
      });
    }

    // ----------------------------------------------------------------- chat
    await t.passo(`chat em ${larg}px: a conversa aberta cabe, os botões não se sobrepõem e dá para escrever`, "✅", async () => {
      if (!conversa) throw new Error("PULAR:nenhuma conversa na lista para abrir");
      const aba = await janela(t, larg);
      try {
        await aba.ir(`${api.BASE}/chat?cliente=${encodeURIComponent(conversa.cliente_id)}`, { esperar: 3000 });
        // o compositor só existe com conversa selecionada — é o sinal de que abriu
        if (!(await aba.ate(`!!document.querySelector('textarea')`, { ms: 90_000 }))) {
          throw new Error("PULAR:a conversa não abriu a tempo (lista lenta) — nada foi medido");
        }
        await new Promise((r) => setTimeout(r, 1500));
        api.ok(aba.excecoes.length === 0, `exceção de JS: ${aba.excecoes.slice(0, 2).join(" | ")}`);
        const s = await aba.js(SONDA_TRANSBORDO);
        const foto = await aba.foto(`meia_tela_chat_${larg}`);
        exigirSemTransbordo(api, s, "conversa aberta", foto);

        const m = await aba.js(`
          const q = (titulo) => [...document.querySelectorAll('button,a')].find(e => (e.getAttribute('title')||'').includes(titulo));
          const ta = document.querySelector('textarea');
          const cx = ta ? ta.getBoundingClientRect() : null;
          const nomes = ['Passar esta conversa', 'Encerrar atendimento', 'dados do cliente'];
          const botoes = nomes.map(n => q(n)).filter(Boolean).map(e => e.getBoundingClientRect());
          // dois botões do cabeçalho não podem ocupar o mesmo lugar
          let sobrepostos = 0;
          for (let i = 0; i < botoes.length; i++) for (let j = i + 1; j < botoes.length; j++) {
            const a = botoes[i], b = botoes[j];
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 2 && oy > 2) sobrepostos++;
          }
          const acao = q('Passar esta conversa');
          const cab = acao ? acao.parentElement.closest('div') : null;
          const nome = cab ? cab.querySelector('b') : null;
          // coluna do painel do cliente: só existe como COLUNA nas três colunas
          const painelColuna = [...document.querySelectorAll('div')].some(d => {
            const cs = getComputedStyle(d), r = d.getBoundingClientRect();
            return cs.position !== 'fixed' && r.height > 300 && r.width > 250 && r.width < 340
              && /direto do WinThor|contato e cadastro/.test(d.textContent || '') && d.children.length < 4;
          });
          return { campo: cx ? Math.round(cx.width) : null, achou: botoes.length, sobrepostos,
                   nomeLarg: nome ? Math.round(nome.getBoundingClientRect().width) : null,
                   direitaMax: botoes.length ? Math.round(Math.max(...botoes.map(b => b.right))) : null,
                   painelColuna };
        `);
        api.ok(m.sobrepostos === 0, `${m.sobrepostos} par(es) de botões do cabeçalho um em cima do outro a ${larg}px — foto ${foto}`);
        if (m.direitaMax != null) api.ok(m.direitaMax <= s.W, `botão do cabeçalho fora da janela (${m.direitaMax} > ${s.W}) — foto ${foto}`);
        // o campo de mensagem é o controle principal; some sem barulho quando os
        // botões da pílula somam mais que a largura (foi 16 px no celular)
        api.ok(m.campo != null && m.campo >= 110, `a caixa de mensagem ficou com ${m.campo}px a ${larg}px — foto ${foto}`);
        // e o nome do cliente precisa ter espaço para ser lido
        if (larg >= LIMITE_CELULAR) api.ok(m.nomeLarg == null || m.nomeLarg >= 100, `o nome do cliente ficou com ${m.nomeLarg}px no cabeçalho a ${larg}px — foto ${foto}`);

        // Painel do cliente: coluna nas três colunas, folha (fechada) nas demais.
        if (larg >= LIMITE_TRES_COLUNAS) {
          api.ok(m.painelColuna, `a ${larg}px o painel do cliente devia ser a terceira coluna — foto ${foto}`);
        } else {
          api.ok(!m.painelColuna, `a ${larg}px o painel do cliente devia ser uma folha, mas é coluna e sufoca a conversa — foto ${foto}`);
        }
        return `campo ${m.campo}px · nome ${m.nomeLarg ?? "?"}px · painel ${emFolha ? "em folha" : "em coluna"} · foto ${fim(foto)}`;
      } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
    });

    if (larg >= LIMITE_CELULAR && emFolha) {
      await t.passo(`chat em ${larg}px: o botão "Cliente" abre a folha lateral, dentro da janela`, "✅", async () => {
        if (!conversa) throw new Error("PULAR:nenhuma conversa na lista para abrir");
        const aba = await janela(t, larg);
        try {
          await aba.ir(`${api.BASE}/chat?cliente=${encodeURIComponent(conversa.cliente_id)}`, { esperar: 3000 });
          if (!(await aba.ate(`!!document.querySelector('textarea')`, { ms: 90_000 }))) {
            throw new Error("PULAR:a conversa não abriu a tempo (lista lenta) — nada foi medido");
          }
          await new Promise((r) => setTimeout(r, 1200));
          const abriu = await aba.js(`
            const b = [...document.querySelectorAll('button')].find(e => (e.getAttribute('title')||'').includes('dados do cliente'));
            if (!b) return false; b.click(); return true;`);
          api.ok(abriu, "o botão que abre os dados do cliente não existe — sem ele o ERP fica inalcançável nesta largura");
          await new Promise((r) => setTimeout(r, 800));
          const folha = await aba.js(`
            const d = [...document.querySelectorAll('div')].find(x => {
              const cs = getComputedStyle(x), r = x.getBoundingClientRect();
              return cs.position === 'fixed' && r.height > 300 && r.width > 200 && r.width < 400 && parseInt(cs.zIndex||'0',10) >= 60;
            });
            if (!d) return null;
            const r = d.getBoundingClientRect();
            return { esq: Math.round(r.left), dir: Math.round(r.right), larg: Math.round(r.width) };
          `);
          const foto = await aba.foto(`meia_tela_chat_folha_${larg}`);
          api.ok(!!folha, `o botão foi clicado e a folha do cliente não apareceu — foto ${foto}`);
          api.ok(folha.dir <= larg + 1, `a folha lateral sai da janela (${folha.dir} > ${larg}) — foto ${foto}`);
          api.ok(folha.larg <= 362, `a folha ocupa ${folha.larg}px — devia ser uma lateral de no máximo 360, não tomar a conversa — foto ${foto}`);
          const s = await aba.js(SONDA_TRANSBORDO);
          exigirSemTransbordo(api, s, "folha do cliente aberta", foto);
          return `folha de ${folha.larg}px encostada na direita · foto ${fim(foto)}`;
        } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
      });
    }
  }
}
