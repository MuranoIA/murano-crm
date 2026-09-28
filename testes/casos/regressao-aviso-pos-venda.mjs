// -----------------------------------------------------------------------------
// Regressão — o aviso automático de transferência para o pós-venda (0138).
//
// Pedido do usuário em 14/09/2026: "quando o consultor transferir para a tati
// (pós-venda), enviar uma mensagem informando isso para a cliente".
//
// ⚠️ ESTE É O PRIMEIRO MECANISMO DO CHAT QUE MANDA MENSAGEM PARA CLIENTE SEM
// NINGUÉM CLICAR EM ENVIAR. Os outros dois automáticos — a resposta de fora do
// horário e o aviso de pausa — nasceram desligado e atrás de um botão. Este
// nasce ligado, então o que decide se ele está certo não é o build: é exercitar
// os quatro desfechos e conferir o que foi (e o que NÃO foi) para o banco.
//
// Os quatro, e por que cada um existe:
//
//   janela aberta      -> envia          (o caso pedido)
//   já avisada         -> NÃO envia      a transferência vale nos dois sentidos
//                                        desde 09/09; sem trava, a conversa que
//                                        sobe e desce repete o mesmo recado
//   janela fechada     -> NÃO envia,     medido: 1 em cada 5. Fora da janela a
//                        e DIZ na tela   Meta recusa mensagem livre, e calar
//                                        prometeria um aviso que não houve
//   destino comum      -> NÃO envia      transferir entre consultores nunca
//                                        avisou a cliente, e não passa a avisar
//
// O envio é interceptado por `SIMULACAO_ENVIO=1` — nada chega a WhatsApp
// nenhum. O que se mede é a decisão, que é onde mora o defeito possível.
// -----------------------------------------------------------------------------

import * as sim from "../simulacao.mjs";

export const ciclo = "Regressão — aviso de transferência para o pós-venda";

const POS_VENDA = "u:tatianaalves@muranoprofessional.com.br";

/** As mensagens automáticas desta conversa. É o que prova o envio — e, nos três
 *  casos em que não deve haver envio, é o que prova o silêncio. */
async function autosDe(db, clienteId) {
  const { data } = await db.sb
    .from("mensagens").select("id,conteudo,criada_em")
    .eq("cliente_id", clienteId).eq("tipo", "auto")
    .order("criada_em", { ascending: true });
  return data ?? [];
}

async function transferir(api, sessao, cliente_id, para) {
  const r = await api.chamar("/api/chat/transferir", {
    metodo: "POST", sessao, corpo: { cliente_id, para },
  });
  return r;
}

