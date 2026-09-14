// -----------------------------------------------------------------------------
// CICLO 11 — o chat DENTRO do iframe do hub, com duas pessoas ao mesmo tempo.
//
// Por que este ciclo existe separado do 10: o ciclo 10 mede o servidor, e o
// servidor não sabe que está sendo embutido. Tudo o que quebra por causa do
// iframe quebra SÓ no navegador, e quase sempre em silêncio:
//
//   · o cookie de sessão é de TERCEIRO ali dentro. Sem `SameSite=None; Secure`
//     o navegador o descarta e o consultor cai na tela de login (§17).
//   · `microphone` em iframe cross-origin tem padrão `self`. Sem o hub delegar,
//     `getUserMedia` é recusado com NotAllowedError E SEM PROMPT — e o áudio,
//     que é metade do atendimento de salão, morre sem nada no cadeado para o
//     usuário liberar (§22.5). Esta armadilha já custou uma hora uma vez.
//
// O host aqui é um servidor de 30 linhas noutra porta: `127.0.0.1:3199` é
// origem DIFERENTE de `localhost:3100`, que é exatamente a relação entre
// app.muranoprofessional.com.br e crm.muranoprofessional.com.br.
// -----------------------------------------------------------------------------
import { createServer } from "node:http";
import * as sim from "../simulacao.mjs";
import { espera } from "../ajuda.mjs";

export const ciclo = "ciclo11 — chat embutido no iframe do hub";

const PORTA_HOST = 3199;
/**
 * O impostor: mesma pagina, OUTRA porta — e porta diferente ja e outra origem.
 * Existe para provar que a trava de `event.origin` da ponte morde. Sem ele o
 * teste da ponte so provaria que o recado CHEGA, e "chega de qualquer um" seria
 * um vazamento de conversa de cliente para qualquer pagina que embutisse o
 * Pulse.
 */
const PORTA_IMPOSTOR = 3198;
/** O `allow` real do hub (murano-app/src/app/crm-externo/page.tsx). */
const ALLOW_DO_HUB = "clipboard-write; microphone; autoplay";

function paginaHost(allow, cliente) {
  const src = `http://localhost:3100/chat?embed=1${cliente ? `&cliente=${encodeURIComponent(cliente)}` : ""}`;
  return `<!doctype html><meta charset="utf-8"><title>hub de ensaio</title>
<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style>
<iframe id="q" src="${src}"${allow ? ` allow="${allow}"` : ""}></iframe>
<script>
// O que o service worker do hub faz ao clicar em "Responder" (0134/0135): posta
// no quadro pedindo a conversa. Aqui e a pagina que posta, porque o efeito
// medido e o mesmo — o Pulse nao sabe (nem pode saber) se o recado nasceu no
// worker ou na pagina; ele so ve a ORIGEM.
window.mandarRecado = function (id) {
  document.getElementById('q').contentWindow.postMessage(
    { tipo: 'hub:abrir-conversa', cliente_id: id, acao: 'responder' },
    'http://localhost:3100');
};
</script>`;
}

/**
 * Sobe o "hub" falso. `?cliente=` é REPASSADO para dentro do quadro — sem isso
 * o parâmetro fica no host e o iframe abre a lista, não a conversa. (Foi o que
 * derrubou a primeira versão do passo de tempo real.)
 */
function subirHost() {
  return new Promise((res) => {
    const s = createServer((req, r) => {
      const u = new URL(req.url, `http://127.0.0.1:${PORTA_HOST}`);
      r.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      r.end(paginaHost(u.pathname.startsWith("/sem-allow") ? null : ALLOW_DO_HUB, u.searchParams.get("cliente")));
    });
    s.listen(PORTA_HOST, "127.0.0.1", () => res(s));
  });
}

/** O mesmo host, noutra porta: outra origem, mesmo recado. */
function subirImpostor() {
  return new Promise((res) => {
    const s = createServer((_req, r) => {
      r.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      r.end(paginaHost(ALLOW_DO_HUB, null));
    });
    s.listen(PORTA_IMPOSTOR, "127.0.0.1", () => res(s));
  });
}

/**
 * Avalia JS DENTRO do iframe.
 *
 * O `Runtime.evaluate` normal roda no frame de topo, e o de topo não alcança um
 * iframe de outra origem — é a política de mesma origem, e ela vale para o
 * teste também. O caminho é achar o contexto de execução do próprio iframe
 * (pelo `origin`) e avaliar lá dentro.
 */
