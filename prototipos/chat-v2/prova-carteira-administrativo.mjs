// -----------------------------------------------------------------------------
// A CARTEIRA DO ADMINISTRATIVO (demanda #62, 02/10/2026)
//
//   npx next start -p 3122      (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-carteira-administrativo.mjs
//
// O RCA 11 do WinThor (ADMINISTRATIVO VENUS) nao estava em `carteira_config`,
// entao os clientes que o ERP ja tinha passado para ele continuavam aparecendo
// sob a consultora anterior. A 0151 criou a carteira e passou para ela os
// clientes de kamilly/luana/romulo SEM conversa nos 3 dias anteriores.
//
// ⚠️ ESTA PROVA SO LE. Nao cria cliente, nao move carteira, nao envia nada: o
// estado que ela afere e o que a migration deixou, e inventar um cliente de
// ensaio aqui mexeria na carteira de gente de verdade.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3122";
const ADM = "administrativo@muranoprofessional.com.br";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

// ⚠️ A SESSAO E A DO VENDEDOR, nao a de admin com o e-mail dele.
// `crm_sessao` guarda o PAPEL, e para vendedor o token e o proprio slug da
// carteira (`tokenDePapel`, lib/papel.ts) -- com `crm_sessao=admin` a rota
// devolveria o CRM inteiro e a prova passaria dizendo o contrario do que afere.
const pedir = (rota) =>
  fetch(`${BASE}${rota}`, {
    headers: { cookie: `crm_sessao=administrativo; crm_email=${ADM}`, "cache-control": "no-cache" },
  }).then((r) => r.json());

