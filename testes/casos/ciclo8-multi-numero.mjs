// -----------------------------------------------------------------------------
// Ciclo 8 — multi-número.
//
// O ponto do teste é a CONFUSÃO SILENCIOSA (§5 da definição): a cliente escreve
// para um número e recebe de outro, sem ninguém perceber que a rota está errada.
//
// ⚠️ O passo 4 escreve em `crm_config.numero_envio`, que é interruptor GLOBAL.
// Leio e anoto o valor antes, e restauro no fim mesmo se o teste falhar no meio
// (o rastro do runner faz isso). §0 / §60.7.
// -----------------------------------------------------------------------------
export const ciclo = "Ciclo 8 — multi-número (recebe por vários, envia por um)";

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(ciclo inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  // ---------------------------------------------------------------- passos 1-2
  await t.passo("1-2. o webhook carimba a linha de origem em cada mensagem", "✅", async () => {
    const { data: linhas } = await db.sb.from("chat_linha")
      .select("phone_number_id,rotulo,numero,ativo").order("rotulo");
    const porLinha = [];
    for (const l of linhas ?? []) {
      const n = l.phone_number_id === "rd"
        ? await db.contar("mensagens", (q) => q.is("linha_id", null))
        : await db.contar("mensagens", (q) => q.eq("linha_id", l.phone_number_id));
      porLinha.push({ ...l, n });
    }
    const comTrafego = porLinha.filter((p) => p.n > 0);
    api.ok(comTrafego.length >= 2,
      `só ${comTrafego.length} linha(s) com tráfego — não dá para afirmar que o multi-número recebe por várias`);
    return porLinha.map((p) => `${p.rotulo} (${p.phone_number_id}${p.ativo ? "" : ", inativa"}): ${p.n}`).join(" · ");
  });

  // ------------------------------------------------------------------ passo 3
  await t.passo("3. a resposta sai pelo número GLOBAL, não pelo que recebeu", "⚠️", async () => {
    const cfg = await db.lerConfig();
    // `canalDeResposta` (lib/whatsapp.ts): wa:* -> cloud; senão numero_envio;
    // senão o canal da última mensagem recebida.
    const escolha = cfg.numero_envio;
    // Uma conversa que veio por uma linha Cloud inativa (o piloto) seria
    // respondida pela linha da env — este é o cenário de confusão.
    const { data: outras } = await db.sb.from("mensagens")
      .select("cliente_id,linha_id").not("linha_id", "is", null)
      .neq("linha_id", "1264458800091787").limit(50);
    const conversasEmOutraLinha = new Set((outras ?? []).map((m) => m.cliente_id));

    return `\`crm_config.numero_envio\` = ${JSON.stringify(escolha)} (global, do admin). ` +
      `${conversasEmOutraLinha.size} conversa(s) chegaram por uma linha Cloud diferente da linha de envio — ` +
      `essas seriam respondidas pelo número atual, e na tela da cliente isso é uma CONVERSA NOVA ` +
      `(a janela de 24h é por número, §28.6). Limitação confirmada: a escolha é global, não por conversa.`;
  });

  // ------------------------------------------------------------------ passo 4
  await t.passo("4. trocar o número de envio em /admin — e ele vale para todo mundo", "✅", async () => {
    const antes = await db.lerConfig();
    const original = antes?.numero_envio ?? null;

    // troca via a MESMA rota que o admin usa (não direto no banco): é o caminho
    // real, e foi onde a §37.5 achou um bug que só o teste de ponta pegou.
    const alvo = original === "cloud" ? "rd" : "cloud";
    db.anotarRastro(`crm_config.numero_envio -> restaurar ${JSON.stringify(original)}`, async (c) => {
      const { error } = await c.from("crm_config").update({ numero_envio: original }).eq("id", 1);
      if (error) throw new Error(error.message);
    });

    const put = await api.chamar("/api/admin/crm-config", {
      metodo: "PUT", sessao: api.SESSOES.admin, corpo: { chave: "numero_envio", valor: alvo },
    });
    api.statusEntre(put, [200], `PUT numero_envio=${alvo}`);

    const depois = await db.lerConfig();
    api.igual(depois.numero_envio, alvo,
      `a tela salvou e o banco NÃO mudou — é o bug da §37.5 (extração do valor caindo no fallback) de volta`);

    // e a decisão de canal acompanha na hora
    const th = await api.get("/api/chat/thread?cliente_id=6a66af9224e3f7ae2f1e99a7", api.SESSOES.romulo);
    api.status(th, 200, "thread depois da troca");
    const canal = th.json?.canal_envio;

    // restaura JÁ (não só no rastro), para a janela de exposição ser mínima
    const volta = await api.chamar("/api/admin/crm-config", {
      metodo: "PUT", sessao: api.SESSOES.admin, corpo: { chave: "numero_envio", valor: original },
    });
    api.statusEntre(volta, [200], "restaurar numero_envio");
    const fim = await db.lerConfig();
    api.igual(fim.numero_envio, original, "NÃO consegui restaurar o interruptor global — restaure à mão");

    return `${JSON.stringify(original)} -> ${alvo} gravou de verdade (canal da thread virou ${JSON.stringify(canal)}) ` +
      `e foi restaurado para ${JSON.stringify(original)}. É GLOBAL: vale para os 15 acessos, não por conversa.`;
  });

  // -------------------------------------------------------------- passo extra
  await t.passo("5. o seletor de linhas visíveis não cega o disparo em massa", "✅", async () => {
    // §31.2 -> §26: esconder não pode virar agir sem saber. Hoje a decisão é a
    // oposta (o disparo lê a view filtrada), e o que importa é que os dois
    // concordem — se o board esconde e a campanha aborda, ninguém entende.
    const cfg = await db.lerConfig();
    const r = await api.post("/api/admin/disparo-massa",
      { acao: "previa", filtros: { carteiras: [], diasMin: 0, diasRecontato: 0, limite: 5 } }, api.SESSOES.admin);
    api.status(r, 200, "prévia");
    const total = r.json?.total;
    const naView = await db.contar("vw_funil_visivel");
    return `linhas visíveis = ${JSON.stringify(cfg.linhas_visiveis)} · a prévia partiu de ${total} candidatos ` +
      `contra ${naView} na view da tela — o disparo enxerga o mesmo universo que o board (§26 reverteu a §31.2)`;
  });
}
