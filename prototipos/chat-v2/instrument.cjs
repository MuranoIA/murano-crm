// -----------------------------------------------------------------------------
// instrument.cjs — quantas idas ao banco cada requisição do CRM faz, e quantos
// bytes trafega.
//
//     cd web && NODE_OPTIONS="--require ../prototipos/chat-v2/instrument.cjs" npm start
//
// Sai um JSONL em prototipos/chat-v2/medicoes/idas-<timestamp>.jsonl, uma linha
// por chamada ao Supabase, JÁ ATRIBUÍDA à requisição que a provocou.
//
// Por que existe: o laudo de performance (prototipos/laudo-performance.md §0)
// descreve este preload, mas o arquivo nunca foi commitado. Este é ele, escrito
// de novo em 19/09/2026 — e agora versionado, para a próxima medição não
// recomeçar do zero.
//
// Como funciona, e por que assim:
//  - envolve o `fetch` global ANTES de o Next subir. É o único ponto por onde o
//    `@supabase/supabase-js` fala com o banco, então pega tudo sem tocar no
//    código do app;
//  - envolve também o `http.createServer` e roda cada requisição dentro de um
//    AsyncLocalStorage. Sem isso dá para contar as idas, mas não para dizer DE
//    QUEM elas são — e o número que interessa é "quantas idas uma abertura do
//    /chat custa", não o total do processo;
//  - mede os bytes por `content-length` quando ele vem, e só aí clona a resposta
//    para contar. Clonar toda resposta mudaria o que se está medindo.
//
// ⚠️ A máquina de medição fala com o Supabase pela internet: cada ida custa
// ~170-220 ms aqui contra poucos milissegundos em produção, onde a função
// passou a rodar em gru1, do lado do banco (PR #234). Portanto: compare
// CONTAGEM e BYTES entre versões, e trate o tempo como ordem de grandeza.
// -----------------------------------------------------------------------------
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { AsyncLocalStorage } = require("node:async_hooks");

const PASTA = path.join(__dirname, "medicoes");
fs.mkdirSync(PASTA, { recursive: true });
const ARQUIVO = path.join(PASTA, `idas-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const saida = fs.createWriteStream(ARQUIVO, { flags: "a" });

const contexto = new AsyncLocalStorage();
let seq = 0;

function anotar(linha) {
  saida.write(JSON.stringify(linha) + "\n");
}

// ---- 1. cada requisição HTTP vira um contexto -------------------------------
const criarOriginal = http.createServer.bind(http);
http.createServer = function (...args) {
  const ouvinte = typeof args[0] === "function" ? args[0] : args[1];
  const opcoes = typeof args[0] === "function" ? undefined : args[0];
  if (typeof ouvinte !== "function") return criarOriginal(...args);

  const envolvido = (req, res) => {
    const req_id = ++seq;
    const comeco = process.hrtime.bigint();
    const ctx = { req_id, rota: req.url, metodo: req.method, idas: 0, bytes: 0 };
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - comeco) / 1e6;
      anotar({
        tipo: "requisicao",
        req_id,
        metodo: req.method,
        rota: req.url,
        status: res.statusCode,
        ms: +ms.toFixed(1),
        idas: ctx.idas,
        bytes_banco: ctx.bytes,
        em: new Date().toISOString(),
      });
    });
    return contexto.run(ctx, () => ouvinte(req, res));
  };

  return opcoes ? criarOriginal(opcoes, envolvido) : criarOriginal(envolvido);
};

// ---- 2. cada fetch para o Supabase vira uma linha ----------------------------
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async function (entrada, init) {
  const url = typeof entrada === "string" ? entrada : entrada?.url ?? String(entrada);
  const supabase = /supabase\.(co|in)\b/.test(url);
  if (!supabase) return fetchOriginal(entrada, init);

  const ctx = contexto.getStore();
  const comeco = process.hrtime.bigint();
  const res = await fetchOriginal(entrada, init);
  const ms = Number(process.hrtime.bigint() - comeco) / 1e6;

  // bytes: preferir o cabeçalho. Clonar toda resposta mudaria a medição.
  let bytes = Number(res.headers.get("content-length") || 0);
  if (!bytes) {
    try {
      bytes = (await res.clone().arrayBuffer()).byteLength;
    } catch {
      bytes = -1;
    }
  }

  if (ctx) {
    ctx.idas++;
    ctx.bytes += Math.max(bytes, 0);
  }

  const u = new URL(url);
  anotar({
    tipo: "ida",
    req_id: ctx?.req_id ?? null,
    de: ctx?.rota ?? "(fora de requisição)",
    metodo: (init?.method || (typeof entrada === "object" && entrada?.method) || "GET").toUpperCase(),
    alvo: u.pathname.replace("/rest/v1/", ""),
    // a query diz qual filtro custou: mantida, mas sem os valores, que são PII
    filtros: [...u.searchParams.keys()].join(","),
    ms: +ms.toFixed(1),
    bytes,
    status: res.status,
    em: new Date().toISOString(),
  });
  return res;
};

process.on("exit", () => {
  try {
    saida.end();
  } catch {}
});

// nada de console aqui: o stdout deste preload vira argumento de linha de comando
// no processo que o Next levanta, e o servidor morre com "Cannot find module".
anotar({ tipo: "inicio", arquivo: ARQUIVO, em: new Date().toISOString() });
