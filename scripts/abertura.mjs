#!/usr/bin/env node
// -----------------------------------------------------------------------------
// A FOTO DO MOMENTO — rode isto ao abrir qualquer sessão neste repositório.
//
//     node scripts/abertura.mjs
//
// Por que um comando e não um arquivo escrito à mão: o que uma sessão precisa
// saber ao chegar é *quem está mexendo em quê agora*, e isso muda a cada hora.
// Um `SESSOES.md` mantido no braço fica velho no primeiro esquecimento — e um
// arquivo velho é pior que nenhum, porque parece verdade. Tudo aqui é derivado
// do estado real: git, processos, disco.
//
// Em 28/08/2026 a falta disso custou: dois `next build` no mesmo `.next`, uma
// sessão trocando a branch da árvore com trabalho não commitado de outra
// dentro, e uma atribuição errada de autoria a partir de um `git status`
// misturado. Ver §0 do CLAUDE.md.
//
// Só lê. Não cria, não apaga, não commita.
// -----------------------------------------------------------------------------
import { execSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const sh = (cmd, opts = {}) => {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts }).trim(); }
  catch { return ""; }
};

// ⚠️ Barra invertida montada em runtime, e não escrita como literal: este
// arquivo já nasceu quebrado uma vez porque a barra dupla foi comida no
// caminho até o disco (§55 do CLAUDE.md, quarta ocorrência). Com
// `fromCharCode` não há escape para alguém comer.
const BARRA = String.fromCharCode(92);
const norm = (p) => String(p).split(BARRA).join("/");

const T = {
  reset: "\x1b[0m", forte: "\x1b[1m", apaga: "\x1b[2m",
  vermelho: "\x1b[31m", verde: "\x1b[32m", amarelo: "\x1b[33m", roxo: "\x1b[35m",
};
const titulo = (t) => console.log(`\n${T.forte}${T.roxo}${t}${T.reset}`);
const nota = (t) => console.log(`${T.apaga}${t}${T.reset}`);

// ---------------------------------------------------------------- onde estou
const raiz = sh("git rev-parse --show-toplevel");
if (!raiz) { console.error("não estou num repositório git"); process.exit(1); }
const branch = sh("git rev-parse --abbrev-ref HEAD");
const sujoAqui = sh("git status --porcelain").split("\n").filter(Boolean);

titulo("ONDE VOCÊ ESTÁ");
console.log(`  pasta   ${raiz}`);
console.log(`  branch  ${branch === "master" ? T.vermelho + branch + "  <-- atencao" + T.reset : T.verde + branch + T.reset}`);
if (branch === "master") {
  nota("  master é a árvore compartilhada. NÃO trabalhe aqui — crie uma worktree:");
  nota("      node scripts/nova-worktree.mjs <nome> <porta>");
}
console.log(`  árvore  ${sujoAqui.length ? T.amarelo + sujoAqui.length + " arquivo(s) alterado(s)" + T.reset : T.verde + "limpa" + T.reset}`);
for (const l of sujoAqui.slice(0, 12)) console.log(`          ${l}`);
if (sujoAqui.length > 12) nota(`          ... e mais ${sujoAqui.length - 12}`);

// ------------------------------------------------------- as outras frentes
// O item mais importante deste relatório. Worktree com arquivo alterado = tem
// gente trabalhando ali AGORA, e aqueles arquivos são território ocupado.
titulo("AS OUTRAS FRENTES");
const bruto = sh("git worktree list --porcelain");
const arvores = [];
let atual = {};
for (const linha of bruto.split("\n")) {
  if (linha.startsWith("worktree ")) { atual = { path: linha.slice(9) }; arvores.push(atual); }
  else if (linha.startsWith("branch ")) atual.branch = linha.slice(7).replace("refs/heads/", "");
  else if (linha === "detached") atual.branch = "(detached)";
}
const outras = arvores.filter((a) => norm(a.path) !== norm(raiz));
let alguemOcupado = false;
if (!outras.length) nota("  nenhuma outra worktree — você está sozinho no repositório");
for (const a of outras) {
  const sujo = sh(`git -C "${a.path}" status --porcelain`).split("\n").filter(Boolean);
  if (sujo.length) alguemOcupado = true;
  const marca = sujo.length ? `${T.amarelo}OCUPADA${T.reset}` : `${T.apaga}parada ${T.reset}`;
  console.log(`  ${marca}  ${a.branch ?? "?"}  ${T.apaga}${a.path}${T.reset}`);
  for (const l of sujo.slice(0, 8)) console.log(`            ${l}`);
  if (sujo.length > 8) nota(`            ... e mais ${sujo.length - 8}`);
}
if (alguemOcupado) nota("  -> os arquivos listados acima são de outra sessão. Não encoste neles.");