async function jsNoQuadro(aba, expr) {
  const ctx = aba.contextosDoQuadro?.find((c) => String(c.origin).includes("3100"));
  if (!ctx) throw new Error("não achei o contexto do iframe (o quadro carregou?)");
  const r = await aba.enviar("Runtime.evaluate", {
    expression: `(function(){ ${expr} })()`,
    contextId: ctx.id, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(`js no quadro: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result?.value;
}

/** Abre uma aba isolada, guarda os contextos e carrega o hub falso. */
async function abrirHub(t, sessao, caminho = "/", porta = PORTA_HOST) {
  const aba = await t.abaIsolada();
  aba.contextosDoQuadro = [];
  aba.ouvir((m) => {
    if (m.method === "Runtime.executionContextCreated") aba.contextosDoQuadro.push(m.params.context);
  });
  // Cookie de TERCEIRO: precisa de SameSite=None + Secure, senão o navegador o
  // descarta dentro do quadro. É o que a rota /auth/hub-sso faz em produção.
  for (const [nome, valor] of Object.entries(sessao)) {
    await aba.enviar("Network.setCookie", {
      name: nome, value: String(valor), domain: "localhost", path: "/",
      sameSite: "None", secure: true,
    });
  }
  await aba.ir(`http://127.0.0.1:${porta}${caminho}`, { esperar: 6000 });
  return aba;
}

export default async function (t) {
  if (!t.servidorNoAr) return t.pular("ciclo 11 inteiro", "✅", "servidor fora do ar");

  let host = null;
  let impostor = null;
  const abas = [];
  const cliente = { i: 700, id: sim.idFicticio(700) };

  try {
    await t.passo("preparação: hub falso no ar e uma conversa para olhar", "✅", async () => {
      try { host = await subirHost(); } catch (e) { throw new Error(`PULAR:não subi o host: ${e.message}`); }
      try { impostor = await subirImpostor(); } catch (e) { throw new Error(`PULAR:não subi o impostor: ${e.message}`); }
      const r = await sim.clienteEscreve(cliente.i, "Oi! Vim pelo Instagram, queria saber sobre a progressiva.");
      if (r.status !== 200) throw new Error(`webhook devolveu ${r.status}`);
      return `host em 127.0.0.1:${PORTA_HOST}, conversa ${cliente.id} criada`;
    });

    await t.passo("o chat CARREGA dentro do iframe, com a sessão valendo", "✅", async () => {
      const aba = await abrirHub(t, { crm_sessao: "admin", crm_email: "romuloalbuquerque@muranoprofessional.com.br" });
      abas.push(aba);
      const dentro = await jsNoQuadro(aba, `
        return {
          url: location.pathname + location.search,
          cookie: document.cookie.includes('crm_sessao'),
          html: document.body ? document.body.innerHTML.length : 0,
          // "entrar com google" na tela = o cookie nao chegou e caiu no login
          login: /Entrar com Google|entrar com google/i.test(document.body?.textContent || ''),
          conversas: document.querySelectorAll('[data-conversa], li, [role="listitem"]').length,
        };`);
      await aba.foto("ciclo11-iframe-chat");
      if (dentro.login) throw new Error("o quadro caiu na TELA DE LOGIN — o cookie de terceiro foi descartado");
      if (!dentro.cookie) throw new Error("document.cookie sem crm_sessao dentro do quadro (cookie de terceiro bloqueado)");
      if (!dentro.html) throw new Error("o quadro carregou vazio");
      if (aba.excecoes.length) throw new Error(`exceções no navegador: ${aba.excecoes.slice(0, 2).join(" | ")}`);
      return `${dentro.url} · ${dentro.html} bytes de HTML · sessão viva · 0 exceção`;
    });

    await t.passo("MICROFONE: com o `allow` do hub, a permissão é delegada ao quadro", "✅", async () => {
      const aba = abas[0];
      const p = await jsNoQuadro(aba, `
        const pp = document.permissionsPolicy || document.featurePolicy;
        return {
          temApi: !!pp,
          microfone: pp ? pp.allowsFeature('microphone') : null,
          autoplay: pp ? pp.allowsFeature('autoplay') : null,
          gum: typeof navigator.mediaDevices?.getUserMedia === 'function',
        };`);
      if (!p.temApi) throw new Error("PULAR:este Chrome não expõe permissionsPolicy");
      if (p.microfone !== true) {
        throw new Error("microfone NÃO delegado mesmo com o allow do hub — gravar áudio falharia com NotAllowedError e SEM prompt (§22.5)");
      }
      if (!p.gum) throw new Error("getUserMedia indisponível dentro do quadro");
      return `microphone=${p.microfone} · autoplay=${p.autoplay} · getUserMedia presente`;
    });

    await t.passo("MICROFONE: sem o `allow`, o quadro fica mudo — e é assim que se reconhece o sintoma", "✅", async () => {
      const aba = await abrirHub(t, { crm_sessao: "admin", crm_email: "romuloalbuquerque@muranoprofessional.com.br" }, "/sem-allow");
      abas.push(aba);
      const p = await jsNoQuadro(aba, `
        const pp = document.permissionsPolicy || document.featurePolicy;
        return pp ? pp.allowsFeature('microphone') : null;`);
      if (p !== false) {
        throw new Error(`sem o allow esperava microphone=false, obtive ${p} — o teste do passo anterior não prova nada`);
      }
      return "sem allow => microphone=false. Confirma que quem concede é o HUB, não o CRM (§22.5)";
    });

    await t.passo("DUAS pessoas em quadros separados: cada uma com a sua sessão", "✅", async () => {
      const b = await abrirHub(t, { crm_sessao: "anne", crm_email: "anne@muranoprofessional.com.br" });
      abas.push(b);
      const quem = await jsNoQuadro(b, `return document.cookie.match(/crm_sessao=([^;]+)/)?.[1] ?? null;`);
      const quemA = await jsNoQuadro(abas[0], `return document.cookie.match(/crm_sessao=([^;]+)/)?.[1] ?? null;`);
      await b.foto("ciclo11-iframe-segunda-sessao");
      if (quem !== "anne" || quemA !== "admin") {
        throw new Error(`as sessões se misturaram: quadro 1 = ${quemA}, quadro 2 = ${quem} (jarro de cookies compartilhado)`);
      }
      return `quadro 1 = ${quemA}, quadro 2 = ${quem} — sessões independentes`;
    });

    await t.passo("TEMPO REAL: mensagem nova aparece na CONVERSA ABERTA sem recarregar", "⚠️", async () => {
      // ⚠️ A primeira versão deste passo olhava a lista lateral e reprovou. Era
      // erro do teste, não do app: conversa sem dono nasce na aba "Fila de
      // espera", que NÃO é a aba padrão — o texto não estava no DOM porque
      // aquela aba não estava desenhada. Aqui a conversa é aberta de propósito
      // (`?cliente=`), que é a situação que importa: a consultora está com a
      // conversa na tela e a cliente escreve.
      const aba = await abrirHub(t, { crm_sessao: "admin", crm_email: "romuloalbuquerque@muranoprofessional.com.br" },
        `/?cliente=${encodeURIComponent(cliente.id)}`);
      abas.push(aba);

      const abriu = await jsNoQuadro(aba, `
        return { url: location.search, tem: (document.body.textContent||'').includes('progressiva') };`);
      if (!abriu.tem) {
        await aba.foto("ciclo11-thread-nao-abriu");
        throw new Error(`a thread não abriu no quadro (${abriu.url}) — sem ela o teste de tempo real não mede nada`);
      }

      const marca = `chegou-agora-${Date.now().toString().slice(-6)}`;
      await sim.clienteEscreve(cliente.i, `Mensagem de tempo real: ${marca}`);

      // Realtime primeiro; o poll de 60s é a rede de proteção (§15.4). 75s cobre
      // os dois, e o detalhe distingue um do outro — "chegou em 3s" e "chegou em
      // 62s" são diagnósticos diferentes, não o mesmo "passou".
      const t0 = Date.now();
      let apareceu = false;
      while (Date.now() - t0 < 75_000) {
        apareceu = await jsNoQuadro(aba, `return (document.body.textContent||'').includes(${JSON.stringify(marca)});`);
        if (apareceu) break;
        await espera(1500);
      }
      const seg = Number(((Date.now() - t0) / 1000).toFixed(1));
      await aba.foto("ciclo11-tempo-real");
      if (!apareceu) throw new Error("a mensagem NÃO apareceu na conversa aberta em 75s — nem por Realtime nem pelo poll de 60s");
      return seg < 15
        ? `apareceu em ${seg}s — Realtime entregando dentro do iframe`
        : `apareceu em ${seg}s — veio pelo POLL de 60s, não pelo Realtime (a assinatura do canal não está entregando no quadro)`;
    });

    // ---- a ponte do push (0134/0135) ------------------------------------
    //
    // Em iframe cross-origin o navegador responde `Notification.permission =
    // "denied"` ANTES de qualquer pergunta (medido em 14/09/2026), então o push
    // do time teve de nascer no hub. O caminho de volta — "abra esta conversa"
    // — é `postMessage`, e é isto que estes dois passos medem.
    //
    // ⚠️ Os dois só rodam se o build tiver sido feito com a origem de ensaio.
    // `ORIGEM_HUB` é constante de build (lib/hub.ts): num build de produção o
    // Pulse recusa o recado do host de ensaio E ESTÁ CERTO — reprovar aqui
    // acusaria o produto de um defeito que é do ambiente do teste.
    const origemDeEnsaio = `http://127.0.0.1:${PORTA_HOST}`;
    const buildComEnsaio = (t.db.ENV.NEXT_PUBLIC_HUB_ORIGIN ?? "").trim() === origemDeEnsaio;
    const motivoPular = `o build precisa de NEXT_PUBLIC_HUB_ORIGIN=${origemDeEnsaio} (hoje: ${t.db.ENV.NEXT_PUBLIC_HUB_ORIGIN ?? "ausente"})`;

    await t.passo('o hub manda "abra esta conversa" e o quadro abre, com o cursor na caixa', "⚠️", async () => {
      if (!buildComEnsaio) throw new Error(`PULAR:${motivoPular}`);
      const aba = await abrirHub(t, { crm_sessao: "admin", crm_email: "romuloalbuquerque@muranoprofessional.com.br" });
      abas.push(aba);

      const antes = await jsNoQuadro(aba, "return !!document.querySelector('textarea');");
      if (antes) throw new Error("o quadro já tinha conversa aberta antes do recado — o passo não mediria nada");

      await aba.js(`window.mandarRecado(${JSON.stringify(cliente.id)}); return true;`);

      // ⚠️ A identidade se confere pelo CABEÇALHO, não pelo texto das
      // mensagens. A primeira versão deste passo procurava a palavra da
      // primeira mensagem e reprovou com a conversa CERTA na tela: o cabeçalho
      // pinta na hora e a thread ainda dizia "Carregando mensagens…". Era
      // asserção prematura, não defeito — e teria sido lida como defeito.
      const telefone = cliente.id.replace(/\D/g, "");
      let r = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 20_000) {
        r = await jsNoQuadro(aba, `
          const ta = document.querySelector('textarea');
          return { compositor: !!ta, foco: !!ta && document.activeElement === ta,
                   certa: (document.body.textContent||'').includes(${JSON.stringify(telefone)}) };`);
        if (r?.compositor && r?.foco && r?.certa) break;
        await espera(500);
      }
      await aba.foto("ciclo11-ponte-push");
      if (!r?.compositor) throw new Error("o recado do hub não abriu conversa nenhuma no quadro");
      if (!r?.certa) throw new Error("abriu uma conversa, mas NÃO a que o recado pediu");
      // O botão promete "Responder": sem o foco, quem clicou ainda precisa
      // procurar a caixa — que é justamente o passo que a notificação existe
      // para poupar.
      if (!r?.foco) throw new Error("a conversa abriu mas o cursor NÃO ficou na caixa de mensagem");
      return "conversa certa aberta e cursor na caixa";
    });

    await t.passo("uma página de OUTRA origem manda o mesmo recado e não acontece nada", "⚠️", async () => {
      if (!buildComEnsaio) throw new Error(`PULAR:${motivoPular}`);
      const aba = await abrirHub(t, { crm_sessao: "admin", crm_email: "romuloalbuquerque@muranoprofessional.com.br" },
        "/", PORTA_IMPOSTOR);
      abas.push(aba);

      await aba.js(`window.mandarRecado(${JSON.stringify(cliente.id)}); return true;`);
      await espera(4000);

      const r = await jsNoQuadro(aba, "return { compositor: !!document.querySelector('textarea') };");
      await aba.foto("ciclo11-ponte-impostor");
      if (r?.compositor) {
        throw new Error("uma página de outra origem abriu a conversa de uma cliente — a trava de event.origin não está mordendo");
      }
      return `recado de 127.0.0.1:${PORTA_IMPOSTOR} ignorado, como tem de ser`;
    });

    await t.passo("nenhuma exceção de JavaScript em nenhum dos quadros", "✅", async () => {
      const ruins = abas.flatMap((a, i) => a.excecoes.map((e) => `quadro ${i + 1}: ${e.slice(0, 200)}`));
      if (ruins.length) throw new Error(ruins.slice(0, 4).join("\n"));
      const erros = abas.flatMap((a, i) => a.console.filter((c) => c.startsWith("error")).map((c) => `quadro ${i + 1}: ${c.slice(0, 160)}`));
      return erros.length ? `0 exceção; ${erros.length} erro(s) de console: ${erros.slice(0, 3).join(" | ")}` : "0 exceção, 0 erro de console";
    });
  } finally {
    // a conversa de ensaio sai junto com o resto no ciclo 10; aqui garante-se
    // que ela some mesmo se este ciclo rodar sozinho
    t.db.anotarRastro(`conversa do ciclo 11 (${cliente.id})`, async (c) => {
      for (const tab of ["chat_nota", "chat_transferencia", "chat_leitura", "chat_conversa", "mensagens"]) {
        await c.from(tab).delete().eq("cliente_id", cliente.id);
      }
      await c.from("clientes").delete().eq("id", cliente.id);
    });
    if (host) try { host.close(); } catch { /* já foi */ }
    if (impostor) try { impostor.close(); } catch { /* já foi */ }
  }
}
