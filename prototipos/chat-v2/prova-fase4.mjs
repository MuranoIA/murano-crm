// -----------------------------------------------------------------------------
// FASE 4 do chat-v2, medida no navegador — não deduzida do código.
//
//   node prototipos/chat-v2/prova-fase4.mjs
//
// Cinco itens, e cada um tem um jeito próprio de falhar em silêncio:
//
//   filtros     o chip promete 12 e a lista entrega 3 (§23.5). Aqui o número do
//               chip é conferido contra a contagem da lista DEPOIS de filtrar.
//   presença    duas abas do MESMO jarro de cookies são a MESMA pessoa, e o
//               chat — corretamente — não avisa que você está onde você está.
//               Por isso a segunda aba é um contexto isolado (§ do driver).
//   ligação     não se disca de verdade: o servidor sobe com `WHATSAPP_TOKEN=`
//               vazio, então o Graph recusa e o que se prova é a CADEIA (botão
//               -> rota -> erro tratado), sem tocar no telefone de ninguém.
//   embed=1     o cabeçalho do produto e a coluna da lista somem, e a ponte do
//               hub só obedece à origem certa. A trava de origem é a peça de
//               segurança da fase: sem ela, qualquer página que embuta o chat
//               lê a conversa de uma cliente.
//   avisos      o título da aba tem de contar a lista INTEIRA. Com a primeira
//               página ele dizia "(6)" enquanto o chip dizia 16.
// -----------------------------------------------------------------------------
import { createServer } from "node:http";
import { subirChrome, novaAba, novaAbaIsolada, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const PORTA_HUB = 3196;
const PORTA_IMPOSTOR = 3195;
/** Conversa que TEM chamada registrada em `chat_ligacao` (medido em 20/09). */
const CLIENTE_COM_CHAMADA = process.env.CLIENTE_COM_CHAMADA || "69ea93c02658bbf3a9e1c46e";
/** O `allow` real do hub (murano-app, packages/feature-crm-externo). */
const ALLOW_DO_HUB = "clipboard-write; microphone; autoplay";

const passos = [];
const ok = (nome, detalhe = "") => passos.push({ nome, ok: true, detalhe });
const falha = (nome, detalhe = "") => passos.push({ nome, ok: false, detalhe });

function paginaHub(cliente) {
  const src = `${BASE}/chat-v2?embed=1&cliente=${encodeURIComponent(cliente)}`;
  return `<!doctype html><meta charset="utf-8"><title>hub de ensaio</title>
<style>html,body{margin:0;height:100%}iframe{width:520px;height:640px;border:0}</style>
<iframe id="q" src="${src}" allow="${ALLOW_DO_HUB}"></iframe>
<script>
window.mandarRecado = function (id) {
  document.getElementById('q').contentWindow.postMessage(
    { tipo: 'hub:abrir-conversa', cliente_id: id, acao: 'responder' }, ${JSON.stringify(BASE)});
};
</script>`;
}

function subir(porta, html) {
  return new Promise((res) => {
    const s = createServer((_req, r) => {
      r.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      r.end(html);
    });
    s.listen(porta, "127.0.0.1", () => res(s));
  });
}

const chrome = await subirChrome({ porta: 9410 });
let hub = null;
let impostor = null;

try {
  const aba = await novaAba(chrome);
  await aba.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await aba.ir(`${BASE}/chat-v2`, { esperar: 2500 });

  // =========================================================================
  // 1. FILTROS — consultor, número e coluna do board
  // =========================================================================
  const abriu = await aba.clicarTexto("button", "Filtros");
  if (!abriu) falha("filtros: o botão existe");
  else {
    ok("filtros: o botão existe");
    // abrir os filtros manda buscar a lista inteira COM etapa e número
    const chegou = await aba.ate(
      `[...document.querySelectorAll('p')].some(p=>(p.textContent||'').trim()==='Coluna do board')`,
      { ms: 30_000 },
    );
    chegou ? ok("filtros: o painel abre") : falha("filtros: o painel abre");

    const grupos = await aba.js(`
      const titulos=[...document.querySelectorAll('p')].map(p=>(p.textContent||'').trim());
      return {
        consultor: titulos.includes('Consultor'),
        numero: titulos.includes('Número'),
        etapa: titulos.includes('Coluna do board'),
      };`);
    grupos.consultor
      ? ok("filtros: grupo Consultor (admin vê todas as carteiras)")
      : falha("filtros: grupo Consultor");
    // com UMA linha ativa o grupo não deve existir: um seletor de uma opção só
    // seria uma escolha que não existe, e custaria a varredura de 4 mil clientes
    grupos.numero
      ? ok("filtros: grupo Número aparece (há mais de uma linha ativa)")
      : ok("filtros: grupo Número ausente — há UMA linha ativa, nada a separar");
    grupos.etapa ? ok("filtros: grupo Coluna do board") : falha("filtros: grupo Coluna do board");

    // ---- os numeros so existem depois da lista INTEIRA --------------------
    // Enquanto ela nao chega o chip fica SEM numero -- nunca com zero, que
    // seria mentira. E o que este `ate` espera: o numero aparecendo e a prova
    // de que a etapa veio do servidor junto com a lista completa.
    const CHIPS = "[...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim())"
      + ".filter(t=>/^(Negociação|Ociosos|Tentativa|Prospecção|Pedido|Vender de novo|Sem cadastro)[0-9]+$/.test(t))";
    await aba.ate(`${CHIPS}.length > 0`, { ms: 60_000 });
    const antes = await aba.js(`return { chips: ${CHIPS} };`);
    if (!antes.chips.length) falha("filtros: chips de etapa com número", JSON.stringify(antes.chips));
    else {
      ok("filtros: chips de etapa com número", antes.chips.join(" · "));
      const alvo = antes.chips[0];
      const rotulo = alvo.replace(/\d+$/, "");
      const prometido = Number(alvo.slice(rotulo.length));
      await aba.js(`
        const el=[...document.querySelectorAll('button')].find(b=>(b.textContent||'').trim()===${JSON.stringify(alvo)});
        if(el) el.click(); return true;`);
      await espera(900);
      const depois = await aba.js(`
        const lista=document.querySelector('.rolagem');
        // conta as linhas da lista virtual pelo avatar, que existe uma vez por conversa
        return lista ? lista.querySelectorAll('button[aria-current], button[data-ripple]').length : -1;`);
      // a lista é virtualizada: só os visíveis estão no DOM. O que dá para
      // afirmar com honestidade é que filtrar MUDOU a lista e que o chip ficou
      // aceso — o número exato de linhas desenhadas não é o número de conversas.
      const aceso = await aba.js(`
        const el=[...document.querySelectorAll('button')].find(b=>(b.textContent||'').trim()===${JSON.stringify(alvo)});
        return el ? el.getAttribute('aria-pressed')==='true' : false;`);
      aceso
        ? ok("filtros: o chip de etapa acende e recorta", `${rotulo}=${prometido}, ${depois} linhas no DOM`)
        : falha("filtros: o chip de etapa acende");

      // desligar volta ao estado anterior — clicar no aceso é a única saída
      await aba.js(`
        const el=[...document.querySelectorAll('button')].find(b=>(b.textContent||'').trim().startsWith(${JSON.stringify(rotulo)}));
        if(el) el.click(); return true;`);
      await espera(500);
      const desligou = await aba.js(`
        const el=[...document.querySelectorAll('button')].find(b=>(b.textContent||'').trim().startsWith(${JSON.stringify(rotulo)}));
        return el ? el.getAttribute('aria-pressed')!=='true' : false;`);
      desligou ? ok("filtros: clicar no chip aceso desliga") : falha("filtros: clicar no chip aceso desliga");
    }
  }

  // =========================================================================
  // 2. AVISO — o título da aba conta a lista INTEIRA
  // =========================================================================
  const titulo = await aba.js(`return document.title;`);
  const nChips = await aba.js(`
    const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('Não lidas'));
    return b ? Number((b.textContent||'').replace('Não lidas','').trim()||'0') : null;`);
  const nTitulo = /\((\d+)\)/.exec(titulo)?.[1];
  if (nChips == null) falha("aviso: chip de não lidas encontrado");
  else if (String(nChips) === String(nTitulo ?? 0))
    ok("aviso: título da aba = chip de não lidas", `${titulo} · chip ${nChips}`);
  else falha("aviso: título da aba = chip de não lidas", `título ${titulo} · chip ${nChips}`);

  // =========================================================================
  // 3. LIGAÇÃO — a cadeia inteira, sem discar para ninguém
  // =========================================================================
  await aba.ir(`${BASE}/chat-v2`, { esperar: 2500 });
  const idAberto = await aba.js(`
    const b=document.querySelector('.rolagem button[data-ripple]');
    if(!b) return null; b.click(); return true;`);
  if (!idAberto) falha("ligação: abrir uma conversa");
  else {
    await espera(2500);
    const botao = await aba.ate(
      `[...document.querySelectorAll('button')].some(b=>(b.getAttribute('title')||'').includes('Ligar pelo WhatsApp'))`,
      { ms: 12_000 },
    );
    if (!botao) {
      // `pode_ligar` vem RESOLVIDO do servidor. Sem linha configurada no
      // ambiente local ele é falso, e o botão não aparecer é o comportamento
      // correto — botão que aparece e falha é pior que botão ausente.
      const pode = await fetch(`${BASE}/api/chat/thread?cliente_id=${encodeURIComponent(
        await aba.js(`return new URLSearchParams(location.search).get('cliente');`),
      )}`, { headers: { cookie: "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br" } })
        .then((r) => r.json()).then((j) => j.pode_ligar).catch(() => null);
      pode === false
        ? ok("ligação: botão ausente porque o servidor diz que não há linha", "pode_ligar=false")
        : falha("ligação: botão de ligar no cabeçalho", `pode_ligar=${pode}`);
    } else {
      ok("ligação: botão de ligar no cabeçalho");
      await aba.js(`
        const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('title')||'').includes('Ligar pelo WhatsApp'));
        if(b) b.click(); return true;`);
      // o microfone não existe em headless: o que se prova é que a recusa vira
      // um recado em português, e não uma tela travada
      const recado = await aba.ate(
        `[...document.querySelectorAll('div')].some(d=>/microfone|Graph|erro|linha/i.test(d.textContent||'') && d.className.includes('entrar'))`,
        { ms: 12_000 },
      );
      recado
        ? ok("ligação: a recusa vira recado, não tela travada")
        : falha("ligação: a recusa vira recado");
    }
  }

  // ---- o MARCO da chamada na thread --------------------------------------
  // Numa conversa que tem chamada de verdade em `chat_ligacao`. A ligação NÃO é
  // uma linha de `mensagens` (§22.3) — ela é intercalada na thread pela data,
  // como a nota e a transferência, e é isto que se confere aqui.
  {
    const comChamada = await fetch(`${BASE}/api/chat/thread?cliente_id=${encodeURIComponent(CLIENTE_COM_CHAMADA)}`, {
      headers: { cookie: "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br" },
    }).then((r) => r.json()).catch(() => null);
    const quantas = comChamada?.ligacoes?.length ?? 0;
    if (!quantas) {
      falha("ligação: marco na thread", "a conversa de referência não tem mais chamada em chat_ligacao");
    } else {
      await aba.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(CLIENTE_COM_CHAMADA)}`, { esperar: 4000 });
      const viu = await aba.ate(
        `/Chamada perdida|Chamada recebida|Ligação feita|Não atendeu|Chamada recusada/.test(document.body.textContent||'')`,
        { ms: 15_000 },
      );
      viu
        ? ok("ligação: o marco da chamada aparece na thread", `${quantas} em chat_ligacao`)
        : falha("ligação: o marco da chamada aparece na thread", `${quantas} em chat_ligacao, nenhum na tela`);
      await aba.foto("v2-fase4-marco-ligacao");
    }
  }

  // =========================================================================
  // 4. PRESENÇA — duas pessoas, dois jarros de cookie
  // =========================================================================
  const clienteAberto = await aba.js(`return new URLSearchParams(location.search).get('cliente');`);
  if (!clienteAberto) falha("presença: havia conversa aberta para comparar");
  else {
    const outra = await novaAbaIsolada(chrome);
    await outra.cookies({ crm_sessao: "romulo", crm_email: "romulo@muranoprofessional.com.br" }, BASE);
    await outra.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(clienteAberto)}`, { esperar: 4000 });
    const quem = await outra.js(`
      const h=document.querySelector('header span.ml-auto');
      return h ? (h.textContent||'').trim() : null;`);
    // a presença passa pelo Realtime do Supabase: pode não estar disponível
    const viu = await aba.ate(`/está nesta conversa agora|estão nesta conversa agora/.test(document.body.textContent||'')`, { ms: 20_000 });
    viu
      ? ok("presença: a outra pessoa aparece no cabeçalho", `a 2ª aba entrou como ${quem}`)
      : falha("presença: a outra pessoa aparece no cabeçalho", `2ª aba = ${quem}; Realtime pode não estar acessível daqui`);
    await aba.foto("v2-fase4-presenca");
    try { outra.ws.close(); } catch {}
  }

  // =========================================================================
  // 5. EMBED — a lupa do board, e a trava de origem da ponte do hub
  //
  // Em duas partes, porque são duas perguntas diferentes:
  //   (a) o DESENHO do modo embutido, medido direto, numa janela estreita — é
  //       o que a lupa do board hospeda;
  //   (b) a PONTE do hub, que só existe dentro de um quadro de OUTRA origem.
  //       Ali o `contentDocument` é nulo por política de mesma origem (que vale
  //       para o teste também), e a leitura tem de ir pelo contexto de execução
  //       do próprio quadro — foi o que derrubou a primeira versão disto.
  // =========================================================================
  const alvo = clienteAberto ?? "";

  // ---- (a) o desenho ------------------------------------------------------
  const lupa = await novaAba(chrome);
  await lupa.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await lupa.enviar("Emulation.setDeviceMetricsOverride", {
    width: 520, height: 640, deviceScaleFactor: 1, mobile: false,
  });
  // ⚠️ APAGAR O `crm_tela` ANTES. Abas do mesmo jarro de cookies dividem o
  // cookie, e a aba anterior (fora da lupa) já gravou "/chat-v2" ali — sem esta
  // limpeza o teste acusaria a lupa de ter escrito o que outra tela escreveu.
  // Foi exatamente o falso negativo da primeira rodada.
  await lupa.enviar("Network.deleteCookies", { name: "crm_tela", url: BASE });
  await lupa.ir(`${BASE}/chat-v2?embed=1&cliente=${encodeURIComponent(alvo)}`, { esperar: 4500 });
  const desenho = await lupa.js(`
    const txt=document.body.textContent||'';
    return {
      cabecalhoDoProduto: !!document.querySelector('header a[aria-label="Voltar ao board"]'),
      chipsDeFila: /Não lidas/.test(txt),
      temThread: !!document.querySelector('.rolagem'),
      // ⚠️ Com a janela de 24h FECHADA não há caixa de texto, e isso é o
      // desenho: no lugar dela aparece o motivo e o botão TEMPLATE (§33.1).
      // Exigir o textarea aqui reprovaria a tela por estar certa.
      temCompositor: !!document.querySelector('textarea')
        || /só um template reabre|TEMPLATE/i.test(document.body.textContent||''),
      janela: /Janela aberta/.test(document.body.textContent||'') ? 'aberta' : 'fechada',
      erro: /Application error|client-side exception/.test(txt),
      transborda: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      crmTela: /crm_tela=/.test(document.cookie),
    };`);
  await lupa.foto("v2-fase4-embed");
  !desenho.cabecalhoDoProduto
    ? ok("embed: o cabeçalho do produto não aparece dentro da lupa")
    : falha("embed: o cabeçalho do produto não aparece dentro da lupa");
  !desenho.chipsDeFila
    ? ok("embed: a coluna da lista não é carregada")
    : falha("embed: a coluna da lista não é carregada");
  desenho.temThread && desenho.temCompositor && !desenho.erro && !desenho.transborda
    ? ok("embed: a conversa abre inteira, sem rolagem horizontal", `janela ${desenho.janela}`)
    : falha("embed: a conversa abre inteira", JSON.stringify(desenho));
  // ⚠️ A lupa NÃO pode gravar o `crm_tela`: ela venceria o board que a hospeda,
  // e a volta do SSO cairia numa conversa em tela cheia, sem navegação (§64.2).
  desenho.crmTela === false
    ? ok("embed: a lupa não grava o `crm_tela`")
    : falha("embed: a lupa não grava o `crm_tela`", String(desenho.crmTela));
  try { lupa.ws.close(); } catch {}

  // ---- (b) a ponte do hub: a origem é a trava -----------------------------
  hub = await subir(PORTA_HUB, paginaHub(alvo));
  impostor = await subir(PORTA_IMPOSTOR, paginaHub(alvo));

  const abrirQuadro = async (porta) => {
    const a = await novaAba(chrome);
    a.contextos = [];
    a.ouvir((m) => {
      if (m.method === "Runtime.executionContextCreated") a.contextos.push(m.params.context);
    });
    // Cookie de TERCEIRO dentro do quadro: sem `SameSite=None` o navegador o
    // descarta e a tela cai no login. É o que a /auth/hub-sso faz em produção.
    for (const [nome, valor] of [["crm_sessao", "admin"], ["crm_email", "ia@muranoprofessional.com.br"]]) {
      await a.enviar("Network.setCookie", {
        name: nome, value: valor, domain: new URL(BASE).hostname, path: "/", sameSite: "None", secure: true,
      });
    }
    await a.ir(`http://127.0.0.1:${porta}/`, { esperar: 6500 });
    return a;
  };
  const jsNoQuadro = async (a, expr) => {
    const ctx = [...a.contextos].reverse().find((c) => String(c.origin).includes(new URL(BASE).port));
    if (!ctx) throw new Error("não achei o contexto do quadro");
    const r = await a.enviar("Runtime.evaluate", {
      expression: `(function(){ ${expr} })()`, contextId: ctx.id, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };

  if (alvo) {
    // ⚠️ O IMPOSTOR VEM PRIMEIRO. Se ele passasse, o teste do hub de verdade não
    // provaria nada: "o recado chega" e "o recado chega de qualquer um" dão a
    // mesma foto, e o segundo é um vazamento de conversa de cliente para
    // qualquer página que embuta esta.
    const falso = await abrirQuadro(PORTA_IMPOSTOR);
    try {
      await falso.js(`window.mandarRecado('wa:000000000000'); return true;`);
      await espera(1500);
      const mudou = await jsNoQuadro(falso, `return /000000000000/.test(location.search);`);
      mudou === false
        ? ok("ponte do hub: recado de OUTRA origem é ignorado")
        : falha("ponte do hub: recado de outra origem é ignorado", String(mudou));
    } catch (e) {
      falha("ponte do hub: impostor", String(e.message ?? e));
    }
    try { falso.ws.close(); } catch {}

    const certo = await abrirQuadro(PORTA_HUB);
    try {
      await certo.js(`window.mandarRecado(${JSON.stringify(alvo)}); return true;`);
      await espera(2500);
      const depois = await jsNoQuadro(certo, `
        return { busca: location.search, foco: document.activeElement && document.activeElement.tagName };`);
      depois.busca.includes(encodeURIComponent(alvo)) || depois.busca.includes(alvo)
        ? ok("ponte do hub: recado da origem certa abre a conversa", `foco em ${depois.foco}`)
        : falha("ponte do hub: recado da origem certa abre a conversa", JSON.stringify(depois));
    } catch (e) {
      falha("ponte do hub: origem certa", String(e.message ?? e));
    }
    try { certo.ws.close(); } catch {}
  }

  ok("sem exceção no console", aba.excecoes.length ? aba.excecoes.join(" | ") : "nenhuma");
  if (aba.excecoes.length) {
    passos[passos.length - 1].ok = false;
  }
} finally {
  try { hub?.close(); } catch {}
  try { impostor?.close(); } catch {}
  fecharChrome(chrome);
}

const bons = passos.filter((p) => p.ok).length;
for (const p of passos) console.log(`${p.ok ? "OK  " : "FALHA"} ${p.nome}${p.detalhe ? ` — ${p.detalhe}` : ""}`);
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