export default async function (t) {
  const { api, db } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  // Índices próprios, longe dos usados pelos outros casos.
  const ABERTA = 71, FECHADA = 72, COMUM = 73;
  const idDe = (i) => sim.idFicticio(i);
  let linha = null;
  let textoConfig = "";

  await t.passo("0. o mecanismo está ligado e tem texto", "✅", async () => {
    const { data } = await db.sb.from("crm_config").select("*").eq("id", 1).maybeSingle();
    if (!data) throw new Error("crm_config sem linha 1");
    if (data.aviso_pos_venda_ativo === false) throw new Error("o mecanismo está DESLIGADO — o caso não mede nada assim");
    textoConfig = String(data.aviso_pos_venda_texto ?? "").trim();
    if (textoConfig.length < 10) throw new Error("o texto do aviso está vazio — falta aplicar a 0138?");
    linha = await sim.resolverLinha(db);
    return `ligado · ${textoConfig.length} caracteres de texto · trava de ${data.aviso_pos_venda_horas}h`;
  });

  // ---- 1. o caso pedido ---------------------------------------------------
  await t.passo("1. janela ABERTA: a cliente é avisada, e a mensagem fica na conversa", "✅", async () => {
    await sim.clienteEscreve(ABERTA, "oi, queria falar do meu pedido", "Cliente Ensaio 71", linha);
    await sim.espera(1200);

    // o consultor pega da fila (de = ninguém) — e isto NÃO pode avisar
    const pegar = await transferir(api, api.SESSOES.romulo, idDe(ABERTA), "romulo");
    if (pegar.status !== 200) throw new Error(`pegar da fila devolveu ${pegar.status}: ${pegar.texto?.slice(0, 120)}`);
    const autosAposPegar = await autosDe(db, idDe(ABERTA));
    if (autosAposPegar.length) {
      throw new Error(`puxar da fila avisou a cliente (${autosAposPegar.length}) — não devia: ninguém a estava atendendo`);
    }

    // agora sim: de alguém PARA o pós-venda
    const r = await transferir(api, api.SESSOES.romulo, idDe(ABERTA), POS_VENDA);
    if (r.status !== 200) throw new Error(`transferir devolveu ${r.status}: ${r.texto?.slice(0, 160)}`);
    if (!/avisada/i.test(String(r.json?.aviso ?? ""))) {
      throw new Error(`a tela não recebeu o recado de que avisou. aviso="${r.json?.aviso ?? "(nenhum)"}"`);
    }

    const autos = await autosDe(db, idDe(ABERTA));
    if (autos.length !== 1) throw new Error(`esperava 1 mensagem automática, achei ${autos.length}`);
    if (autos[0].conteudo !== textoConfig) {
      throw new Error("a mensagem enviada não é o texto de crm_config — alguém cravou texto no código?");
    }

    // a marca vive na linha da transferência, não numa mensagem
    const { data: tr } = await db.sb
      .from("chat_transferencia").select("id,para_carteira,avisada_em")
      .eq("cliente_id", idDe(ABERTA)).order("criada_em", { ascending: false }).limit(1);
    if (!tr?.[0]?.avisada_em) throw new Error("a transferência não ficou marcada como avisada");
    if (tr[0].para_carteira !== POS_VENDA) throw new Error(`destino gravado errado: ${tr[0].para_carteira}`);

    return `avisou · recado na tela: "${String(r.json.aviso).slice(0, 60)}…"`;
  });

  // ---- 2. a trava ---------------------------------------------------------
  await t.passo("2. vai e volta: a cliente NÃO ouve o mesmo recado duas vezes", "✅", async () => {
    // o pós-venda devolve para o consultor…
    const volta = await transferir(api, api.SESSOES.admin, idDe(ABERTA), "romulo");
    if (volta.status !== 200) throw new Error(`devolver devolveu ${volta.status}: ${volta.texto?.slice(0, 120)}`);
    // …e o consultor passa de novo
    const denovo = await transferir(api, api.SESSOES.admin, idDe(ABERTA), POS_VENDA);
    if (denovo.status !== 200) throw new Error(`transferir de novo devolveu ${denovo.status}`);

    const autos = await autosDe(db, idDe(ABERTA));
    if (autos.length !== 1) {
      throw new Error(`a cliente recebeu ${autos.length} avisos — a trava de 12h não segurou`);
    }
    // silêncio de propósito: um recado a cada transferência viraria ruído
    if (denovo.json?.aviso) throw new Error(`a tela recebeu recado onde devia calar: "${denovo.json.aviso}"`);
    return "1 aviso no total, depois de 3 transferências";
  });

  // ---- 3. o caso que a medição achou --------------------------------------
  await t.passo("3. janela FECHADA: não envia, e DIZ que não enviou", "✅", async () => {
    await sim.clienteEscreve(FECHADA, "oi", "Cliente Ensaio 72", linha);
    await sim.espera(1200);

    // recua a fala da cliente para 30h atrás: a janela de 24h fechou
    const trintaHoras = new Date(Date.now() - 30 * 3600_000).toISOString();
    const { error: eUp } = await db.sb.from("mensagens")
      .update({ criada_em: trintaHoras })
      .eq("cliente_id", idDe(FECHADA)).eq("enviada_por", "customer");
    if (eUp) throw new Error(`não consegui recuar a mensagem: ${eUp.message}`);

    const pegar = await transferir(api, api.SESSOES.romulo, idDe(FECHADA), "romulo");
    if (pegar.status !== 200) throw new Error(`pegar devolveu ${pegar.status}`);
    const r = await transferir(api, api.SESSOES.romulo, idDe(FECHADA), POS_VENDA);
    if (r.status !== 200) throw new Error(`transferir devolveu ${r.status}: ${r.texto?.slice(0, 160)}`);

    const autos = await autosDe(db, idDe(FECHADA));
    if (autos.length) throw new Error(`enviou ${autos.length} mensagem(ns) fora da janela de 24h`);

    const aviso = String(r.json?.aviso ?? "");
    if (!/NÃO foi avisada/i.test(aviso)) {
      throw new Error(`a tela não avisou que a cliente ficou sem aviso. aviso="${aviso || "(nenhum)"}"`);
    }
    if (!/template/i.test(aviso)) {
      throw new Error("o recado não diz o que fazer — sem a saída pelo template ele só informa o problema");
    }
    return `não enviou, e a tela disse: "${aviso.slice(0, 70)}…"`;
  });

  // ---- 4. quem não é pós-venda --------------------------------------------
  await t.passo("4. transferir entre consultores continua sem avisar ninguém", "✅", async () => {
    await sim.clienteEscreve(COMUM, "oi", "Cliente Ensaio 73", linha);
    await sim.espera(1200);
    const pegar = await transferir(api, api.SESSOES.romulo, idDe(COMUM), "romulo");
    if (pegar.status !== 200) throw new Error(`pegar devolveu ${pegar.status}`);
    const r = await transferir(api, api.SESSOES.romulo, idDe(COMUM), "kamilly");
    if (r.status !== 200) throw new Error(`transferir devolveu ${r.status}: ${r.texto?.slice(0, 160)}`);

    const autos = await autosDe(db, idDe(COMUM));
    if (autos.length) throw new Error(`avisou a cliente numa transferência entre consultores (${autos.length})`);
    if (r.json?.aviso) throw new Error(`a tela recebeu recado onde devia calar: "${r.json.aviso}"`);
    return "silêncio, como antes";
  });

  // ---- 5. o interruptor ---------------------------------------------------
  await t.passo("5. desligado em /admin, para de enviar", "✅", async () => {
    // `mexerConfig` já agenda a volta do valor anterior no rastro do harness —
    // é o que garante que um interruptor de produção mexido aqui não fique
    // mexido se o caso estourar no meio.
    await db.mexerConfig({ aviso_pos_venda_ativo: false });

    const i = 74;
    await sim.clienteEscreve(i, "oi", "Cliente Ensaio 74", linha);
    await sim.espera(1200);
    const pegar = await transferir(api, api.SESSOES.romulo, idDe(i), "romulo");
    if (pegar.status !== 200) throw new Error(`pegar devolveu ${pegar.status}`);
    const r = await transferir(api, api.SESSOES.romulo, idDe(i), POS_VENDA);
    if (r.status !== 200) throw new Error(`transferir devolveu ${r.status}`);
    const autos = await autosDe(db, idDe(i));
    if (autos.length) throw new Error(`desligado e ainda enviou ${autos.length}`);
    return "desligado: nada sai, e a transferência continua funcionando";
  });
}
