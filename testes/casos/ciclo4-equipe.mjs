// -----------------------------------------------------------------------------
// Ciclo 4 — transferência e trabalho em equipe.
//
// Duas sessões simultâneas (§5 da definição): duas abas de Chrome com cookies
// diferentes, para exercitar a presença "👀 fulano está aqui" e a transferência.
// -----------------------------------------------------------------------------
import { espera } from "../ajuda.mjs";

export const ciclo = "Ciclo 4 — transferência e trabalho em equipe";

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(ciclo inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  // alvo: uma conversa da carteira romulo com atividade (para as duas abas abrirem a mesma)
  const { data: cands } = await db.sb.from("vw_funil_visivel")
    .select("cliente_id,cliente,vendedor").eq("vendedor", "romulo")
    .not("ultima_atividade", "is", null).order("ultima_atividade", { ascending: false }).limit(1);
  const alvo = cands?.[0];
  if (!alvo) { t.pular("(ciclo inteiro)", "✅", "nenhuma conversa da carteira romulo com atividade"); return; }

  // ------------------------------------------------------------------ passo 1
  await t.passo("1. atendente A assume a conversa", "✅", async () => {
    const r = await api.get("/api/chat", api.SESSOES.romulo);
    api.status(r, 200, "lista do chat de A");
    const c = r.json.conversas.find((x) => x.cliente_id === alvo.cliente_id);
    api.ok(c, "a conversa alvo não está na lista de A");
    api.igual(c.vendedor, "romulo", "dono efetivo");
    return `${alvo.cliente} está com romulo`;
  });

  // ------------------------------------------------------------------ passo 2
  await t.passo("2. atendente B abre a mesma conversa — aparece '👀 fulano está aqui'", "✅", async () => {
    let chrome;
    try { chrome = await t.chrome(); } catch (e) { throw new Error(String(e.message)); }
    void chrome;

    // ⚠️ ISOLADAS, nao t.aba(): abas comuns dividem o jarro de cookies, entao o
    // login de B derruba o de A e as duas viram a MESMA pessoa. Foi assim que
    // este passo acusou defeito de presenca que nao existia (27/08/2026).
    const abaA = await t.abaIsolada();
    const abaB = await t.abaIsolada();
    try {
      await abaA.cookies(api.SESSOES.romulo);
      await abaB.cookies({ crm_sessao: "admin", crm_email: "outra.pessoa@muranoprofessional.com.br" });
      const url = `${api.BASE}/chat?cliente=${encodeURIComponent(alvo.cliente_id)}`;
      await abaA.ir(url, { esperar: 9000 });
      await abaB.ir(url, { esperar: 9000 });

      // Antes de julgar a presenca, PROVE que sao duas pessoas. Sem isto, uma
      // colisao de sessao vira "a presenca nao funciona" — diagnostico errado
      // que manda alguem consertar o que esta certo.
      const quem = async (aba) => {
        const r = await aba.enviar("Network.getCookies", { urls: [api.BASE] });
        const c = (r.cookies || []).find((x) => x.name === "crm_sessao");
        return c ? c.value : null;
      };
      const [sA, sB] = [await quem(abaA), await quem(abaB)];
      api.ok(sA === "romulo" && sB === "admin",
        `as duas abas precisam ser pessoas diferentes — A=${sA} B=${sB} (colisao de cookie: use abaIsolada)`);

      // a presença viaja por Realtime; dá um tempo para o broadcast circular
      const viu = await abaA.ate(
        `/est\\u00e1 aqui|esta aqui/i.test(document.body.textContent||'')`, { ms: 25_000 },
      );
      const foto = await abaA.foto("ciclo4_presenca_abaA");
      api.ok(viu,
        `a aba A não mostrou o aviso de presença depois de 25 s com a aba B na mesma conversa — foto ${foto}`);
      return `presença detectada na aba A · foto ${foto.split(/[\\/]/).pop()}`;
    } finally {
      for (const a of [abaA, abaB]) { try { await a.enviar("Page.close"); } catch {} }
    }
  });

  // ------------------------------------------------------------------ passo 3
  await t.passo("3. A transfere para C, com motivo, e a passagem fica na thread", "✅", async () => {
    const { data: destinos } = await db.sb.from("carteira_config")
      .select("slug").eq("ativo", true).neq("slug", "romulo").limit(1);
    const C = destinos?.[0]?.slug;
    if (!C) throw new Error("PULAR:não há outra carteira ativa para receber a transferência");

    const motivo = "[QA] teste automatizado de transferência";
    const r = await api.post("/api/chat/transferir",
      { cliente_id: alvo.cliente_id, para: C, observacao: motivo }, api.SESSOES.romulo);
    api.status(r, 200, `transferir para ${C}`);
    const id1 = r.json?.transferencia?.id;
    db.anotarRastro(`chat_transferencia #${id1} (QA -> ${C})`, async (x) => { await x.from("chat_transferencia").delete().eq("id", id1); });
    api.igual(r.json.transferencia.para_carteira, C, "destino gravado");
    api.igual(r.json.transferencia.de_carteira, "romulo", "origem gravada");

    // a passagem aparece na thread, no ponto em que aconteceu
    const th = await api.get(`/api/chat/thread?cliente_id=${encodeURIComponent(alvo.cliente_id)}`, api.SESSOES.admin);
    api.status(th, 200, "thread depois da transferência");
    const tr = (th.json?.transferencias ?? []).find((x) => x.id === id1);
    api.ok(tr, "a transferência não aparece na thread");
    api.igual(tr.observacao, motivo, "o motivo não foi gravado");

    // a conversa saiu da mão de A
    const rl = await api.get("/api/chat", api.SESSOES.romulo);
    api.ok(!rl.json.conversas.some((x) => x.cliente_id === alvo.cliente_id),
      "depois de transferir, a conversa continua na lista de quem transferiu");

    // e um vendedor não tira conversa da mão do outro
    const roubo = await api.post("/api/chat/transferir",
      { cliente_id: alvo.cliente_id, para: "romulo" }, api.SESSOES.romulo);
    api.status(roubo, 403, "romulo puxando de volta conversa que agora é de outro");

    // devolve para romulo (admin pode), restaurando o estado
    const volta = await api.post("/api/chat/transferir",
      { cliente_id: alvo.cliente_id, para: "romulo", observacao: "[QA] restaurando" }, api.SESSOES.admin);
    api.status(volta, 200, "restaurar para romulo");
    const id2 = volta.json?.transferencia?.id;
    db.anotarRastro(`chat_transferencia #${id2} (QA restaurar)`, async (x) => { await x.from("chat_transferencia").delete().eq("id", id2); });

    return `romulo -> ${C} (#${id1}) com motivo na thread; 403 ao tentar puxar de volta; restaurado (#${id2})`;
  });

  // ------------------------------------------------------------------ passo 4
  await t.passo("4. transferir para um TIME (GC), não para uma pessoa", "⛔", async () => {
    const r = await api.post("/api/chat/transferir",
      { cliente_id: alvo.cliente_id, para: "GC" }, api.SESSOES.admin);
    api.status(r, 400, "transferir para um time deveria ser recusado");
    api.ok(/carteira ativa/i.test(String(r.json?.error ?? "")),
      `a recusa não explica o motivo: ${JSON.stringify(r.json)}`);
    return `confirmado ⛔: destino tem de ser carteira de \`carteira_config\` (HTTP ${r.status}: ${r.json.error}). ` +
      `\`carteira_config.time\` existe (IS/ISR/GC) mas não é destino de transferência.`;
  });

  // ------------------------------------------------------------------ passo 5
  await t.passo("5. devolver a conversa para a fila, sem escolher ninguém", "⛔ (o doc diz que não existe)", async () => {
    // §56 / migration 0112. O documento está DESATUALIZADO — isto funciona.
    // Aqui só provo o contrato; o round trip completo está no Ciclo 1, passo 2-3.
    const r = await api.post("/api/chat/transferir",
      { cliente_id: alvo.cliente_id, devolver: true }, api.SESSOES.admin);

    if (r.status === 422) {
      // resposta correta para cliente COM dono comercial: devolver criaria órfão
      api.ok(/carteira de/i.test(String(r.json?.error ?? "")), `422 sem explicação: ${JSON.stringify(r.json)}`);
      return `⚠️ o documento marca ⛔ e o recurso EXISTE (0112). Aqui devolveu 422 com o recado certo — ` +
        `este cliente tem dono comercial (carteira ${alvo.vendedor}), e devolver criaria um órfão. ` +
        `A devolução de verdade está exercitada no Ciclo 1, passo 2-3.`;
    }
    api.status(r, 200, "devolver");
    const id = r.json?.transferencia?.id;
    db.anotarRastro(`chat_transferencia #${id} (QA devolver)`, async (x) => { await x.from("chat_transferencia").delete().eq("id", id); });
    api.igual(r.json.transferencia.para_carteira, null, "devolver gravou destino não-nulo");
    return `⚠️ DESATUALIZADO no documento: devolver para a fila existe (0112) e gravou destino NULO`;
  });

  // ------------------------------------------------------------------ passo 6
  await t.passo("6. histórico de transferências é append-only, com motivo", "✅", async () => {
    const { data } = await db.sb.from("chat_transferencia")
      .select("id,cliente_id,de_carteira,para_carteira,por,observacao,criada_em")
      .eq("cliente_id", alvo.cliente_id).order("criada_em", { ascending: true });
    api.ok((data ?? []).length >= 2, `esperava ao menos as 2 linhas do passo 3, achei ${(data ?? []).length}`);
    // append-only: a vigente é a última, e as anteriores continuam lá
    const { data: vig } = await db.sb.from("vw_chat_atribuicao")
      .select("para_carteira").eq("cliente_id", alvo.cliente_id).maybeSingle();
    api.igual(vig?.para_carteira, data[data.length - 1].para_carteira,
      "a atribuição vigente não é a última linha do histórico");
    return `${data.length} passagens registradas; vigente = última (${vig?.para_carteira}) — nada foi apagado`;
  });
}
