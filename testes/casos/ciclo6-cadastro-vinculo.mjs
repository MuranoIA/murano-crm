// -----------------------------------------------------------------------------
// Ciclo 6 — cadastro e vínculo de contato (a ponte chat -> ERP).
//
// O passo 3 (vínculo automático) roda no `pg_cron` a cada 10 minutos
// (`wth_reconciliar_vinculos()`, §10.5). NÃO espero resultado imediato — o teste
// mede o mecanismo e a cobertura atual, e diz isso.
// -----------------------------------------------------------------------------
import { NUMERO_AUTORIZADO_E164, TEL8_AUTORIZADO, exigirDestinoAutorizado } from "../ajuda.mjs";

export const ciclo = "Ciclo 6 — cadastro e vínculo de contato";

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(ciclo inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  // ------------------------------------------------------------------ passo 1
  await t.passo("1. número novo sem cadastro: o webhook cria contato `wa:` sem carteira", "✅", async () => {
    // Não invento número (criaria lixo). Confirmo o mecanismo pelos contatos
    // `wa:` que já existem: id sintético, e os sem carteira caem na fila.
    const { data: wa } = await db.sb.from("clientes")
      .select("id,nome_completo,telefone,carteira").like("id", "wa:%").limit(400);
    api.ok((wa ?? []).length > 0, "não há nenhum contato `wa:` — o mecanismo nunca foi usado");
    const semCarteira = (wa ?? []).filter((c) => !c.carteira).length;
    // o id sintético tem de ser estável por telefone, senão a mesma pessoa
    // viraria dois contatos a cada mensagem
    const incoerentes = (wa ?? []).filter((c) => c.id !== `wa:${String(c.telefone ?? "").replace(/\D/g, "")}`);
    api.igual(incoerentes.length, 0,
      `${incoerentes.length} contato(s) \`wa:\` cujo id não corresponde ao telefone — o id sintético não é estável`);
    return `${wa.length} contatos \`wa:\` · ${semCarteira} sem carteira (vão para a fila de não atribuídos)`;
  });

  // ------------------------------------------------------------------ passo 2
  await t.passo("2. criar contato pelo chat — normaliza, e NÃO duplica quem já existe", "✅", async () => {
    exigirDestinoAutorizado(NUMERO_AUTORIZADO_E164, "cadastro de contato");
    const antes = await db.contar("clientes");

    // número incompleto tem de ser recusado, não virar contato truncado
    const ruim = await api.post("/api/chat/novo-contato", { telefone: "9198" }, api.SESSOES.romulo);
    api.ok(ruim.status >= 400, `número incompleto foi aceito: HTTP ${ruim.status}`);

    // o número autorizado JÁ existe: tem de achar, não criar
    const r = await api.post("/api/chat/novo-contato",
      { telefone: NUMERO_AUTORIZADO_E164, nome: "QA (não deve criar)" }, api.SESSOES.romulo);
    api.status(r, 200, "cadastrar número já existente");
    const depois = await db.contar("clientes");
    api.igual(depois, antes, "cadastrar um número JÁ EXISTENTE criou contato novo — duplicata");
    api.ok(r.json?.cliente_id, "a resposta não trouxe o cliente_id da conversa existente");
    return `número incompleto recusado (HTTP ${ruim.status}); número existente reaproveitado ` +
      `(${r.json.cliente_id}) sem criar linha nova`;
  });

  // ------------------------------------------------------------------ passo 3
  await t.passo("3. vínculo automático com o ERP (CPF/telefone) — mecanismo e cobertura", "✅", async () => {
    const contatos = await db.contar("clientes");
    const vinculos = await db.contar("wth_vinculo");
    api.ok(vinculos > 0, "`wth_vinculo` está vazia — a ponte com o ERP não está funcionando");
    // borda pedida pelo documento: telefone duplicado em mais de um cadastro
    const { data: dupes } = await db.sb.from("clientes").select("id,nome_completo,telefone,carteira")
      .like("telefone", `%${TEL8_AUTORIZADO}`);
    const nota = (dupes ?? []).length > 1
      ? `⚠️ BORDA REAL: o número autorizado tem ${dupes.length} cadastros em \`clientes\` ` +
        `(${dupes.map((d) => `${d.id}/${d.carteira ?? "sem carteira"}`).join(", ")}). ` +
        `O webhook escolhe "o primeiro que tiver carteira" SEM \`order by\` — ou seja, ` +
        `a mesma mensagem pode cair em cadastros diferentes entre chamadas.`
      : "sem telefone duplicado no número autorizado";
    return `${vinculos} vínculos para ${contatos} contatos. ` +
      `O casamento roda no pg_cron a cada 10 min (wth_reconciliar_vinculos), então cadastro novo ` +
      `NÃO vincula na hora — não é defeito, é cadência. ${nota}`;
  });

  // ------------------------------------------------------------------ passo 4
  await t.passo("4. editar um dado do contato dentro da conversa", "✅", async () => {
    const { data: alvos } = await db.sb.from("clientes")
      .select("id,nome_completo,telefone,carteira").like("telefone", `%${TEL8_AUTORIZADO}`);
    const alvo = (alvos ?? []).find((c) => c.id === "6a66af9224e3f7ae2f1e99a7") ?? alvos?.[0];
    if (!alvo) throw new Error("PULAR:contato do número autorizado não encontrado");

    const original = alvo.nome_completo;
    db.anotarRastro(`clientes ${alvo.id}.nome_completo -> ${JSON.stringify(original)}`, async (c) => {
      await c.from("clientes").update({ nome_completo: original }).eq("id", alvo.id);
    });

    const novo = `${original} [QA]`;
    const r = await api.patch("/api/chat/contato", { cliente_id: alvo.id, nome: novo }, api.SESSOES.romulo);
    if (r.status === 422 || r.status === 409) {
      return `edição recusada com HTTP ${r.status}: ${JSON.stringify(r.json?.error ?? r.json)} — ` +
        `é o comportamento da §46 (cliente vinculado ao WinThor tem o nome mandado pelo ERP)`;
    }
    api.status(r, 200, "editar contato");
    const { data: dep } = await db.sb.from("clientes").select("nome_completo").eq("id", alvo.id).maybeSingle();
    api.igual(dep.nome_completo, novo, "a edição não persistiu");
    return `nome alterado e persistido (restaurado no fim para "${original}")`;
  });

  // ---------------------------------------------------------------- passos 5-6
  await t.passo("5-6. tag livre no contato e bloquear número", "⛔", async () => {
    const tabelas = ["chat_tag", "cliente_tag", "tags", "chat_bloqueio", "clientes_bloqueados"];
    const achadas = [];
    for (const s of tabelas) if ((await db.existe(s)).ok) achadas.push(s);
    api.igual(achadas.length, 0, `apareceram tabelas que o documento não previa: ${achadas.join(", ")}`);
    return "confirmado ⛔: não existem tags livres nem bloqueio de número. " +
      "O checklist (seção 9) sugere decidir se tag é mesmo necessária — carteira, etapa, status e motivo " +
      "de encerramento já classificam.";
  });

  // ------------------------------------------------------------------ passo 7
  await t.passo("7. histórico de TODAS as conversas do contato, não só a atual", "✅", async () => {
    const ID = "6a66af9224e3f7ae2f1e99a7";
    const r = await api.get(`/api/chat/thread?cliente_id=${encodeURIComponent(ID)}`, api.SESSOES.romulo);
    api.status(r, 200, "thread");
    const msgs = r.json?.mensagens ?? [];
    api.ok(msgs.length > 0, "a thread veio vazia");
    // a thread é POR CLIENTE, não por atendimento: mensagens de datas diferentes
    // convivem na mesma lista
    const dias = new Set(msgs.map((m) => String(m.criada_em ?? "").slice(0, 10)));
    return `${msgs.length} mensagens em ${dias.size} dia(s) distintos, numa thread só — ` +
      `é por cliente, não por atendimento. Histórico oculto em outra linha: ${r.json?.historico_oculto ?? 0}`;
  });
}
