// -----------------------------------------------------------------------------
// Runner. Roda os casos de `testes/casos/`, imprime o placar e escreve
// `testes/saidas/resultado.json`.
//
// REGRA CENTRAL: um caso que não rodou aparece como PULADO com o motivo — nunca
// some. Este projeto já perdeu horas com corte silencioso (§61.2: um `limit`
// sobre um universo não medido é um filtro invisível), e um teste que
// desaparece é a mesma doença aplicada à própria suíte.
//
//   node testes/run.mjs              todos os casos
//   node testes/run.mjs ciclo1       só os que casam com o texto
//   node testes/run.mjs --sem-navegador
// -----------------------------------------------------------------------------
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as db from "./db.mjs";
import * as api from "./api.mjs";
import { subirChrome, novaAba, novaAbaIsolada, fecharChrome, acharChrome, SAIDAS } from "./driver.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const semNavegador = args.includes("--sem-navegador");
const filtro = args.filter((a) => !a.startsWith("--"))[0] ?? "";

const resultados = [];
let chrome = null;

const ctx = {
  db, api,
  /** Sobe o Chrome só se algum caso pedir. */
  async chrome() {
    if (semNavegador) throw new Error("PULAR:--sem-navegador");
    if (!chrome) {
      if (!acharChrome()) throw new Error("PULAR:Chrome não encontrado nesta máquina");
      chrome = await subirChrome();
    }
    return chrome;
  },
  async aba(url = "about:blank") {
    return novaAba(await ctx.chrome(), url);
  },
  /**
   * Aba com sessao PROPRIA. Obrigatoria quando o caso tem duas pessoas ao
   * mesmo tempo: abas comuns dividem o jarro de cookies, entao o login da
   * segunda derruba o da primeira em silencio (ver novaAbaIsolada no driver).
   */
  async abaIsolada(url = "about:blank") {
    return novaAbaIsolada(await ctx.chrome(), url);
  },
};