const chrome = await subirChrome({ porta: 9673 });
try {
  // ---- 1. a carteira existe, e SEM RCA proprio ---------------------------
  const { data: cfg } = await sb.from("carteira_config")
    .select("slug,rca_num,ativo,time").eq("slug", "administrativo").maybeSingle();
  conferir(cfg?.ativo === true, "a carteira do administrativo existe e esta ativa", JSON.stringify(cfg));
  conferir(
    cfg?.rca_num === null,
    "...e SEM rca_num: e isso que mantem a passagem parcial de pe (#62)",
    `rca_num = ${cfg?.rca_num}`,
  );

  const { data: ac } = await sb.from("acesso")
    .select("papel,carteira,ativo").eq("email", ADM).maybeSingle();
  conferir(ac?.papel === "vendedor" && ac?.carteira === "administrativo" && ac?.ativo,
    "o acesso dele no Pulse e de VENDEDOR, na propria carteira", JSON.stringify(ac));

  // ---- 2. quem passou, e quem NAO passou ---------------------------------
  const { count: movidos } = await sb.from("carteira_transferencia")
    .select("id", { count: "exact", head: true }).like("por", "%0151%");
  conferir(movidos > 0, "cada passagem ficou registrada, com de/para", `${movidos} linhas`);

  // as que ficaram: cliente do RCA 11 que seguiu com a consultora
  const { count: ficaram } = await sb.from("clientes")
    .select("id", { count: "exact", head: true })
    .in("carteira", ["kamilly", "luana", "romulo"]);
  conferir(ficaram > 0, "as consultoras continuam com carteira — nao foi um esvaziamento", `${ficaram} clientes`);

  // ---- 3. a LISTA do chat, como o administrativo -------------------------
  const lista = await pedir("/api/chat?limite=60");
  const conversas = lista.conversas ?? [];
  conferir(conversas.length > 0, "o administrativo ja tem conversas na lista dele", `${conversas.length} na primeira pagina`);

  const deOutros = conversas.filter((c) => c.vendedor && c.vendedor !== "administrativo" && !c.sem_dono);
  conferir(
    deOutros.length === 0,
    "...e NENHUMA e de outra carteira — papel vendedor ve so a propria",
    deOutros.length ? JSON.stringify(deOutros.slice(0, 2).map((c) => c.vendedor)) : "nenhuma",
  );

  // ---- 4. a AGENDA (Minha carteira) nao volta vazia ----------------------
  //
  // ⚠️ Este e o passo que a correcao de codigo existe para fazer passar: a rota
  // montava a lista a partir de `wth_carteira.rca_num`, e uma carteira sem RCA
  // caia num `.in("rca_num", [])` — agenda vazia, que parece defeito.
  // ⚠️ O TOTAL E CONTADO EM CODCLI, NAO EM CONTATO, e a diferenca nao e
  // detalhe: 15 clientes do ERP tem DOIS contatos no Pulse (dois numeros), entao
  // 1.079 contatos sao 1.064 clientes. A agenda e a lista do ERP. Comparar com
  // os contatos acusaria 15 faltando para sempre -- e um teste que acusa o que
  // esta certo ensina a ignorar o proprio alarme.
  // ⚠️ PAGINADO. Sem isto o proprio teste cai na armadilha que esta testando:
  // o PostgREST corta em 1.000 linhas SEM AVISAR, e a prova acusou "1.064 de
  // 986" -- culpando a rota por uma truncagem dela mesma.
  const ids = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from("clientes").select("id")
      .eq("carteira", "administrativo").order("id").range(de, de + 999);
    ids.push(...(data ?? []).map((c) => c.id));
    if (!data || data.length < 1000) break;
  }
  const cods = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("wth_vinculo").select("codcli").in("cliente_id", ids.slice(i, i + 200));
    for (const v of data ?? []) cods.add(Number(v.codcli));
  }
  const agenda = await pedir("/api/chat/carteira");
  const linhas = agenda.carteira ?? [];
  // Com `> 0` esta prova passava verde mostrando 278 de 1.064 -- um lote que
  // estourava a URL e voltava erro engolido. Lista parcial so vira falha
  // quando o teste sabe o total.
  conferir(
    linhas.length === cods.size,
    "a aba Minha carteira traz a carteira INTEIRA dele",
    `${linhas.length} de ${cods.size} clientes do ERP (${ids.length} contatos)`,
  );
  conferir(
    linhas.every((c) => c.vendedor === "administrativo" || c.vendedor == null),
    "...e todos sao da carteira dele",
    [...new Set(linhas.map((c) => c.vendedor))].join(","),
  );
  conferir(
    linhas.filter((c) => c.cliente_id).length > 0,
    "...com o contato do Pulse resolvido, para o clique abrir a conversa",
    `${linhas.filter((c) => c.cliente_id).length} com contato`,
  );

  // ---- 5. a tela, com os olhos dele --------------------------------------
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "administrativo", crm_email: ADM }, BASE);
  await a.ir(`${BASE}/chat-v2`, { esperar: 3000 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 25_000 });
  // ⚠️ O selo e procurado como TEXTO EXATO de um elemento, nao como pedaco
  // do corpo da pagina: ha clientes chamadas LUANA e MILENE, e um `includes`
  // sobre o body inteiro acusaria o nome delas como se fosse selo de carteira.
  const tela = await a.js(`
    const outras = ['kamilly','luana','thamires','milene','anne','thiago','romulo'];
    const selos = [...document.querySelectorAll('span,div')]
      .map(e => (e.children.length ? '' : (e.textContent || '').trim().toLowerCase()))
      .filter(t => outras.includes(t));
    return {
      temLista: !!document.querySelector('input[placeholder*="Buscar"]'),
      selosDeOutros: [...new Set(selos)],
    };`);
  conferir(tela.temLista, "a tela do chat abre para o administrativo");
  conferir(
    tela.selosDeOutros.length === 0,
    "...sem selo de outra consultora na lista dele",
    tela.selosDeOutros.join(",") || "nenhum",
  );
  await a.foto("carteira-administrativo-chat");

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem excecao", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou ate o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "OK " : "XX "} ${p.n}${p.d ? `  -- ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`
${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
