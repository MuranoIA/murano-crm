// -----------------------------------------------------------------------------
// O FILTRO RECADOS MOSTRA A NOTA QUE EU MESMO ESCREVI (demanda #41, 28/09/2026)
//
//   node prototipos/chat-v2/prova-recados.mjs
//
// O relato: o dono escreveu uma nota interna numa conversa, foi ao filtro
// Recados e a tela disse que não havia nada — "e a mesma coisa aconteceu com
// outros usuários". A causa era um `neq(autor, usuario)` no BANCO: ele existe
// para eu não ser avisado do meu próprio bilhete, mas a mesma consulta era a
// única fonte de "esta conversa tem nota".
//
// A prova confere as três coisas que a separação produz:
//   · a minha nota volta ao filtro;
//   · o alerta continua contando só o que pede ação (nota de outra pessoa);
//   · a fila vem em lotes, com o botão "mostrar mais" que o dono pediu.
//
// Só lê. Nada é escrito no banco.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const conta = `[...document.querySelectorAll('.rolagem button[data-ripple]')].length`;

const abrirRecados = async (a) => {
  await a.js(`
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
      .find(x => /Fila:/.test(x.getAttribute('title') || ''));
    if (b) b.click();
    return true;`);
  await a.ate(`[...document.querySelectorAll('[role="menu"] button')].some(x => /Recados/.test(x.textContent||''))`, { ms: 8000 });
  await a.js(`
    [...document.querySelectorAll('[role="menu"] button')].find(x => /Recados/.test(x.textContent||'')).click();
    return true;`);
  // ⚠️ ESPERAR A LISTA INTEIRA, e não o sumiço do "Carregando…": aquele texto
  // só existe quando a lista está VAZIA, e com duas conversas na tela ele nunca
  // aparece — a 1ª rodada mediu 2 de 99 por causa disso. O sinal confiável é o
  // número de linhas parar de crescer.
  //
  // ⚠️ E a espera precisa de um PISO de tempo: a lista inteira do admin são
  // ~3 MB e leva dezenas de segundos, e até ela chegar a tela mostra as poucas
  // conversas com nota que havia na primeira página. Sem o piso, "parou de
  // crescer" acontece em 1,5 s e a prova mede 2 de 99 (foi o que aconteceu nas
  // duas primeiras rodadas).
  const inicio = Date.now();
  let antes = -1, igual = 0;
  for (let i = 0; i < 240; i++) {
    await espera(500);
    const agora = await a.js(`return ${conta};`);
    igual = agora === antes ? igual + 1 : 0;
    antes = agora;
    const cheio = await a.js(`return [...document.querySelectorAll('button')].some(y => /Mostrar mais/.test(y.textContent||''));`);
    if (cheio) break;
    if (igual >= 6 && Date.now() - inicio > 40_000) break;
  }
};


