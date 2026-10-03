// -----------------------------------------------------------------------------
// OS DOIS BOTÕES DA CAMPANHA, NO RODAPÉ (demanda #65, 03/10/2026)
//
//   npx next start -p 3122      (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-botoes-campanha.mjs
//
// Pedido do dono: "criar campanha fica no canto inferior esquerdo e disparar
// agora no canto inferior direito".
//
// ⚠️ POSIÇÃO SE MEDE, NÃO SE OLHA — mas com a armadilha da §41.5 em mente:
// comparar o TOPO de dois botões de alturas diferentes dá números diferentes
// mesmo na mesma linha. Aqui o que vale é o CENTRO vertical (mesma faixa) e o
// `left` (quem está à esquerda). E tira foto, porque para desenho a imagem
// decide.
//
// ⚠️ SÓ LÊ. Não cria campanha e, principalmente, NÃO CLICA em "Disparar agora":
// aquele botão manda template para cliente de verdade, e cada um custa dinheiro.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3122";
const EU = "ia@muranoprofessional.com.br";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9685 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: EU }, BASE);
  await a.ir(`${BASE}/admin-novo`, { esperar: 3000 });

  // ⚠️ TRÊS CLIQUES, e cada um já enganou esta prova uma vez:
  //  1. a aba padrão é "Lista de transferência", não Campanhas. O painel de
  //     campanhas EXISTE no DOM escondido, então os botões são encontrados e
  //     medem 0x0 — número que parece defeito de layout e é só tela errada;
  //  2. o formulário só nasce no "+ Nova campanha";
  //  3. sem prévia não há o que disparar, e o botão não existe.
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim().startsWith('Campanhas'));
    if (b) b.click(); return !!b;`);
  await espera(800);
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Nova campanha/.test(x.textContent||''));
    if (b) b.click(); return !!b;`);
  const abriu = await a.ate(`/Criar campanha/.test(document.body.textContent || '')`, { ms: 25_000 });
  conferir(abriu, "o formulário de campanha abre");

  // ---- monta a prévia, que é o que faz o botão de disparo existir ---------
  //
  // ⚠️ O formulário ABRE NO MODO "usar um disparo que já aconteceu", e aí o
  // montador de disparo nem está na tela. Para chegar no que a #65 muda é
  // preciso escolher o modo — cujo botão se chama, ironicamente, "Disparar
  // agora": o MESMO nome do botão de ação. Enquanto o rodapé não existe, só
  // há um com esse texto, e é o do modo.
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Disparar agora');
    if (b) b.click(); return !!b;`);
  await espera(900);

  // ⚠️ "Ver quem vai receber" SÓ CALCULA. É o limite desta prova: ela nunca
  // clica no "Disparar agora" de AÇÃO, que manda template a cliente de verdade
  // e custa dinheiro por envio.
  await a.js(`
    const s = document.querySelector('select');
    if (s && s.options.length > 1) {
      const d = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      d.call(s, s.options[1].value);
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;`);
  await espera(700);
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Ver quem vai receber/.test(x.textContent||''));
    if (b && !b.disabled) b.click(); return !!b;`);

  // ---- a medição ---------------------------------------------------------
  //
  // ⚠️ "Disparar agora" é o nome de DOIS botões: o seletor de modo (ao lado de
  // "Usar um disparo que já aconteceu") e a ação. Procurar pelo texto acha o
  // primeiro, que nunca esteve no rodapé — e a prova acusaria um defeito que
  // não existe. O jeito honesto é partir do "Criar campanha" e olhar os IRMÃOS
  // dele: a pergunta do dono era exatamente "os dois lado a lado no rodapé".
  await a.ate(`
    const c = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim().startsWith('Criar campanha'));
    return !!(c && [...c.parentElement.children].some(e => (e.textContent||'').trim() === 'Disparar agora'));`,
    { ms: 30_000 });

  const m = await a.js(`
    const c = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim().startsWith('Criar campanha'));
    if (!c) return { achou: false };
    const irmaos = [...c.parentElement.querySelectorAll('button')];
    const d = irmaos.find(e => (e.textContent||'').trim() === 'Disparar agora');
    const cx = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), meio: Math.round(r.top + r.height / 2), w: Math.round(r.width) }; };
    return { achou: true, noRodape: !!d, criar: cx(c), disparar: d ? cx(d) : null };`);

  conferir(m.achou, "o 'Criar campanha' está no rodapé");
  conferir(m.noRodape, "o 'Disparar agora' está NO MESMO rodapé (#65)", m.noRodape ? "sim" : "não");
  if (m.noRodape) {
    conferir(
      m.criar.w > 0 && m.disparar.w > 0,
      "…e os dois estão de fato desenhados",
      `larguras ${m.criar.w} e ${m.disparar.w}`,
    );
    conferir(
      m.criar.x < m.disparar.x,
      "'Criar campanha' à ESQUERDA, 'Disparar agora' à DIREITA",
      `x ${m.criar.x} e ${m.disparar.x}`,
    );
    conferir(
      Math.abs(m.criar.meio - m.disparar.meio) < 8,
      "…na mesma linha — medido pelo CENTRO, nunca pelo topo (§41.5)",
      `centros ${m.criar.meio} e ${m.disparar.meio}`,
    );
  }

  await a.foto("campanha-rodape");

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "OK " : "XX "} ${p.n}${p.d ? `  -- ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`
${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
