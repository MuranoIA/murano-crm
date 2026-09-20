// -----------------------------------------------------------------------------
// O BUG RELATADO PELOS VENDEDORES: resolvo a conversa e, alguns segundos depois,
// ela reaparece em "Meus atendimentos".
//
//   node prototipos/chat-v2/prova-resolver-volta.mjs [--tela /chat-v2|/chat]
//
// A HIPÓTESE que este teste mede: NÃO é o banco que volta atrás — é a TELA.
// Uma recarga da lista que SAIU antes do "resolver" chega depois dele e
// sobrescreve o estado com a foto antiga. O banco continua certo, e é por isso
// que ninguém acha nada olhando o `chat_conversa`.
//
// Medido em produção antes de escrever isto: nas 15 vezes em que alguém
// resolveu a MESMA conversa de novo em menos de 30 s, o webhook não tocou em
// nenhuma mensagem daquele cliente no intervalo. Ou seja, não houve reabertura
// no banco — houve reabertura NA TELA.
//
// A prova precisa das duas metades, senão não prova nada:
//   1. a tela volta ao estado anterior (o sintoma);
//   2. o SERVIDOR, perguntado no mesmo instante, responde "resolvida" (a prova
//      de que o dado está certo e quem mente é a tela).
//
// A sequência reproduzida é a do dia a dia: responder a cliente e, logo em
// seguida, encerrar. É o envio que deixa uma recarga de lista em voo.
//
// ⚠️ Nada sai para cliente nenhuma: o servidor sobe com `SIMULACAO_ENVIO=1` e a
// conversa é a de ensaio. O status é devolvido a "aberta" no fim.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const arg = (n, p) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : p; };
const TELA = arg("--tela", "/chat-v2");
const ROTA_LISTA = TELA === "/chat" ? "/api/chat" : "/api/chat-v2/lista";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const COOKIE = "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br";

const passos = [];
const ok = (n, d = "") => passos.push({ n, ok: true, d });
const falha = (n, d = "") => passos.push({ n, ok: false, d });

const mandarStatus = (status) =>
  fetch(`${BASE}/api/chat/status`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: COOKIE },
    body: JSON.stringify({ cliente_id: ENSAIO, status }),
  }).catch(() => null);

/** O que o BANCO diz agora — a segunda metade da prova.
 *
 * ⚠️ NÃO dá para perguntar à lista: ela esconde a conversa de ensaio
 * (`lib/ensaio.ts`), e a resposta seria sempre "não existe". A pergunta vai à
 * tabela, que é o dado autoritativo — e é exatamente o ponto do teste: provar
 * que o dado está certo e quem volta atrás é a tela.
 */
async function statusNoBanco() {
  const { data } = await sb.from("chat_conversa").select("status").eq("cliente_id", ENSAIO).maybeSingle();
  return data?.status ?? null;
}

