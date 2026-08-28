// -----------------------------------------------------------------------------
// REGRESSÃO — paginação sobre ordem não-total perde e duplica clientes.
//
// Achado em 27/08/2026. `/api/funil` paginava `vw_funil_visivel` ordenando só
// por `ultima_atividade`, que é NULA em ~4 mil linhas (toda a prospecção). Com
// milhares de empates, cada página é uma consulta separada e o Postgres não
// promete a mesma ordem entre elas: a mesma linha volta em duas páginas e outra
// não volta em nenhuma.
//
// Medido antes da correção:
//     view 4.327 clientes (0 duplicados)
//     rota 4.322 cards, 4.297 distintos
//     => 22 clientes em dobro (25 linhas) e 30 clientes INVISÍVEIS no board
//     a conta fecha exata: 4.327 - 30 + 25 = 4.322
//
// Depois da correção (desempate por `cliente_id`): 4.322 cards, 4.322 distintos,
// 0 duplicados, 0 invisíveis.
//
// ⚠️ ESTE ARQUIVO É A TRAVA. Se alguém remover um `.order("cliente_id")` destes,
// o passo 1 volta a falhar. Sem ele, o defeito é invisível: não há erro, não há
// log, os clientes só somem.
// -----------------------------------------------------------------------------
export const ciclo = "Regressão — paginação determinística (board, campanha, chat)";

/** Pagina uma relação do jeito que a rota pagina, e devolve as linhas. */
async function paginar(sb, rel, { colunas = "cliente_id", ordem = [], pagina = 1000 } = {}) {
  const linhas = [];
  for (let de = 0; ; de += pagina) {
    let q = sb.from(rel).select(colunas);
    for (const o of ordem) q = q.order(o.col, { ascending: o.asc ?? true, nullsFirst: o.nullsFirst });
    const { data, error } = await q.range(de, de + pagina - 1);
    if (error) throw new Error(`${rel}: ${error.message}`);
    linhas.push(...(data ?? []));
    if (!data || data.length < pagina) break;
  }
  return linhas;
}

const tel8 = (t) => String(t ?? "").replace(/\D/g, "").slice(-8);