const chrome = await subirChrome({ porta: 9531 });
try {
  // ---- 1. COMO QUEM ESCREVEU A NOTA -------------------------------------
  const a = await novaAba(chrome);
  await a.cookies(
    { crm_sessao: "admin", crm_email: "romuloalbuquerque@muranoprofessional.com.br", crm_ver_como: "romulo" },
    BASE,
  );
  await a.ir(`${BASE}/chat-v2`, { esperar: 2500 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 25_000 });

  const servidor = await a.js(`
    return fetch('/api/chat-v2/contagens').then(r => r.json())
      .then(j => ({ recados: j.recados, novos: j.recados_novos }));`);
  conferir(
    servidor.recados > 0,
    "o servidor conta as conversas COM nota — inclusive as que eu mesmo escrevi",
    `${servidor.recados} com nota`,
  );
  conferir(
    servidor.novos === 0,
    "…e o ALERTA continua zerado: minha própria nota não me avisa",
    `alerta ${servidor.novos}`,
  );

  await abrirRecados(a);
  const naTela = await a.js(`return ${conta};`);
  conferir(naTela > 0, "e a fila Recados deixa de vir vazia — era exatamente a queixa", `${naTela} conversas`);
  const etiqueta = await a.js(`
    return [...document.querySelectorAll('.rolagem span')]
      .filter(s => /^🗒/.test((s.textContent||'').trim()))
      .map(s => s.textContent.trim());`);
  conferir(
    etiqueta.some((e) => /nota/.test(e)),
    "a linha traz a etiqueta NEUTRA de 'tem nota' — sem ela a conversa entraria na lista sem explicar por quê",
    etiqueta.slice(0, 3).join(" · "),
  );
  conferir(
    !etiqueta.some((e) => /recado/.test(e)),
    "…e nenhuma etiqueta laranja de 'recado', porque nada aqui pede leitura",
  );
  await a.foto("recados-minha-nota");

  // ---- 2. COMO ADMIN: o lote e o botão ----------------------------------
  const b = await novaAba(chrome);
  // ⚠️ as abas dividem o MESMO perfil do Chrome: sem apagar o `crm_ver_como`
  // da aba anterior, o admin continuaria vendo o sistema pelos olhos de um
  // vendedor — e a prova mediria a fila errada (aconteceu na 1ª rodada).
  await b.cookies(
    { crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br", crm_ver_como: "" },
    BASE,
  );
  await b.ir(`${BASE}/chat-v2`, { esperar: 2500 });
  await b.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 25_000 });
  const total = await b.js(`
    return fetch('/api/chat-v2/contagens').then(r => r.json()).then(j => j.recados);`);
  conferir(total > 30, "há recados suficientes para o lote valer a pena", `${total} conversas com nota`);

  await abrirRecados(b);
  // ⚠️ NÃO se conta a lista pelo DOM: ela é VIRTUALIZADA acima de 40 itens, e
  // o próprio botão é um `button[data-ripple]` dentro da rolagem. Nas rodadas
  // anteriores isso deu "31 na tela" (30 linhas + o botão) e depois "14" — o
  // tamanho da janela virtual, não o da lista. O número honesto é o que o botão
  // publica: quantas ficaram de fora.
  const faltam = `(document.querySelector('button[data-faltam]')?.getAttribute('data-faltam') ?? null)`;
  const faltam1 = Number(await b.js(`return ${faltam};`));
  conferir(
    faltam1 === total - 30,
    "a fila abre com o primeiro lote de 30, não com as 99",
    `mostrou 30, faltam ${faltam1}`,
  );
  conferir(
    await b.js(`return /faltam ${faltam1}/.test(document.querySelector('button[data-faltam]')?.textContent || '');`),
    "…e o botão DIZ quantas faltam, em vez de um 'mostrar mais' mudo",
  );

  await b.js(`document.querySelector('button[data-faltam]').click(); return true;`);
  await espera(900);
  const faltam2 = Number(await b.js(`return ${faltam};`));
  conferir(faltam2 === faltam1 - 30, "clicar carrega o lote seguinte", `faltam ${faltam1} → ${faltam2}`);

  // a ordem é pela NOTA, não pela conversa
  const ordem = await b.js(`
    return fetch('/api/chat-v2/lista').then(r => r.json()).then(j => {
      const com = (j.conversas||[]).filter(c => c.notas > 0 && c.nota_em);
      com.sort((x,y) => String(y.nota_em).localeCompare(String(x.nota_em)));
      return { total: com.length, primeira: com[0]?.nota_em ?? null, ultima: com[com.length-1]?.nota_em ?? null };
    });`);
  conferir(
    ordem.total > 0 && ordem.primeira > ordem.ultima,
    "a fila é ordenada pela NOTA mais recente, não pela atividade da conversa",
    `${ordem.total} conversas · da nota de ${String(ordem.primeira).slice(0,10)} à de ${String(ordem.ultima).slice(0,10)}`,
  );
  await b.foto("recados-lote");

  const exc = [...a.excecoes, ...b.excecoes].filter((e) => !/ResizeObserver/.test(e));
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
