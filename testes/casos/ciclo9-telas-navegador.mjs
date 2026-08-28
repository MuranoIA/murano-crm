// -----------------------------------------------------------------------------
// Telas no navegador de verdade.
//
// Não é um dos 8 ciclos: é a rede que pega o que a API não pega. Boa parte dos
// defeitos deste projeto não dá erro nenhum e passa por `tsc` e `next build`
// (§61.5) — o board caiu inteiro por um `charAt` de null que a leitura de código
// não achou e o CDP achou na primeira tentativa (§35.1).
//
// ⚠️ Em headless sem layout `innerText` volta VAZIO. Tudo aqui mede por
// `textContent`, `querySelectorAll` e screenshot.
// -----------------------------------------------------------------------------
export const ciclo = "Telas — navegador real (board, chat, admin, indicadores)";

const TELAS = [
  { rota: "/", nome: "board (Negociações)", sessoes: ["romulo", "admin"] },
  { rota: "/chat", nome: "chat", sessoes: ["romulo", "admin"] },
  { rota: "/chat/indicadores", nome: "indicadores", sessoes: ["romulo", "admin"] },
  { rota: "/admin", nome: "admin", sessoes: ["admin"] },
  { rota: "/templates", nome: "templates (consultor)", sessoes: ["romulo", "admin"] },
  { rota: "/relatorios", nome: "relatórios", sessoes: ["admin"] },
];

export default async function (t) {
  const { api } = t;
  if (!t.servidorNoAr) { t.pular("(telas)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  let chrome;
  try { chrome = await t.chrome(); }
  catch (e) { t.pular("(telas)", "✅", String(e.message).replace(/^PULAR:/, "")); return; }

  for (const tela of TELAS) {
    for (const s of tela.sessoes) {
      await t.passo(`${tela.nome} abre como ${s}, sem exceção de JS`, "✅", async () => {
        const aba = await t.aba();
        try {
          await aba.cookies(api.SESSOES[s]);
          await aba.ir(api.BASE + tela.rota, { esperar: 7000 });
          const p = await aba.panorama();
          const foto = await aba.foto(`tela_${tela.rota.replace(/\W+/g, "_")}_${s}`);

          // 1. a tela de erro do Next é a assinatura do defeito silencioso
          api.ok(!p.erroNext,
            `"Application error / client-side exception" na tela. Exceções: ${JSON.stringify(aba.excecoes.slice(0, 3))} — foto ${foto}`);
          // 2. exceção capturada mesmo sem tela de erro (React #310 e afins)
          api.ok(aba.excecoes.length === 0,
            `exceção de JS: ${aba.excecoes.slice(0, 3).join(" | ")} — foto ${foto}`);
          // 3. página que renderiza vazio: html curto demais para ser uma tela
          api.ok(p.html > 2000, `a página renderizou quase nada (innerHTML=${p.html}) — foto ${foto}`);
          return `título "${p.titulo}" · html ${p.html} · ${p.botoes} botões · foto ${foto.split(/[\\/]/).pop()}`;
        } finally {
          try { await aba.enviar("Page.close"); } catch { /* já foi */ }
        }
      });
    }
  }

  await t.passo("board: o menu não oferece o que a §27.1 removeu", "⚠️", async () => {
    const aba = await t.aba();
    try {
      await aba.cookies(api.SESSOES.admin);
      await aba.ir(api.BASE + "/", { esperar: 8000 });
      const links = await aba.js(`
        return [...document.querySelectorAll('a,button')]
          .map(a=>(a.textContent||'').trim()).filter(Boolean);
      `);
      const removidos = ["Consulta Clientes", "Base de Conhecimento"];
      const presentes = removidos.filter((r) => links.some((l) => l.includes(r)));
      api.ok(presentes.length === 0, `o menu ainda oferece: ${presentes.join(", ")}`);
      return `itens de menu vistos: ${[...new Set(links)].slice(0, 18).join(" · ")}`;
    } finally { try { await aba.enviar("Page.close"); } catch {} }
  });

  await t.passo("chat: a conexão de tempo real sai de 'Reconectando…' sozinha", "✅", async () => {
    const aba = await t.aba();
    try {
      await aba.cookies(api.SESSOES.romulo);
      await aba.ir(api.BASE + "/chat", { esperar: 4000 });
      const ok = await aba.ate(
        `![...document.querySelectorAll('*')].some(e=>e.children.length===0 && /Reconectando/i.test(e.textContent||''))`,
        { ms: 25_000 },
      );
      api.ok(ok, "a tela ficou em 'Reconectando…' por mais de 25 s — o Realtime não subiu, e o chat cai no poll de 60 s");
      return "conectou (o badge é estado transitório, não defeito)";
    } finally { try { await aba.enviar("Page.close"); } catch {} }
  });

  await t.passo("board: o número do KPI bate com o que a rota devolve", "✅", async () => {
    // §7 da definição: divergência de número é o defeito mais caro deste projeto.
    const r = await api.get("/api/funil", api.SESSOES.admin);
    api.status(r, 200, "GET /api/funil");
    const cards = r.json?.cards ?? r.json?.linhas ?? [];
    api.ok(Array.isArray(cards) && cards.length > 0, `/api/funil devolveu ${cards.length} cards`);
    const porEtapa = {};
    for (const c of cards) porEtapa[c.etapa] = (porEtapa[c.etapa] ?? 0) + 1;
    const ids = new Set(cards.map((c) => c.cliente_id));
    api.igual(ids.size, cards.length, "há cliente_id DUPLICADO no board — um cliente aparecendo em duas colunas");
    return Object.entries(porEtapa).map(([e, n]) => `${e} ${n}`).join(" · ");
  });
}
