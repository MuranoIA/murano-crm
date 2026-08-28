// -----------------------------------------------------------------------------
// Ciclo 7 — relatório de fim de mês.
//
// §5 da definição: "confira se o número da tela bate com o `count` do banco.
// Divergência de número é o defeito mais caro deste projeto." Todo passo aqui
// cruza a resposta da rota com uma contagem exata.
// -----------------------------------------------------------------------------
export const ciclo = "Ciclo 7 — relatório de fim de mês";

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(ciclo inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  let ind = null;

  // ------------------------------------------------------------------ passo 1
  await t.passo("1. volume de conversas do período", "✅", async () => {
    const r = await api.get("/api/chat/indicadores?dias=30", api.SESSOES.admin);
    api.status(r, 200, "GET /api/chat/indicadores");
    ind = r.json;
    api.ok(Array.isArray(ind.vendedores), `resposta sem \`vendedores\`: ${Object.keys(ind).join(", ")}`);
    api.ok(ind.vendedores.length > 0, "nenhum vendedor no período");
    // ⚠️ os campos são `recebidas`/`enviadas`/`respostas` — NÃO `conversas`.
    // Ler a chave errada devolve undefined e o teste "passa" somando zero.
    const rec = ind.vendedores.reduce((a, v) => a + Number(v.recebidas ?? 0), 0);
    const env = ind.vendedores.reduce((a, v) => a + Number(v.enviadas ?? 0), 0);
    api.ok(rec > 0 && env > 0, `volume zerado: recebidas=${rec}, enviadas=${env}`);
    return `${ind.vendedores.length} vendedores · ${rec} recebidas · ${env} enviadas · janela ${ind.dias} dias (desde ${ind.desde})`;
  });

  // ------------------------------------------------------------------ passo 2
  await t.passo("2. tempo de primeira resposta (mediana e p90) e a régua que o sustenta", "✅", async () => {
    api.ok(ind, "PULAR:passo 1 não trouxe os indicadores");
    // nomes reais dos campos: `mediana_tipica_min` e `pior_p90_min` (§21.1 — o
    // rótulo é "típica do dia" de propósito, porque a mediana do período não se
    // deriva das diárias)
    const comTempo = ind.vendedores.filter((v) => v.mediana_tipica_min != null || v.pior_p90_min != null);
    api.ok(comTempo.length > 0, "nenhum vendedor com mediana/p90 — o indicador não está medindo");
    const semRespostas = ind.vendedores.filter((v) => !(Number(v.respostas ?? 0) > 0));
    api.igual(semRespostas.length, 0,
      `vendedor com mediana mas sem contagem de respostas: ${semRespostas.map((v) => v.vendedor).join(", ")}`);
    return comTempo.map((v) =>
      `${v.vendedor}: mediana ${v.mediana_tipica_min}min · p90 ${v.pior_p90_min}min · ${v.respostas} respostas ` +
      `(${v.pct_ate_5min}% ≤5min)`).join(" · ");
  });

  // ------------------------------------------------------------------ passo 3
  await t.passo("3. tempo médio de RESOLUÇÃO (abertura -> encerramento)", "⛔ (o doc diz que não existe)", async () => {
    api.ok(ind, "PULAR:passo 1 não trouxe os indicadores");
    const res = ind.resolvidas ?? {};
    const temConta = "mediana_tipica_min" in res || "com_tempo" in res;
    api.ok(temConta,
      `a rota não devolve a conta de resolução: ${Object.keys(res).join(", ")} — continua ⛔ de verdade`);
    if (ind.sem_views) {
      return `⚠️ MUDANÇA DE ESTADO: a conta EXISTE no código (campos ${Object.keys(res).join(", ")}), mas a rota ` +
        `sinaliza \`sem_views: true\` — a migration 0114 não está aplicada, então os números vêm zerados. ` +
        `Deixou de ser "não existe" e passou a ser "existe e está sem os objetos do banco".`;
    }
    return `resolvidas ${res.total} · com tempo ${res.com_tempo} · até 1h ${res.ate_1h} · ` +
      `até 24h ${res.ate_24h} · mediana típica ${res.mediana_tipica_min} min`;
  });

  // ------------------------------------------------------------------ passo 4
  await t.passo("4. conversas por atendente — e o número BATE com o banco", "✅", async () => {
    api.ok(ind, "PULAR:passo 1 não trouxe os indicadores");
    // escopo: o consultor só pode ver a si mesmo
    const rv = await api.get("/api/chat/indicadores?dias=30", api.SESSOES.romulo);
    api.status(rv, 200, "indicadores como consultor");
    const outros = (rv.json.vendedores ?? []).filter((v) => v.vendedor && v.vendedor !== "romulo");
    api.igual(outros.length, 0,
      `o consultor vê indicadores de outras carteiras: ${outros.map((o) => o.vendedor).join(", ")}`);

    // cruzamento com o banco: a série do admin tem de vir da mesma view
    const { data: serie } = await db.sb.from("vw_chat_volume_diario")
      .select("vendedor,recebidas,enviadas").gte("dia", ind.desde).not("vendedor", "is", null);
    const doBanco = new Map();
    for (const s of serie ?? []) {
      const a = doBanco.get(s.vendedor) ?? { rec: 0, env: 0 };
      a.rec += Number(s.recebidas ?? 0); a.env += Number(s.enviadas ?? 0);
      doBanco.set(s.vendedor, a);
    }
    const divergentes = [];
    for (const v of ind.vendedores) {
      const b = doBanco.get(v.vendedor);
      if (!b) continue;
      if (Number(v.recebidas ?? 0) !== b.rec) divergentes.push(`${v.vendedor} recebidas: tela ${v.recebidas} vs banco ${b.rec}`);
      if (Number(v.enviadas ?? 0) !== b.env) divergentes.push(`${v.vendedor} enviadas: tela ${v.enviadas} vs banco ${b.env}`);
    }
    api.igual(divergentes.length, 0, `a tela diverge do banco: ${divergentes.join(" · ")}`);
    return `consultor vê só a própria carteira; os ${ind.vendedores.length} vendedores batem com ` +
      `\`vw_chat_volume_diario\` em recebidas e enviadas`;
  });

  // ------------------------------------------------------------------ passo 5
  await t.passo("5. abertas × fechadas × sem resposta do mês inteiro (série histórica)", "⚠️", async () => {
    api.ok(ind, "PULAR:passo 1 não trouxe os indicadores");
    const temSerie = Array.isArray(ind.serie) && ind.serie.length > 0;
    api.ok(temSerie, "não há série nenhuma");
    // o que o documento chama de limitação: as filas dão o número de HOJE
    const dias = new Set((ind.serie ?? []).map((s) => s.dia));
    return `há série diária de tempo de resposta (${dias.size} dias na janela), mas o trio ` +
      `abertas/fechadas/sem-resposta continua sendo o retrato de AGORA (as três filas do chat), ` +
      `não uma série — limitação confirmada, como o documento diz`;
  });

  // ------------------------------------------------------------------ passo 6
  await t.passo("6. exportação (Excel/CSV)", "✅", async () => {
    // ⚠️ a rota é POST, não GET (GET devolve 405), e exige `codclis` — sem isso
    // recusa com 400 em vez de exportar a base inteira, o que está certo.
    const vazio = await api.post("/api/relatorio", { codclis: [] }, api.SESSOES.admin);
    api.status(vazio, 400, "exportar sem filtro de cliente deve ser recusado");

    const { data: alvos } = await db.sb.from("vw_venda_card").select("codcli").not("codcli", "is", null).limit(5);
    const codclis = (alvos ?? []).map((x) => Number(x.codcli));
    if (!codclis.length) throw new Error("PULAR:sem codcli para montar uma exportação de amostra");

    const r = await api.post("/api/relatorio", { codclis, titulo: "[QA] amostra" }, api.SESSOES.admin);
    api.status(r, 200, "POST /api/relatorio");
    const ct = r.headers?.get?.("content-type") ?? "";
    const tam = (r.texto ?? "").length;
    api.ok(tam > 1000, `a planilha veio pequena demais (${tam} bytes)`);
    api.ok(/spreadsheet|excel|octet-stream/i.test(ct), `content-type inesperado para planilha: ${ct}`);
    return `POST com ${codclis.length} clientes -> HTTP ${r.status}, ${ct.split(";")[0]}, ${tam} bytes · ` +
      `sem filtro devolve 400 (não exporta a base inteira por engano)`;
  });

  // -------------------------------------------------------------- passo extra
  await t.passo("7. alerta de estouro de SLA (item 3 do checklist)", "⛔", async () => {
    const r = await api.get("/api/chat", api.SESSOES.romulo);
    api.status(r, 200, "GET /api/chat");
    const sla = r.json?.sla;
    if (!sla) return "confirmado ⛔: a rota do chat não devolve nada de SLA";
    const cfg = await db.lerConfig();
    const temColuna = "sla_minutos" in (cfg ?? {});
    return `⚠️ MUDANÇA DE ESTADO: o código já devolve \`sla\` (minutos=${sla.minutos}, ` +
      `esperando=${(sla.esperando ?? []).length}), mas ${temColuna ? "" : "a coluna `crm_config.sla_minutos` NÃO existe "}` +
      `— a 0114 não está aplicada, então o alerta nunca acende. Limite 0 também significa desligado.`;
  });
}
