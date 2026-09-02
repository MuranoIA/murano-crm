// -----------------------------------------------------------------------------
// Regressão: o /chat no CELULAR não pode ter nada fora da tela.
//
// O defeito, medido em 01/09/2026 num aparelho de 390px: o cabeçalho da conversa
// punha Transferir, Resolver, WhatsApp e Cliente com o texto inteiro numa linha
// `nowrap`, então `scrollWidth` dava 684 contra `clientWidth` 390 — os quatro
// ficavam FORA DA TELA e a página inteira passava a rolar de lado. Na mesma
// medição a pílula do compositor tinha 298px de largura para 348 de conteúdo, e
// a caixa de texto sobrava com DEZESSEIS pixels; e a lista de templates, ancorada
// em `left: 0` de um botão que vive no meio da barra, ia de 151 a 485.
//
// Nada disso dá erro: `tsc` e `next build` passam limpos (§61.5). O que pega é
// medir `scrollWidth` contra `clientWidth` num viewport de celular de verdade —
// e medir também com os menus ABERTOS, que é onde o transbordo se esconde.
//
// ⚠️ `innerText` volta vazio em headless — tudo aqui mede por geometria.
// -----------------------------------------------------------------------------
export const ciclo = "Regressão — responsividade do chat no celular";

// 390 = iPhone 12/13/14. 360 = o Android popular, o mais apertado que a equipe usa.
// `CRM_LARGURAS=412,360` reproduz um aparelho específico quando alguém mandar um
// print — foi assim que o relato de 02/09/2026 foi conferido na largura dele.
const LARGURAS = (process.env.CRM_LARGURAS ?? "390,360").split(",").map(Number);

// Elemento largo DENTRO de uma faixa que rola na horizontal não é transbordo: é
// a faixa fazendo o trabalho dela (a régua de abas da ficha do cliente é assim).
// Sem esta ressalva o teste vira flaky e ensina a ignorar o próprio alarme.
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

