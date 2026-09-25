// Deixa os testes de unidade importarem `web/lib/*.ts` direto pelo Node 24
// (que já remove os tipos sozinho). O código do app importa sem extensão
// ("./telefone"), que é o que o Next resolve e o Node não: este gancho tenta
// `.ts` quando o caminho relativo não existe. Só vale para os testes — o app
// não passa por aqui.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(especificador, contexto, proximo) {
    if ((especificador.startsWith("./") || especificador.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(especificador)) {
      const url = new URL(especificador + ".ts", contexto.parentURL);
      if (existsSync(fileURLToPath(url))) return proximo(url.href, contexto);
    }
    return proximo(especificador, contexto);
  },
});