/** Contexto entregue a cada caso. */
function fazerT(ciclo) {
  return {
    ciclo, ...ctx,
    /**
     * @param nome     o passo, como está no casos_de_uso_teste_ciclos.md
     * @param esperado '✅' | '⚠️' | '⛔' — o que o DOCUMENTO promete
     * @param fn       roda; lançar = FALHOU. Devolver string = detalhe.
     *                 Lançar Error começando com "PULAR:" = PULADO.
     */
    async passo(nome, esperado, fn) {
      const t0 = Date.now();
      try {
        const detalhe = await fn();
        resultados.push({ ciclo, passo: nome, esperado, resultado: "PASSOU", detalhe: detalhe ?? "", ms: Date.now() - t0 });
        console.log(`  PASSOU  ${esperado} ${nome}${detalhe ? `\n            ${String(detalhe).replace(/\n/g, "\n            ")}` : ""}`);
      } catch (e) {
        const msg = String(e.message ?? e);
        if (msg.startsWith("PULAR:")) {
          resultados.push({ ciclo, passo: nome, esperado, resultado: "PULADO", detalhe: msg.slice(6), ms: Date.now() - t0 });
          console.log(`  PULADO  ${esperado} ${nome}\n            ${msg.slice(6)}`);
        } else {
          resultados.push({ ciclo, passo: nome, esperado, resultado: "FALHOU", detalhe: msg, ms: Date.now() - t0 });
          console.log(`  FALHOU  ${esperado} ${nome}\n            ${msg.replace(/\n/g, "\n            ")}`);
        }
      }
    },
    /** Passo deliberadamente não executado (segurança, pré-requisito ausente). */
    pular(nome, esperado, motivo) {
      resultados.push({ ciclo, passo: nome, esperado, resultado: "PULADO", detalhe: motivo, ms: 0 });
      console.log(`  PULADO  ${esperado} ${nome}\n            ${motivo}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Encerramento: a limpeza roda SEMPRE, inclusive com Ctrl+C.
//
// 10/09/2026: uma rodada foi interrompida às 11:33 e a limpeza nunca aconteceu.
// Vinte e cinco conversas falsas ficaram meia hora na tela dos consultores, e um
// deles chegou a responder uma delas. O `catch` do `main()` cobria "o runner
// morreu"; não cobria SIGINT, que mata o processo sem passar por lá — e SIGINT é
// justamente como se interrompe um ensaio que está demorando.
//
// A varredura por PREFIXO (`limparEnsaio`) vem DEPOIS do rastro em memória, e
// não no lugar dele: o rastro sabe desfazer o que não é cliente fictício
// (interruptores do /admin, por exemplo), e o prefixo acha o que o rastro perdeu
// quando o processo morre no meio. Os dois erram de lados opostos.
// ---------------------------------------------------------------------------
let encerrando = false;

async function encerrar(motivo) {
  if (encerrando) return [];       // segundo Ctrl+C não atropela a limpeza em curso
  encerrando = true;
  const sobrou = [];
  try {
    sobrou.push(...(await db.limpar()));
  } catch (e) {
    sobrou.push(`rastro em memória — ${e.message}`);
  }
  try {
    // dinâmico e tolerante de propósito: se `limparEnsaio` for renomeado um dia,
    // a suíte perde a rede extra com um aviso, em vez de morrer sem limpar nada.
    const sim = await import("./simulacao.mjs");
    if (typeof sim.limparEnsaio === "function") {
      const relato = await sim.limparEnsaio(db.sb);
      const restos = relato.filter((l) => l.includes("ERRO"));
      if (restos.length) sobrou.push(...restos);
    } else {
      sobrou.push("simulacao.mjs não exporta limparEnsaio — varredura por prefixo NÃO rodou");
    }
  } catch (e) {
    sobrou.push(`varredura por prefixo — ${e.message}`);
  }
  if (motivo) {
    console.log(`\n${motivo} — limpei antes de sair.`);
    if (sobrou.length) for (const x of sobrou) console.log(`    ⚠️  ${x}`);
  }
  return sobrou;
}

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, async () => {
    await encerrar(`recebi ${sinal}`);
    if (chrome) fecharChrome(chrome);
    process.exit(130);
  });
}

async function main() {
  mkdirSync(SAIDAS, { recursive: true });

  const noAr = await api.servidorNoAr();
  console.log(`servidor em ${api.BASE}: ${noAr ? "no ar" : "FORA DO AR — casos de rota serão pulados"}`);
  ctx.servidorNoAr = noAr;

  // A faixa de telefone do ensaio é invisível por padrão em toda tela
  // (`web/lib/ensaio.ts`) — é o que impede um cliente fictício de cair na fila
  // de um consultor. O servidor precisa dizer que é de ensaio para enxergá-la,
  // e o aviso vem AQUI, antes de qualquer caso: sem ele o sintoma aparece cinco
  // minutos adiante, como "a conversa não apareceu na lista", e aponta para o
  // lugar errado.
  if (noAr) {
    try {
      const r = await api.chamar("/api/session");
      if (r.status === 200 && r.json && r.json.ensaio_visivel === false) {
        console.log(
          "\n⚠️  O servidor está ESCONDENDO os clientes de ensaio.\n" +
          "    Os casos que olham a lista do chat ou o board vão falhar dizendo\n" +
          "    que a conversa não apareceu — e o motivo é este, não o código.\n" +
          "    Suba o servidor com ENSAIO_VISIVEL=1 (ver testes/README.md).\n"
        );
      }
    } catch { /* servidor antigo, sem o campo: segue */ }
  }

  // A linha telefonica do ensaio vem do CADASTRO, uma vez, AQUI — antes de
  // qualquer caso e nao dentro de um deles. O id estava cravado em
  // simulacao.mjs e o numero foi migrado em 09/09/2026: o antigo virou a
  // linha "Murano 2", inativa, e `crm_config.linhas_visiveis` so deixa
  // passar a ativa — entao as conversas do ensaio nasciam invisiveis e o
  // ciclo 10 acusava "a consultora enxerga so 0 conversas", que aponta para
  // o lugar errado.
  //
  // Resolver no runner, e nao em cada ciclo, e o que faz a correcao alcancar
  // TODO caso: o ciclo 11 tambem escreve pela linha padrao e nao chamava
  // nada. Um ciclo novo nasce coberto sem ninguem lembrar.
  try {
    const sim = await import("./simulacao.mjs");
    if (typeof sim.resolverLinha === "function") {
      const linha = await sim.resolverLinha(db);
      console.log(`linha do ensaio: ${linha}`);
    }
  } catch (e) {
    // fallback e o valor antigo: o ensaio roda como rodava, em vez de nao rodar
    console.log(`nao consegui resolver a linha do ensaio (${e.message}) — seguindo com o padrao`);
  }

  const arquivos = readdirSync(join(AQUI, "casos")).filter((f) => f.endsWith(".mjs")).sort()
    .filter((f) => !filtro || f.includes(filtro));

  if (!arquivos.length) { console.log("nenhum caso casou com o filtro"); return; }

  for (const arq of arquivos) {
    const mod = await import(pathToFileURL(join(AQUI, "casos", arq)).href);
    const ciclo = mod.ciclo ?? arq;
    console.log(`\n=== ${ciclo}  (${arq})`);
    const t = fazerT(ciclo);
    try {
      await mod.default(t);
    } catch (e) {
      // O caso morreu no meio: os passos já rodados ficam, e a morte vira uma
      // linha visível em vez de um arquivo que sumiu da contagem.
      resultados.push({ ciclo, passo: `(o caso ${arq} interrompeu)`, esperado: "—", resultado: "FALHOU", detalhe: String(e.stack ?? e.message), ms: 0 });
      console.log(`  FALHOU  — o caso interrompeu: ${e.message}`);
    }
  }

  // -- restauração: tudo que a suíte escreveu no banco volta atrás ----------
  const sobrou = await encerrar(null);

  const conta = (r) => resultados.filter((x) => x.resultado === r).length;
  const placar = {
    total: resultados.length,
    passou: conta("PASSOU"),
    falhou: conta("FALHOU"),
    pulado: conta("PULADO"),
    regressoes: resultados.filter((r) => r.resultado === "FALHOU" && r.esperado === "✅").length,
  };

  console.log(`\n${"=".repeat(70)}`);
  console.log(`PLACAR  ${placar.total} passos · ${placar.passou} passaram · ${placar.falhou} falharam · ${placar.pulado} pulados`);
  console.log(`        ${placar.regressoes} regressão(ões) — passo marcado ✅ no documento que falhou`);
  if (sobrou.length) {
    console.log(`\n⚠️  NÃO CONSEGUI LIMPAR (declarar no relatório):`);
    for (const s of sobrou) console.log(`    - ${s}`);
  } else {
    console.log(`        nada ficou no banco`);
  }

  writeFileSync(join(SAIDAS, "resultado.json"),
    JSON.stringify({ em: new Date().toISOString(), base: api.BASE, placar, naoLimpo: sobrou, resultados }, null, 2));
  console.log(`\nsaída: testes/saidas/resultado.json`);

  if (chrome) fecharChrome(chrome);
  process.exit(placar.falhou ? 1 : 0);
}

main().catch(async (e) => {
  console.error("runner morreu:", e);
  await encerrar("o runner morreu");
  if (chrome) fecharChrome(chrome);
  process.exit(2);
});