async function celular(t, larg) {
  const aba = await t.aba();
  await aba.enviar("Emulation.setDeviceMetricsOverride", {
    width: larg, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await aba.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await aba.cookies(t.api.SESSOES.admin);
  return aba;
}

/** Abre a primeira conversa da lista. As linhas são <button> largos com <b>. */
async function abrirPrimeiraConversa(aba, larg) {
  const seletor = `[...document.querySelectorAll('button')]`
    + `.filter(b=>{const r=b.getBoundingClientRect();return r.height>40&&r.width>${larg - 90}&&b.querySelector('b');})`;
  if (!(await aba.ate(`${seletor}.length`, { ms: 30000 }))) return null;
  const nome = await aba.js(`const bs=${seletor}; bs[0].click(); return (bs[0].textContent||'').trim().slice(0,30);`);
  await new Promise((r) => setTimeout(r, 3500));
  return nome;
}

function exigirSemTransbordo(api, s, onde, foto) {
  api.ok(
    s.total === 0 && s.scrollW <= s.W + 1,
    `${onde}: a página mede ${s.scrollW}px numa tela de ${s.W}px — ${s.total} elemento(s) fora. `
    + `${JSON.stringify(s.fora)} — foto ${foto}`,
  );
}

export default async function (t) {
  const { api } = t;
  if (!t.servidorNoAr) { t.pular("(responsivo)", "✅", `servidor fora do ar em ${api.BASE}`); return; }
  try { await t.chrome(); }
  catch (e) { t.pular("(responsivo)", "✅", String(e.message).replace(/^PULAR:/, "")); return; }

  for (const larg of LARGURAS) {
    await t.passo(`/chat em ${larg}px: a lista cabe na tela`, "✅", async () => {
      const aba = await celular(t, larg);
      try {
        await aba.ir(`${api.BASE}/chat`, { esperar: 6000 });
        api.ok(aba.excecoes.length === 0, `exceção de JS: ${aba.excecoes.slice(0, 2).join(" | ")}`);
        const s = await aba.js(SONDA_TRANSBORDO);
        const foto = await aba.foto(`responsivo_${larg}_lista`);
        exigirSemTransbordo(api, s, "lista de conversas", foto);
        return `${s.scrollW}px de conteúdo em ${s.W}px de tela · foto ${foto.split(/[\\/]/).pop()}`;
      } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
    });

    await t.passo(`/chat em ${larg}px: a conversa aberta cabe, e dá para escrever`, "✅", async () => {
      const aba = await celular(t, larg);
      try {
        await aba.ir(`${api.BASE}/chat`, { esperar: 6000 });
        const abriu = await abrirPrimeiraConversa(aba, larg);
        if (!abriu) throw new Error("PULAR:nenhuma conversa na lista para abrir");

        api.ok(aba.excecoes.length === 0, `exceção de JS: ${aba.excecoes.slice(0, 2).join(" | ")}`);
        const s = await aba.js(SONDA_TRANSBORDO);
        const foto = await aba.foto(`responsivo_${larg}_conversa`);
        exigirSemTransbordo(api, s, "conversa aberta", foto);

        // A caixa de texto é o controle principal da tela. Ela some sem barulho
        // quando os botões da pílula somam mais que a largura disponível — foi
        // exatamente o que aconteceu (16px). 90 é o piso em que ainda se lê o
        // que se está escrevendo num aparelho de 360px.
        const campo = await aba.js(`
          const ta=document.querySelector('textarea');
          if(!ta) return null;
          const p=ta.parentElement;
          return { larg: Math.round(ta.getBoundingClientRect().width),
                   pilulaCabe: p.scrollWidth <= p.clientWidth + 1 };
        `);
        if (campo) {
          api.ok(campo.larg >= 90,
            `a caixa de mensagem ficou com ${campo.larg}px — os botões da pílula comeram o campo. foto ${foto}`);
          api.ok(campo.pilulaCabe, `o conteúdo da pílula não cabe nela — foto ${foto}`);
        }

        // A folha do ERP não pode nascer aberta: no celular ela é uma camada por
        // cima da conversa, e abrir um atendimento mostrava a ficha do cliente
        // em vez das mensagens.
        const fichaPorCima = await aba.js(`
          return [...document.querySelectorAll('div')].some(d=>{
            const cs=getComputedStyle(d);
            return cs.position==='fixed' && parseInt(cs.zIndex||'0',10)>=60
              && d.getBoundingClientRect().height>200
              && /Resumo|Perfil|Compras/.test(d.textContent||'');
          });
        `);
        api.ok(!fichaPorCima, `a ficha do cliente abriu por cima da conversa sem ninguém pedir — foto ${foto}`);

        return `${s.scrollW}px em ${s.W}px · caixa de texto ${campo ? campo.larg + "px" : "ausente"} `
          + `· conversa "${abriu}" · foto ${foto.split(/[\\/]/).pop()}`;
      } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
    });

    await t.passo(`/chat em ${larg}px: os menus abertos também cabem`, "✅", async () => {
      const aba = await celular(t, larg);
      try {
        await aba.ir(`${api.BASE}/chat`, { esperar: 6000 });
        if (!(await abrirPrimeiraConversa(aba, larg))) throw new Error("PULAR:nenhuma conversa para abrir");

        // Os botões viraram ícone, então `textContent` não acha mais nenhum:
        // o `title` que cada um já tinha é o que identifica.
        const clicar = (titulo) => aba.js(`
          const b=[...document.querySelectorAll('button,a')]
            .find(e=>(e.getAttribute('title')||'').includes(${JSON.stringify(titulo)}));
          if(!b) return false; b.click(); return true;`);
        const fecharVeu = () => aba.js(`
          const v=[...document.querySelectorAll('div')].find(d=>{
            const c=getComputedStyle(d), r=d.getBoundingClientRect();
            return c.position==='fixed' && r.width>=${larg} - 1 && r.height>=800 && !(d.textContent||'').trim();
          });
          if(v){ v.click(); return true; } return false;`);

        const CAMADAS = [
          ["menu ⋯ (pausa, respostas, nota)", "Mais: pausa"],
          ["lista de templates", "Escolher um template"],
          ["menu de anexo", "Anexar fotos"],
          ["painel de transferência", "Passar esta conversa"],
          ["painel de encerramento", "Encerrar atendimento"],
        ];
        const vistos = [];
        for (const [nome, titulo] of CAMADAS) {
          if (!(await clicar(titulo))) continue;
          await new Promise((r) => setTimeout(r, 700));
          const s = await aba.js(SONDA_TRANSBORDO);
          const foto = await aba.foto(`responsivo_${larg}_${nome.replace(/\W+/g, "_")}`);
          exigirSemTransbordo(api, s, nome, foto);
          vistos.push(nome);
          await fecharVeu();
          await clicar(titulo); // painéis que não têm véu fecham no próprio botão
          await new Promise((r) => setTimeout(r, 350));
        }
        api.ok(vistos.length > 0, "nenhuma camada pôde ser aberta — o teste não mediu nada");
        return `sem transbordo em: ${vistos.join(", ")}`;
      } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
    });
  }
}