const chrome = await subirChrome({ porta: 9425 });
try {
  await mandarStatus("aberta"); // parte sempre do mesmo lugar

  const aba = await novaAba(chrome);
  await aba.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await aba.ir(`${BASE}${TELA}?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 7000 });

  const pronta = await aba.ate(`!!document.querySelector('textarea')`, { ms: 25_000 });
  if (!pronta) {
    falha("a conversa de ensaio abre com o compositor");
  } else {
    ok("a conversa de ensaio abre com o compositor");

    // ---- ATRASA a recarga da lista --------------------------------------
    // Não é uma condição inventada: `/api/chat` é a rota mais pesada do sistema
    // (2,9 MB e ~30 idas ao banco na fase 0) e leva segundos com a base grande
    // ou a rede ruim. O atraso aqui só torna o instante determinístico.
    await aba.js(`
      window.__listas = 0;
      const original = window.fetch;
      window.fetch = function (entrada) {
        const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
        const p = original.apply(this, arguments);
        if (url.includes(${JSON.stringify(ROTA_LISTA)})) {
          window.__listas++;
          return p.then((r) => new Promise((res) => setTimeout(() => res(r), 6000)));
        }
        return p;
      };
      return true;`);

    // ---- 1. responde a cliente (é isto que põe uma recarga em voo) -------
    const escreveu = await aba.js(`
      const campo = document.querySelector('textarea');
      if (!campo) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(campo, 'ensaio: resolver-volta');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;`);
    escreveu ? ok("responde a cliente (deixa uma recarga da lista em voo)") : falha("responde a cliente");

    await espera(1500);
    const emVoo = await aba.js(`return window.__listas;`);
    emVoo > 0
      ? ok("há recarga de lista em voo", `${emVoo} pedido(s) atrasado(s)`)
      : falha("há recarga de lista em voo", "nenhum pedido interceptado");

    // ---- 2. resolve, com a recarga ainda em voo --------------------------
    const clicou = await aba.js(`
      const b = [...document.querySelectorAll('button')]
        .find(x => /Resolver conversa/i.test(x.getAttribute('title') || ''));
      if (!b) return false; b.click(); return true;`);
    if (!clicou) falha("acha o botão Resolver");
    else {
      ok("acha o botão Resolver");
      // ⚠️ o diálogo é `next/dynamic`: na primeira vez ele ainda está baixando,
      // e clicar cedo demais não acha botão nenhum
      const dialogo = await aba.ate(
        `[...document.querySelectorAll('button')].some(x => (x.textContent||'').trim() === 'Resolver')`,
        { ms: 12_000 },
      );
      dialogo ? ok("o diálogo de motivo abre") : falha("o diálogo de motivo abre");
      // o botão só libera com um motivo escolhido — é a nossa tabulação (§18)
      await aba.js(`
        const m = [...document.querySelectorAll('button')]
          .find(x => (x.textContent||'').trim() === 'follow-up');
        if (m) m.click(); return !!m;`);
      await espera(300);
      await aba.js(`
        const b = [...document.querySelectorAll('button')]
          .find(x => (x.textContent||'').trim() === 'Resolver');
        if (b) b.click(); return true;`);

      // ⚠️ NÃO procurar "resolvida" no corpo inteiro: o chip da fila se chama
      // "Resolvidas" e casaria SEMPRE — foi o falso positivo da 1ª rodada. O
      // que diz o estado desta conversa é a sub-linha do cabeçalho.
      // ⚠️ `\s` dentro de template literal vira `s`: a regex virava
      // /·s*resolvida/ e NUNCA casava. Uma barra a menos custou uma rodada.
      const SELO = `(() => { const h = document.querySelector('section > header'); ` +
        `return !!h && /resolvida/i.test(h.textContent || ''); })()`;
      const virou = await aba.ate(SELO, { ms: 12_000 });
      virou ? ok("a tela mostra a conversa como resolvida") : falha("a tela mostra como resolvida");

      // ---- 3. a resposta atrasada chega ---------------------------------
      await espera(8000);

      const temSelo = await aba.js(`return ${SELO};`);
      const noBanco = await statusNoBanco();

      if (noBanco !== "resolvida") {
        falha("o BANCO continua com a conversa resolvida", `banco = ${noBanco}`);
      } else {
        ok("o BANCO continua com a conversa resolvida");
        temSelo
          ? ok("a tela NÃO desfaz o resolver — a recarga velha foi descartada")
          : falha(
              "REPRODUZIDO: a recarga velha desfaz o resolver na tela",
              "banco=resolvida, tela=aberta",
            );
      }
      await aba.foto(`resolver-volta${TELA.replace(/\//g, "-")}`);
    }
  }

  aba.excecoes.length
    ? falha("sem exceção no console", aba.excecoes.slice(0, 2).join(" | "))
    : ok("sem exceção no console");
} finally {
  await mandarStatus("aberta");
  fecharChrome(chrome);
}

const bons = passos.filter((p) => p.ok).length;
for (const p of passos) console.log(`${p.ok ? "OK  " : "FALHA"} ${p.n}${p.d ? ` — ${p.d}` : ""}`);
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