// ------------------------------------------------------------ portas no ar
titulo("SERVIDORES NO AR");
let portas = [];
if (process.platform === "win32") {
  for (const l of sh("netstat -ano").split("\n")) {
    const m = l.match(/TCP\s+\S+:(\d{4})\s+\S+\s+LISTENING\s+(\d+)/);
    if (m && Number(m[1]) >= 3000 && Number(m[1]) < 4000) portas.push({ porta: m[1], pid: m[2] });
  }
} else {
  for (const l of sh("lsof -nP -iTCP -sTCP:LISTEN").split("\n")) {
    const m = l.match(/^(\S+)\s+(\d+).*:(\d{4})\s/);
    if (m && Number(m[3]) >= 3000 && Number(m[3]) < 4000) portas.push({ porta: m[3], pid: m[2] });
  }
}
portas = [...new Map(portas.map((p) => [p.porta, p])).values()].sort((a, b) => Number(a.porta) - Number(b.porta));
if (!portas.length) nota("  nenhum servidor entre 3000 e 3999");
for (const p of portas) console.log(`  ${p.porta}  ${T.apaga}pid ${p.pid}${T.reset}`);
if (portas.length) nota("  -> escolha uma porta livre. NUNCA mate processo alheio (§0).");

// ------------------------------------------------------------------- o repo
titulo("O REPOSITÓRIO");
sh("git fetch origin --quiet");
console.log(`  origin/master  ${sh("git log --oneline -1 origin/master")}`);
const atras = sh("git rev-list --count HEAD..origin/master");
if (atras && atras !== "0") console.log(`  ${T.amarelo}sua branch está ${atras} commit(s) atrás de master${T.reset}`);
const prs = sh("gh pr list --limit 8 --json number,headRefName,title");
if (prs) {
  try {
    const lista = JSON.parse(prs);
    if (lista.length) {
      nota("  PRs abertos:");
      for (const p of lista) console.log(`    #${p.number}  ${p.headRefName}  ${T.apaga}${p.title}${T.reset}`);
    }
  } catch { /* gh ausente ou sem permissão — segue sem */ }
}

// -------------------------------------------------------------- migrations
// O banco é UM SÓ. Duas sessões escolhendo o mesmo número é o erro que este
// projeto já cometeu duas vezes (§21.3: duas frentes criaram 0080, depois 0082).
titulo("MIGRATIONS");
const dir = join(raiz, "supabase", "migrations");
if (existsSync(dir)) {
  const nums = readdirSync(dir).map((f) => Number(f.slice(0, 4))).filter((n) => !Number.isNaN(n));
  const ultima = Math.max(0, ...nums);
  console.log(`  última no disco  ${String(ultima).padStart(4, "0")}`);
  console.log(`  ${T.forte}próxima livre    ${String(ultima + 1).padStart(4, "0")}${T.reset}`);
  nota("  -> confira também `supabase_migrations.schema_migrations` NO BANCO antes de usar,");
  nota("     e commite o arquivo sozinho na hora, para reservar o número.");
}

// ---------------------------------------------------------------- protocolo
titulo("ANTES DE ESCREVER");
for (const l of [
  "trabalhe só nesta worktree e nesta branch",
  "commite SÓ o que você mexeu — `git diff origin/master` separa, a memória não",
  "ao terminar: PR para master (squash), nunca push direto",
  "web/app/chat/page.tsx e web/app/page.tsx passam de 3.000 linhas: se outra",
  "  frente estiver neles, espere — duas sessões ali conflitam sempre",
]) console.log(`  · ${l}`);
console.log(`\n${T.apaga}  o porquê de cada regra: §0 do CLAUDE.md${T.reset}\n`);
