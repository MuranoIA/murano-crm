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
import { subirChrome, novaAba, fecharChrome, acharChrome, SAIDAS } from "./driver.mjs";

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

async function main() {
  mkdirSync(SAIDAS, { recursive: true });

  const noAr = await api.servidorNoAr();
  console.log(`servidor em ${api.BASE}: ${noAr ? "no ar" : "FORA DO AR — casos de rota serão pulados"}`);
  ctx.servidorNoAr = noAr;

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
  const sobrou = await db.limpar();

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
  try { await db.limpar(); } catch {}
  if (chrome) fecharChrome(chrome);
  process.exit(2);
});
