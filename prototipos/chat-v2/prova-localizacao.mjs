// -----------------------------------------------------------------------------
// O PINO DA CLIENTE APARECE NO CHAT (demanda #44, 28/09/2026)
//
//   node prototipos/chat-v2/ensaio.mjs criar
//   ENSAIO_VISIVEL=1 npx next start -p 3120        (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-localizacao.mjs
//
// A queixa: *"o cliente envia localização para o consultor, mas não aparece
// para o consultor, no chat-v2"*. O dado estava no banco desde a 0115 (§62) e
// chegava na thread; a bolha do v2 é que não sabia desenhá-lo, então o que
// aparecia era o texto cru — e para um pino sem nome isso é um par de
// coordenadas, ilegível e sem nada em que tocar.
//
// A prova monta os dois casos na conversa de ENSAIO — o pino com nome e o pino
// pelado — e confere na tela. Tudo o que escreve é apagado no fim.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const MARCA = `prova-localizacao.${Date.now()}`;

// ⚠️ a LINHA vem da própria conversa de ensaio: `filtroLinhas` esconde o que não
// está na seleção de `crm_config.linhas_visiveis`, e com o id errado a mensagem
// some da thread e a prova acusa um defeito que não existe
const { data: ref } = await sb.from("mensagens")
  .select("linha_id").eq("cliente_id", ENSAIO).not("linha_id", "is", null).limit(1).maybeSingle();
const LINHA = ref?.linha_id ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
if (!LINHA) { console.log("❌ a conversa de ensaio não existe — rode ensaio.mjs criar"); process.exit(1); }

const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const COM_NOME = { lat: -1.406155, lng: -48.428443, nome: "Salão da prova", endereco: "Rua de Ensaio, 297", url: null };
const PELADO = { lat: -1.3774588, lng: -48.3543379, nome: null, endereco: null, url: null };

const chrome = await subirChrome({ porta: 9521 });
try {
  const agora = Date.now();
  await sb.from("mensagens").upsert([
    {
      id: `${MARCA}.a`, cliente_id: ENSAIO, enviada_por: "customer", tipo: "mensagem",
      // o mesmo texto que o webhook grava hoje (§62.2): é ele que aparecia sozinho
      conteudo: `📍 ${COM_NOME.nome} — ${COM_NOME.endereco}`,
      status: "success", criada_em: new Date(agora - 2000).toISOString(),
      linha_id: LINHA, localizacao: COM_NOME,
    },
    {
      id: `${MARCA}.b`, cliente_id: ENSAIO, enviada_por: "customer", tipo: "mensagem",
      conteudo: `📍 ${PELADO.lat}, ${PELADO.lng}`,
      status: "success", criada_em: new Date(agora).toISOString(),
      linha_id: LINHA, localizacao: PELADO,
    },
  ], { onConflict: "id" });

  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 3000 });
  await a.ate(`document.querySelector('textarea')`, { ms: 25_000 });
  const achou = await a.ate(
    `[...document.querySelectorAll('a')].some(x => /maps/.test(x.getAttribute('href')||''))`,
    { ms: 25_000 },
  );

  const cartoes = await a.js(`
    return [...document.querySelectorAll('a')]
      .filter(x => /maps/.test(x.getAttribute('href')||''))
      .map(x => ({ href: x.getAttribute('href'), texto: (x.textContent||'').trim() }));`);

  conferir(achou && cartoes.length >= 2, "os dois pinos viraram cartão com link de mapa", `${cartoes.length} cartões`);
  conferir(
    cartoes.some((c) => c.texto.includes("Salão da prova") && c.texto.includes("Rua de Ensaio")),
    "o pino COM nome mostra o nome e o endereço",
    cartoes.map((c) => c.texto).join(" | "),
  );
  conferir(
    cartoes.some((c) => /-1\.37746/.test(c.texto)),
    "o pino SEM nome mostra as coordenadas — que aí são a informação, não um rótulo feio",
  );
  conferir(
    cartoes.every((c) => /abrir no mapa/i.test(c.texto)),
    "…e os dois dizem o que o toque faz",
  );
  conferir(
    cartoes.every((c) => /[-0-9.]+,[-0-9.]+/.test(c.href)),
    "o link leva às coordenadas de verdade",
    cartoes[0]?.href ?? "",
  );

  // o texto cru não pode ficar SOBRANDO ao lado do cartão: seria a mesma coisa
  // duas vezes, e foi por isso que a §62.2 tirou o texto da bolha
  const cru = await a.js(`
    return [...document.querySelectorAll('span')]
      .filter(s => s.children.length === 0 && /^📍\s*-?\d/.test((s.textContent||'').trim())).length;`);
  conferir(cru === 0, "o texto cru não aparece ao lado do cartão", `${cru} sobras`);

  // ---- a MINIATURA do mapa (pedido do dono, 28/09) ----------------------
  const mapa = await a.js(`
    const cartoes = [...document.querySelectorAll('a')].filter(x => /maps/.test(x.getAttribute('href')||''));
    const c = cartoes[0];
    if (!c) return null;
    const janela = c.querySelector('span.relative.block');
    const imgs = [...c.querySelectorAll('img')];
    const r = janela ? janela.getBoundingClientRect() : null;
    // a janela está COBERTA pelos ladrilhos? (sem buraco branco na miniatura)
    const cobre = (px, py) => imgs.some(i => {
      const b = i.getBoundingClientRect();
      return px >= b.left && px < b.right && py >= b.top && py < b.bottom;
    });
    const cantos = r ? [[r.left+1,r.top+1],[r.right-1,r.top+1],[r.left+1,r.bottom-1],[r.right-1,r.bottom-1]] : [];
    return {
      ladrilhos: imgs.length,
      lazy: imgs.every(i => i.getAttribute('loading') === 'lazy'),
      pelaNossaRota: imgs.every(i => (i.getAttribute('src')||'').startsWith('/api/chat/mapa?')),
      carregados: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      altura: r ? Math.round(r.height) : 0,
      descobertos: cantos.filter(([x,y]) => !cobre(x,y)).length,
      atribuicao: /OpenStreetMap/.test(c.textContent || ''),
    };`);

  conferir(mapa && mapa.ladrilhos === 4, "a miniatura é um mosaico de 4 ladrilhos", `${mapa?.ladrilhos}`);
  conferir(
    mapa?.pelaNossaRota,
    "…servidos pela NOSSA rota, não pedidos do navegador ao OpenStreetMap",
  );
  conferir(mapa?.lazy, "…e só carregam quando a bolha entra na tela (lazy)");
  conferir(mapa?.carregados === 4, "os quatro chegaram de verdade", `${mapa?.carregados}/4`);
  conferir(
    mapa?.descobertos === 0,
    "a janela do mapa fica INTEIRA coberta — sem buraco branco no canto",
    `${mapa?.descobertos} cantos descobertos · ${mapa?.altura}px de altura`,
  );
  conferir(mapa?.atribuicao, "a atribuição do OpenStreetMap está na miniatura (é condição de uso)");

  await a.foto("localizacao-cartao");
  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  await sb.from("mensagens").delete().like("id", `${MARCA}%`);
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
