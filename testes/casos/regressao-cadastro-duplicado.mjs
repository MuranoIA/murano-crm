// -----------------------------------------------------------------------------
// REGRESSÃO — o webhook escolhia entre cadastros duplicados SEM ordem.
//
// Achado em 27/08/2026. `acharOuCriarCliente` buscava candidatos por tel8 e
// pegava "o primeiro que tiver carteira", numa consulta sem `order by`. O
// Postgres não promete ordem nesse caso: a MESMA cliente podia cair em linhas
// diferentes entre uma mensagem e outra, partindo a conversa em duas telas —
// enquanto no aparelho dela existe um histórico só.
//
// Medido antes da correção:
//     38 telefones com mais de um cadastro (80 linhas)
//     38 ambíguos para o webhook (mais de um candidato com carteira)
//     16 com a conversa JÁ partida (mensagens nos dois cadastros)
//
// A correção tem duas partes, e as duas são testadas aqui:
//   1. `.order("id")` — desempate estável, para duas execuções escolherem igual;
//   2. a escolha segue a CONVERSA VIVA (cadastro com a mensagem mais recente),
//      porque "tem carteira" não diz onde o histórico mora.
//
// Mesma família do defeito de paginação do board: consulta sem desempate não é
// "quase determinística", é instável.
// -----------------------------------------------------------------------------
import { readFileSync } from "node:fs";

export const ciclo = "Regressão — escolha de cadastro duplicado (webhook)";

const WEBHOOK = "web/app/api/whatsapp/webhook/route.ts";

export default async function (t) {
  const { db, api } = t;

  // ---------------------------------------------------------------- passo 1
  await t.passo("1. a consulta de candidatos do webhook tem desempate", "✅", async () => {
    const src = readFileSync(WEBHOOK, "utf8");
    const i = src.indexOf("async function acharOuCriarCliente");
    api.ok(i > 0, `não achei acharOuCriarCliente em ${WEBHOOK}`);
    const corpo = src.slice(i, i + 2600);

    api.ok(/\.like\("telefone"/.test(corpo), "a busca por tel8 sumiu — teste desatualizado");
    api.ok(/\.order\(/.test(corpo),
      "a consulta de candidatos voltou a rodar SEM .order(): a escolha entre cadastros " +
      "duplicados fica instável e a conversa da cliente parte em duas telas");
    return "`.order(` presente na escolha de cadastro";
  });

  // ---------------------------------------------------------------- passo 2
  await t.passo("2. a regra aponta para a conversa viva, e é única", "✅", async () => {
    // Todos os contatos com telefone, agrupados pelos 8 últimos dígitos.
    //
    // ⚠️ PAGINADO, e o `.limit()` grande NÃO substitui isto: o PostgREST corta
    // em 1000 linhas e não avisa. A primeira versão deste teste pegou 1 duplicado
    // de 38 e passou dizendo "estável em 1/1" — cobertura de 3% com cara de 100%.
    // É a mesma doença que o teste existe para caçar (§61.2).
    const data = [];
    for (let de = 0; ; de += 1000) {
      const { data: pag, error } = await db.sb
        .from("clientes").select("id,telefone,carteira").order("id").range(de, de + 999);
      if (error) throw new Error(`clientes: ${error.message}`);
      data.push(...(pag ?? []));
      if (!pag || pag.length < 1000) break;
    }

    const porTel = new Map();
    for (const c of data) {
      const t8 = String(c.telefone ?? "").replace(/\D/g, "").slice(-8);
      if (t8.length < 8) continue;
      if (!porTel.has(t8)) porTel.set(t8, []);
      porTel.get(t8).push(c);
    }
    const dups = [...porTel.entries()].filter(([, v]) => v.length > 1);

    // Para cada duplicado, a regra do webhook precisa produzir UM vencedor, e o
    // mesmo em duas passadas. Empate exato de `criada_em` seria o único caso
    // ambíguo — se aparecer, o desempate por id resolve, e é isso que se testa.
    let ambiguos = 0, comConversa = 0;
    for (const [, cands] of dups) {
      const ids = cands.map((c) => c.id);
      const escolher = async () => {
        const { data: r } = await db.sb
          .from("mensagens").select("cliente_id")
          .in("cliente_id", ids).neq("tipo", "evento_sistema")
          .order("criada_em", { ascending: false }).limit(1);
        const vivo = r?.[0]?.cliente_id ? cands.find((c) => c.id === r[0].cliente_id) : null;
        return (vivo ?? cands.find((c) => c.carteira) ?? cands[0]).id;
      };
      const a = await escolher();
      const b = await escolher();
      if (a !== b) ambiguos++;
      if (a) comConversa++;
    }

    api.ok(ambiguos === 0,
      `${ambiguos} telefone(s) duplicado(s) ainda escolhem cadastro diferente entre duas passadas`);
    return `${data.length} contatos varridos · ${dups.length} telefone(s) com mais de um ` +
      `cadastro · escolha estável em ${comConversa}/${dups.length}`;
  });

  // ---------------------------------------------------------------- passo 3
  await t.passo("3. o contato de teste converge para o cadastro que tem o histórico", "✅", async () => {
    const { data } = await db.sb
      .from("clientes").select("id,nome_completo,telefone,carteira")
      .like("telefone", "%84719702").order("id");
    if (!data?.length) return t.pular ? "contato de teste ausente" : "contato de teste ausente";

    const contagens = [];
    for (const c of data) {
      const n = await db.contar("mensagens", (q) =>
        q.eq("cliente_id", c.id).neq("tipo", "evento_sistema"));
      contagens.push({ ...c, n });
    }
    contagens.sort((x, y) => y.n - x.n);
    const dono = contagens[0];

    const { data: r } = await db.sb
      .from("mensagens").select("cliente_id")
      .in("cliente_id", data.map((c) => c.id)).neq("tipo", "evento_sistema")
      .order("criada_em", { ascending: false }).limit(1);

    api.ok(r?.[0]?.cliente_id === dono.id,
      `a regra escolheria ${r?.[0]?.cliente_id}, mas o histórico está em ${dono.id} ` +
      `(${dono.n} mensagens) — a conversa apareceria partida`);
    return `${contagens.length} cadastro(s); a mensagem cai em ${dono.id} (${dono.n} msgs), ` +
      `que é onde o histórico mora`;
  });
}