export default async function (t) {
  const { db, api } = t;

  // ---------------------------------------------------------------- passo 1
  await t.passo("1. /api/funil não perde nem duplica cliente", "✅", async () => {
    if (!t.servidorNoAr) throw new Error(`PULAR:servidor fora do ar em ${api.BASE}`);

    // universo: a view que a tela lê, com o telefone (necessário no item b)
    const universo = await paginar(db.sb, "vw_funil_visivel", {
      colunas: "cliente_id,telefone", ordem: [{ col: "cliente_id" }],
    });
    const telDaView = new Map(universo.map((r) => [r.cliente_id, r.telefone]));

    const r = await api.get("/api/funil", api.SESSOES.admin);
    api.status(r, 200, "GET /api/funil");
    const cards = r.json?.cards ?? r.json?.linhas ?? [];
    api.ok(cards.length > 0, "/api/funil devolveu 0 cards");

    // (a) nenhum cliente aparece duas vezes — "cada card representa um cliente"
    const cont = new Map();
    for (const c of cards) cont.set(c.cliente_id, (cont.get(c.cliente_id) ?? 0) + 1);
    const dups = [...cont.entries()].filter(([, n]) => n > 1);
    api.ok(dups.length === 0,
      `${dups.length} cliente(s) DUPLICADO(S) no board (${cards.length} cards, ${cont.size} distintos). ` +
      `Exemplos: ${dups.slice(0, 3).map(([id, n]) => `${id}x${n}`).join(", ")}. ` +
      `Quase certamente um .order("cliente_id") foi removido de um laço de paginação.`);

    // (b) ninguém do universo some sem explicação.
    //
    // A única saída legítima é o cliente já estar numa das colunas de venda
    // (`vw_venda_card`, 0105). Isso casa por TRÊS chaves, e esquecer a terceira
    // dá falso positivo: `ehCompradorMes` no /api/funil também casa por **tel8**,
    // então a mesma pessoa pode estar no board sob outra identidade (um
    // `clientes.id` ou um `venda:<codcli>`) e até com outro nome. Foi exatamente
    // assim que este teste acusou 5 clientes "invisíveis" que estavam lá.
    const { data: vc } = await db.sb.from("vw_venda_card").select("cliente_id,codcli,telefone");
    const idVenda = new Set();
    const telVenda = new Set();
    for (const v of vc ?? []) {
      if (v.cliente_id) idVenda.add(v.cliente_id);
      if (v.codcli != null) idVenda.add(`winthor:${v.codcli}`);
      const t = tel8(v.telefone);
      if (t.length === 8) telVenda.add(t);
    }

    const sumiram = universo.map((u) => u.cliente_id).filter((id) => {
      if (cont.has(id)) return false;                       // está no board
      if (idVenda.has(id)) return false;                    // foi para a coluna de venda
      const t = tel8(telDaView.get(id));                    // ou foi, sob outra identidade
      return !(t.length === 8 && telVenda.has(t));
    });
    api.ok(sumiram.length === 0,
      `${sumiram.length} cliente(s) da view NÃO aparecem no board e não estão na coluna de venda — ` +
      `estão invisíveis. Exemplos: ${sumiram.slice(0, 5).join(", ")}`);

    return `view ${universo.length} · board ${cards.length} cards / ${cont.size} distintos · ` +
      `0 duplicados · 0 invisíveis`;
  });

  // ---------------------------------------------------------------- passo 2
  await t.passo("2. sem desempate a paginação É instável (prova de que o passo 1 pega o defeito)", "✅", async () => {
    // §4.6 da definição: um teste que passa de primeira é suspeito. Este
    // reproduz o defeito direto contra o banco, sem passar pela rota, e prova
    // que o passo 1 falharia de verdade se a correção sumisse.
    const semDesempate = await paginar(db.sb, "vw_funil_visivel", {
      ordem: [{ col: "ultima_atividade", asc: false, nullsFirst: false }],
    });
    const comDesempate = await paginar(db.sb, "vw_funil_visivel", {
      ordem: [{ col: "ultima_atividade", asc: false, nullsFirst: false }, { col: "cliente_id", asc: true }],
    });
    const total = await db.contar("vw_funil_visivel");

    const idsSem = semDesempate.map((r) => r.cliente_id);
    const idsCom = comDesempate.map((r) => r.cliente_id);
    const dSem = idsSem.length - new Set(idsSem).size;

    api.igual(idsCom.length - new Set(idsCom).size, 0,
      "COM desempate ainda há duplicata — a correção não resolve o problema");
    api.igual(new Set(idsCom).size, total,
      "COM desempate a paginação não cobre a view inteira");

    // O lado "sem desempate" é o defeito. Se um dia o Postgres passar a ser
    // estável aqui, isto vira 0 e o passo apenas registra — não falha, porque o
    // que precisa estar correto é o lado corrigido.
    return `sem desempate: ${idsSem.length} linhas, ${dSem} duplicadas, ` +
      `${total - new Set(idsSem).size} perdidas · ` +
      `com desempate: ${idsCom.length} linhas, 0 duplicadas, 0 perdidas`;
  });

  // ---------------------------------------------------------------- passo 3
  await t.passo("3. nenhum laço de paginação do app fica sem ordem alguma", "✅", async () => {
    // Trava estrutural: pega o desempate removido em QUALQUER rota, inclusive
    // nas que hoje cabem numa página só e por isso não falhariam no passo 1.
    //
    // A regra é deliberadamente ESTREITA: só acusa laço de paginação SEM
    // `.order()` nenhum, que é o caso inequívoco (não há ordem prometida
    // alguma). Um `.order()` único sobre coluna ÚNICA — `codcli`, `id` — já é
    // ordem total e está correto; acusá-lo faria este teste virar alarme que
    // todo mundo aprende a ignorar, que é pior do que não existir.
    const { execSync } = await import("node:child_process");
    const raiz = new URL("../../web/app/api", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    let saida = "";
    try {
      saida = execSync(`grep -rn --include=route.ts -B8 "\\.range(" "${raiz}"`, { encoding: "utf8" });
    } catch { throw new Error("PULAR:grep indisponível nesta máquina"); }

    const blocos = saida.split("--\n");
    const suspeitos = [];
    for (const b of blocos) {
      if (!/\.range\(/.test(b)) continue;
      if (!/for \(let |while \(true\)/.test(b)) continue;   // range fixo (0,999) não pagina
      if (/\.order\(/.test(b)) continue;                    // tem alguma ordem: ver a nota acima
      const arq = (b.match(/([^\s:]+route\.ts)/) ?? [])[1] ?? "?";
      suspeitos.push(arq.split(/[\\/]/).slice(-4).join("/"));
    }
    api.ok(suspeitos.length === 0,
      `laço(s) de paginação sem ordem nenhuma: ${[...new Set(suspeitos)].join(", ")}`);
    return "todos os laços de paginação em app/api têm ordem";
  });
}
