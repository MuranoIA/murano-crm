// -----------------------------------------------------------------------------
// "SEM CONVERSA" NUMA CLIENTE COM NOVENTA MENSAGENS (demanda #43, 28/09/2026)
//
//   node prototipos/chat-v2/prova-conversa-de-outro.mjs
//
// O relato: um cliente da agenda aparecia com o selo "sem conversa" e, ao ser
// aberto, mostrava a conversa inteira. Medido: o ERP tem DOIS cadastros com o
// mesmo telefone, de RCAs diferentes. O contato do chat é um só — o telefone é
// a chave (§16.3) — e pertence à conversa de um dos dois consultores; para o
// outro, a linha não tinha conversa nenhuma.
//
// Dizer "sem conversa" ali é afirmar algo falso, que é a doença que a tela de
// Pendências existe para curar (§36.1). A linha passa a dizer DE QUEM é a
// conversa — a informação que evita disparar um template do zero em cima de um
// atendimento em curso.
//
// A prova NÃO fixa nenhum cliente: procura o caso na resposta da rota. Só lê.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9522 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2`, { esperar: 2500 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 25_000 });

  const r = await a.js(`
    return fetch('/api/chat/carteira?previa=1').then(x => x.json()).then(j => {
      const c = j.carteira ?? [];
      const deOutro = c.filter(k => k.conversa_de);
      return {
        total: c.length,
        comConversa: c.filter(k => k.tem_conversa).length,
        deOutro: deOutro.length,
        exemplo: deOutro[0] ? { codcli: deOutro[0].codcli, agenda: deOutro[0].vendedor, conversa: deOutro[0].conversa_de, tem: deOutro[0].tem_conversa } : null,
      };
    });`);

  conferir(r.total > 0, "a agenda respondeu", `${r.total} clientes`);
  conferir(r.comConversa > 0, "a rota passou a dizer QUEM TEM conversa, não só quem é meu", `${r.comConversa} com conversa`);
  conferir(
    r.deOutro > 0,
    "…e achou o caso relatado: conversa que pertence a outro consultor",
    r.exemplo ? `${r.deOutro} casos · agenda de ${r.exemplo.agenda}, conversa com ${r.exemplo.conversa}` : "",
  );
  conferir(
    !!r.exemplo && r.exemplo.tem === true,
    "esse caso vem marcado como TENDO conversa — era ele que dizia 'sem conversa'",
  );

  // e agora na tela: o selo tem de dizer de quem é
  if (r.exemplo) {
    await a.js(`
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim().startsWith('Meus atendimentos') || (x.textContent||'').includes('Minha carteira'));
      if (b) b.click();
      return true;`);
    const abriu = await a.ate(
      `[...document.querySelectorAll('[role="menuitemradio"], button')].some(x => (x.textContent||'').includes('Minha carteira'))`,
      { ms: 8000 },
    );
    if (abriu) {
      await a.js(`
        const m = [...document.querySelectorAll('[role="menuitemradio"], button')].find(x => (x.textContent||'').includes('Minha carteira'));
        if (m) m.click();
        return true;`);
    }
    const selo = await a.ate(
      `document.body.textContent.includes('conversa com ')`,
      { ms: 30_000 },
    );
    conferir(selo, "na tela, a linha diz 'conversa com <consultor>' em vez de 'sem conversa'");
    await a.foto("carteira-conversa-de-outro");
  }

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
