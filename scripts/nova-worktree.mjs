#!/usr/bin/env node
// -----------------------------------------------------------------------------
// UMA WORKTREE PARA CADA SESSÃO.
//
//     node scripts/nova-worktree.mjs ranking 3110
//     node scripts/nova-worktree.mjs chat-tags 3120 --branch fix/tags
//
// Cria a pasta irmã `../crm-<nome>`, com branch própria saindo de
// `origin/master`, copia os `.env` (que são gitignored e por isso NÃO vêm
// junto), instala as dependências do `web/` e imprime a mensagem de abertura
// pronta para colar na conversa nova.
//
// Por que worktree e não "cuidado ao trocar de branch": o estrago das sessões
// em paralelo acontece FORA do git — `.next` corrompido por dois builds
// simultâneos, servidor de uma derrubando o da outra, `git status` misturando
// autoria. Pasta separada resolve os três de uma vez. §0 do CLAUDE.md.
//
// Ao terminar a feature, depois do merge:  git worktree remove ../crm-<nome>
// -----------------------------------------------------------------------------
import { execSync, spawnSync } from "node:child_process";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const args = process.argv.slice(2);
const nome = args.find((a) => !a.startsWith("--"));
const porta = args.filter((a) => !a.startsWith("--"))[1];
const iBranch = args.indexOf("--branch");
const branch = iBranch >= 0 ? args[iBranch + 1] : `feat/${nome}`;

if (!nome || !porta) {
  console.error(`
uso:  node scripts/nova-worktree.mjs <nome> <porta> [--branch <nome-da-branch>]

  <nome>   vira a pasta ../crm-<nome> e, por padrão, a branch feat/<nome>
  <porta>  a porta do servidor desta sessão. Use uma livre — o
           abertura.mjs mostra quais já estão ocupadas.

exemplo:  node scripts/nova-worktree.mjs ranking 3110
`);
  process.exit(1);
}

const sh = (cmd, opts = {}) =>
  execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

const raiz = sh("git rev-parse --show-toplevel");
const destino = join(dirname(raiz), `crm-${nome}`);

if (existsSync(destino)) {
  console.error(`\n${destino} já existe. Escolha outro nome, ou remova antes:\n  git worktree remove ${destino}\n`);
  process.exit(1);
}

// A porta precisa estar livre AGORA. Descobrir isso depois, quando o servidor
// não subir, custa muito mais que a checagem.
if (process.platform === "win32") {
  let netstat = "";
  try { netstat = sh("netstat -ano"); } catch { /* segue */ }
  if (new RegExp(`:${porta}\\s`).test(netstat)) {
    console.error(`\na porta ${porta} já está em uso. Rode 'node scripts/abertura.mjs' para ver as livres.\n`);
    process.exit(1);
  }
}

console.log(`\ncriando worktree em ${destino}`);
console.log(`  branch ${branch}, a partir de origin/master`);
execSync("git fetch origin --quiet", { stdio: "inherit" });
execSync(`git worktree add "${destino}" -b ${branch} origin/master`, { stdio: "inherit" });

// Os .env são gitignored — clone novo e worktree nova nascem sem eles, e sem
// eles nada roda localmente. Foi a dor documentada na §19.1 quando a pasta de
// trabalho foi recriada em 11/08.
console.log("\ncopiando os .env (não vêm pelo git)");
for (const rel of [".env", join("web", ".env.local")]) {
  const de = join(raiz, rel), para = join(destino, rel);
  if (!existsSync(de)) { console.log(`  ${rel}  ausente na origem, pulei`); continue; }
  mkdirSync(dirname(para), { recursive: true });
  copyFileSync(de, para);
  console.log(`  ${rel}  ok`);
}

console.log("\ninstalando dependências do web/ (demora um pouco)");
// `npm.cmd` no Windows em vez de `shell: true`: com shell os argumentos vao
// concatenados, sem escape, e o Node avisa (DEP0190). Aqui nao ha argumento
// vindo de fora, mas o aviso aparece na tela de quem roda e parece defeito.
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const r = spawnSync(npm, ["install", "--no-audit", "--no-fund"], {
  cwd: join(destino, "web"), stdio: "inherit",
});
if (r.status !== 0) {
  console.error("\nnpm install falhou. A worktree está criada; rode a instalação à mão em web/.");
  process.exit(1);
}

// A porta vai no COMANDO, e não no package.json: mudar o `-p 3100` de lá criaria
// um diff que alguém acabaria commitando, e a porta de uma sessão viraria a de
// todo mundo.
console.log(`
${"─".repeat(72)}
pronto. cole isto na conversa nova:
${"─".repeat(72)}

Worktree: ${destino}
Branch: ${branch}
Servidor: cd web && npx next dev -p ${porta}

Rode 'node scripts/abertura.mjs' antes de escrever qualquer coisa — ele
mostra o que as outras sessões estão mexendo agora.

[descreva aqui o que você quer]

${"─".repeat(72)}
ao terminar, depois do merge:  git worktree remove ${destino}
`);
