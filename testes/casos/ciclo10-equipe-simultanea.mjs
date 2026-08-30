// -----------------------------------------------------------------------------
// CICLO 10 — seis consultores atendendo AO MESMO TEMPO.
//
// O que este ciclo procura, e por quê:
//
// A integração com a Meta já foi provada ponta a ponta (CLAUDE.md §28, §62).
// O que NUNCA foi exercitado é a equipe inteira dentro do sistema no mesmo
// minuto. Os defeitos desse tipo não aparecem em leitura de código nem em teste
// de um usuário — aparecem como duas pessoas donas da mesma conversa, marca de
// leitura de um apagando a do outro, ou escopo vazando.
//
// Por isso o ciclo é dividido em quatro atos:
//   1. o volume  — todo mundo trabalhando junto, medindo p50/p90 por rota
//   2. as corridas — dois consultores no MESMO gesto, no mesmo instante
//   3. o escopo   — um tentando alcançar a conversa do outro
//   4. o real     — envio de verdade para os números autorizados
// -----------------------------------------------------------------------------
import { SESSOES, chamar, get, post } from "../api.mjs";
import * as sim from "../simulacao.mjs";
import { espera } from "../ajuda.mjs";

export const ciclo = "ciclo10 — seis consultores simultâneos";

/** Quantos clientes fictícios por consultor. 4 × 6 = 24 conversas. */
const POR_CONSULTOR = 4;
/** Rodadas do laço de trabalho. Cada rodada = ~5 chamadas por consultor. */
const RODADAS = 6;

/** Números que o usuário autorizou a receber de verdade (§0 estendida). */
const AUTORIZADOS = ["5591984719702", "5591981568774", "5591998186976", "5591981086442"];
/** Teto de templates reais que o usuário aceitou pagar. */
const TETO_TEMPLATES = 20;

export default async function (t) {
  if (!t.servidorNoAr) {
    return t.pular("ciclo 10 inteiro", "✅", "servidor fora do ar em " + (process.env.CRM_BASE ?? "localhost:3100"));
  }

  const m = new sim.Metricas();
  const clientes = [];        // {i, id, dono}
  const enviadosReais = [];   // wamids de envio real, para conferir o recibo
  let templatesReais = 0;

  // =========================================================================
  // ATO 0 — as travas antes de qualquer coisa
  // =========================================================================

  await t.passo("o interceptor de envio está ligado (nada sai para a faixa fictícia)", "✅", async () => {
    // Prova por comportamento, não por leitura de env: manda uma mensagem para
    // um cliente fictício e confere que o wamid veio com o prefixo `sim.`.
    // Se a chave não estiver ligada, isto falha AQUI — antes de o ensaio ter
    // criado volume — em vez de descobrir depois que 200 mensagens saíram.
    await sim.clienteEscreve(999, "sonda do interceptor");
    const r = await post("/api/send-message", { cliente_id: sim.idFicticio(999), texto: "sonda" }, SESSOES.admin);
    if (r.status !== 200) throw new Error(`sonda não enviou: ${r.status} ${(r.texto ?? "").slice(0, 200)}`);
    const { data } = await t.db.sb.from("mensagens").select("id")
      .eq("cliente_id", sim.idFicticio(999)).eq("enviada_por", "operator").limit(1);
    const id = data?.[0]?.id ?? "";
    if (!id.startsWith("sim.")) {
      throw new Error(
        `PERIGO: o envio NÃO foi interceptado (wamid ${id.slice(0, 24)}). ` +
        `Suba o servidor com SIMULACAO_ENVIO=1 antes de rodar este ciclo.`,
      );
    }
    return "wamid simulado — a faixa fictícia está isolada da Meta";
  });

  await t.passo("a faixa fictícia não colide com cliente real", "✅", async () => {
    const tel8 = [...Array(POR_CONSULTOR * sim.CONSULTORES.length + 10).keys()]
      .map((i) => sim.telefoneFicticio(i + 1).slice(-8));
    const { data } = await t.db.sb.from("clientes").select("id,telefone").not("id", "like", sim.PADRAO_ID_FICTICIO);
    const bate = (data ?? []).filter((c) => tel8.includes(String(c.telefone ?? "").replace(/\D/g, "").slice(-8)));
    if (bate.length) throw new Error(`colisão com ${bate.length} cliente(s) real(is): ${bate.slice(0, 3).map((c) => c.id).join(", ")}`);
    return `${tel8.length} números conferidos, nenhum bate com cliente real`;
  });

  // =========================================================================
  // ATO 1 — a equipe entrando: 24 clientes escrevem, os 6 pegam da fila
  // =========================================================================

  await t.passo("24 clientes novos escrevem e viram conversa", "✅", async () => {
    const t0 = Date.now();
    const idx = [...Array(POR_CONSULTOR * sim.CONSULTORES.length).keys()].map((k) => k + 1);
    const rs = await Promise.all(idx.map((i) => sim.clienteEscreve(i, `Oi, tudo bem? Queria saber sobre progressiva. (ensaio ${i})`)));
    const ruins = rs.filter((r) => r.status !== 200);
    if (ruins.length) throw new Error(`${ruins.length} webhooks não responderam 200`);
    for (const i of idx) clientes.push({ i, id: sim.idFicticio(i), dono: null });

    const { count } = await t.db.sb.from("clientes")
      .select("*", { count: "exact", head: true }).like("id", sim.PADRAO_ID_FICTICIO);
    if ((count ?? 0) < idx.length) throw new Error(`esperava ${idx.length} clientes criados, achei ${count}`);
    return `${idx.length} conversas criadas em ${Date.now() - t0} ms (webhook simultâneo)`;
  });

  await t.passo("as 24 caem na FILA DE ESPERA (sem dono) e todo mundo as vê", "✅", async () => {
    // Contato novo sem cadastro no ERP não tem carteira: vai para a fila de não
    // atribuídos (§21), visível a todos. É o comportamento certo — e é o que
    // torna a corrida do ✋ Pegar possível, no ato 2.
    const r = await m.medir("GET /api/chat", "anne", () => get("/api/chat", sim.sessaoDe("anne")));
    if (r.status !== 200) throw new Error(`/api/chat devolveu ${r.status}`);
    const arr = r.json?.conversas ?? [];
    const nossas = arr.filter((c) => String(c.cliente_id ?? "").startsWith("wa:55919000"));
    if (nossas.length < POR_CONSULTOR * sim.CONSULTORES.length) {
      throw new Error(`a consultora enxerga só ${nossas.length} das ${POR_CONSULTOR * sim.CONSULTORES.length} conversas da fila`);
    }
    const naFila = nossas.filter((c) => c.na_fila).length;
    return `${nossas.length} na lista, ${naFila} marcadas como fila de espera`;
  });

  await t.passo("cada consultor pega 4 conversas da fila (✋ Pegar simultâneo)", "✅", async () => {
    const trabalhos = [];
    sim.CONSULTORES.forEach((slug, k) => {
      for (let j = 0; j < POR_CONSULTOR; j++) {
        const c = clientes[k * POR_CONSULTOR + j];
        c.dono = slug;
        trabalhos.push(
          m.medir("POST /api/chat/transferir", slug, () =>
            post("/api/chat/transferir", { cliente_id: c.id, para: slug }, sim.sessaoDe(slug))),
        );
      }
    });
    const rs = await Promise.all(trabalhos);
    const ruins = rs.filter((r) => r.status !== 200);
    if (ruins.length) throw new Error(`${ruins.length}/${rs.length} falharam — ex.: ${ruins[0].status} ${(ruins[0].texto ?? "").slice(0, 160)}`);
    return `${rs.length} conversas atribuídas de uma vez`;
  });

  // =========================================================================
  // ATO 2 — o volume: seis atendendo, dois supervisores olhando, clientes
  //         respondendo, tudo ao mesmo tempo
  // =========================================================================

  await t.passo(`volume: ${sim.CONSULTORES.length} consultores × ${RODADAS} rodadas + 2 supervisores + clientes respondendo`, "✅", async () => {
    const arq = sim.arquivosDeEnsaio();
    const t0 = Date.now();
    let pararSupervisao = false;

    // --- supervisores: recarregam a caixa e o board o tempo todo -----------
    const supervisao = sim.SUPERVISORES.map(async (s) => {
      while (!pararSupervisao) {
        await m.medir("GET /api/chat (supervisor)", s.rotulo, () => chamar("/api/chat", { sessao: s.sessao }));
        await m.medir("GET /api/funil (supervisor)", s.rotulo, () => chamar("/api/funil", { sessao: s.sessao }));
        await espera(1500);
      }
    });

    // --- clientes respondendo em paralelo ---------------------------------
    const conversa = async () => {
      for (let r = 0; r < RODADAS; r++) {
        await Promise.all(clientes.map(async (c, k) => {
          if ((k + r) % 3 !== 0) return;      // nem todo cliente responde toda rodada
          if (r % 2 === 0) await sim.clienteEscreve(c.i, `E quanto fica o kit? (rodada ${r})`);
          else await sim.clienteMandaMidia(c.i, k % 2 ? "image" : "audio");
        }));
        await espera(400);
      }
    };

    // --- os seis trabalhando ----------------------------------------------
    const trabalhar = async (slug) => {
      const meus = clientes.filter((c) => c.dono === slug);
      for (let r = 0; r < RODADAS; r++) {
        const c = meus[r % meus.length];
        const s = sim.sessaoDe(slug);
        await m.medir("GET /api/chat/thread", slug, () => chamar(`/api/chat/thread?cliente_id=${encodeURIComponent(c.id)}`, { sessao: s }));
        await m.medir("POST /api/send-message", slug, () =>
          chamar("/api/send-message", { metodo: "POST", sessao: s, corpo: { cliente_id: c.id, texto: `Oi! Aqui é a ${slug}. Rodada ${r} do ensaio.` } }));

        // uma mídia por rodada, alternando os três tipos que a consultora usa
        const tipo = ["imagem", "audio", "documento"][r % 3];
        await m.medir(`POST /api/chat/enviar-midia (${tipo})`, slug, () =>
          sim.enviarMidia(chamar, s, c.id, arq[tipo], tipo === "audio" ? "" : `${tipo} do ensaio`));

        await m.medir("POST /api/chat/lida", slug, () =>
          chamar("/api/chat/lida", { metodo: "POST", sessao: s, corpo: { cliente_id: c.id } }));

        if (r % 3 === 2) {
          await m.medir("POST /api/chat/notas", slug, () =>
            chamar("/api/chat/notas", { metodo: "POST", sessao: s, corpo: { cliente_id: c.id, texto: `nota interna do ensaio, rodada ${r}` } }));
        }
        await espera(250);
      }
    };

    await Promise.all([
      conversa(),
      ...sim.CONSULTORES.map(trabalhar),
    ]);
    pararSupervisao = true;
    await Promise.all(supervisao);

    const seg = ((Date.now() - t0) / 1000).toFixed(0);
    return `${m.total} chamadas em ${seg}s · pico ${m.picoPorSegundo()}/s · ${m.falhas} com erro`;
  });

  await t.passo("nenhuma mensagem de cliente foi PERDIDA (webhook pede reenvio quando falha)", "✅", async () => {
    // Antes do conserto de 30/08 o webhook respondia 200 mesmo sem gravar, e a
    // Meta nunca reenviava: a mensagem sumia. Agora ele responde 503 e o
    // simulador reenvia, como a Meta faz. Reenvio > 0 nao e defeito — e o
    // sistema se recuperando, e a medida de quantas vezes precisou.
    if (sim.reenvios.desistiu > 0) {
      throw new Error(`${sim.reenvios.desistiu} evento(s) desistiram apos 5 tentativas — mensagem perdida de verdade`);
    }
    return sim.reenvios.total
      ? `${sim.reenvios.total} reenvio(s) necessarios sob rajada, 0 perdido`
      : "nenhum reenvio foi preciso";
  });

  await t.passo("nenhuma chamada do volume falhou", "✅", async () => {
    const ruins = m.porRota().filter((r) => r.erros > 0);
    if (ruins.length) {
      throw new Error(ruins.map((r) => `${r.rota}: ${r.erros}/${r.n} — ${r.exemplos.join(" | ")}`).join("\n"));
    }
    return `${m.total} chamadas, 0 erro`;
  });

  await t.passo("latência sob carga: p90 abaixo de 3s em toda rota", "✅", async () => {
    const linhas = m.porRota();
    const lentas = linhas.filter((r) => r.p90 > 3000);
    const tabela = linhas.map((r) => `  ${r.rota}: n=${r.n} p50=${r.p50}ms p90=${r.p90}ms max=${r.max}ms`).join("\n");
    if (lentas.length) throw new Error(`rotas acima de 3s no p90:\n${tabela}`);
    return tabela;
  });

  // =========================================================================
  // ATO 3 — as corridas
  // =========================================================================

  await t.passo("CORRIDA: dois consultores pegam a MESMA conversa no mesmo instante", "⚠️", async () => {
    const r0 = await sim.clienteEscreve(900, "quero um orçamento");
    if (r0.status !== 200) throw new Error("webhook não criou o cliente da corrida");
    const alvo = sim.idFicticio(900);
    clientes.push({ i: 900, id: alvo, dono: null });

    const [a, b] = await Promise.all([
      post("/api/chat/transferir", { cliente_id: alvo, para: "anne" }, sim.sessaoDe("anne")),
      post("/api/chat/transferir", { cliente_id: alvo, para: "thiago" }, sim.sessaoDe("thiago")),
    ]);

    // ⚠️ a coluna da view é `para_carteira`, não `para` — pedir a errada devolve
    // erro e `data` nulo, e a primeira versão deste teste relatou "dono = null"
    // por isso, não por defeito do app.
    const { data } = await t.db.sb.from("vw_chat_atribuicao")
      .select("cliente_id,para_carteira").eq("cliente_id", alvo).maybeSingle();
    const dono = data?.para_carteira ?? null;

    // Antes do conserto as DUAS respondiam 200 e uma das consultoras ficava
    // achando que tinha pegado a conversa da outra, sem aviso nenhum.
    const codigos = [a.status, b.status].sort().join("/");
    if (codigos !== "200/409") {
      throw new Error(
        `esperava 200/409 (uma leva, a outra é avisada), obtive ${a.status}/${b.status}; dono efetivo = ${dono}`,
      );
    }
    const perdedora = a.status === 409 ? a : b;
    if (perdedora.json?.dono !== dono) {
      throw new Error(`o 409 disse que o dono é "${perdedora.json?.dono}" mas o dono efetivo é "${dono}"`);
    }
    return `uma levou (${dono}), a outra recebeu 409 dizendo quem levou`;
  });

  await t.passo("CORRIDA: dois envios simultâneos para o mesmo cliente não se sobrescrevem", "✅", async () => {
    const c = clientes[0];
    const [a, b] = await Promise.all([
      post("/api/send-message", { cliente_id: c.id, texto: "primeira mensagem simultânea" }, sim.sessaoDe(c.dono)),
      post("/api/send-message", { cliente_id: c.id, texto: "segunda mensagem simultânea" }, sim.sessaoDe(c.dono)),
    ]);
    if (a.status !== 200 || b.status !== 200) throw new Error(`envios simultâneos: ${a.status}/${b.status}`);
    const { data } = await t.db.sb.from("mensagens").select("id,conteudo")
      .eq("cliente_id", c.id).like("conteudo", "%mensagem simultânea");
    if ((data ?? []).length !== 2) throw new Error(`esperava 2 linhas distintas, achei ${(data ?? []).length}`);
    return "as duas viraram linhas distintas — o wamid simulado é único por envio";
  });

  await t.passo("CORRIDA: marca de leitura é POR USUÁRIO (um lendo não zera o outro)", "✅", async () => {
    const c = clientes.find((x) => x.dono === "luana");
    await sim.clienteEscreve(c.i, "mensagem nova para testar não-lidas");
    await espera(300);
    const antes = await get("/api/chat", sim.SUPERVISORES[0].sessao);
    await post("/api/chat/lida", { cliente_id: c.id }, sim.SUPERVISORES[0].sessao);
    const r = await get("/api/chat", sim.SUPERVISORES[1].sessao);
    const alvo = (r.json?.conversas ?? []).find((x) => x.cliente_id === c.id);
    if (!alvo) throw new Error("o segundo supervisor não enxerga a conversa");
    if (alvo.nao_lida !== true) {
      throw new Error(`o segundo supervisor viu nao_lida=${alvo.nao_lida} depois de o PRIMEIRO ter lido — a marca não está por usuário`);
    }
    return `um leu, o outro continua com a conversa em negrito — filas independentes (antes: ${antes.status})`;
  });

  await t.passo("ESCOPO: consultor não alcança a conversa de outro", "✅", async () => {
    const daAnne = clientes.find((c) => c.dono === "anne");
    const r = await post("/api/chat/transferir", { cliente_id: daAnne.id, para: "thiago" }, sim.sessaoDe("thiago"));
    if (r.status !== 403) throw new Error(`esperava 403 ao tentar puxar conversa alheia, obtive ${r.status} — ${(r.texto ?? "").slice(0, 160)}`);

    const lista = await get("/api/chat", sim.sessaoDe("thiago"));
    const vazou = (lista.json?.conversas ?? []).filter((x) => x.cliente_id === daAnne.id);
    return `403 no transferir; a conversa da anne ${vazou.length ? "AINDA aparece na lista do thiago (fila?)" : "não aparece na lista do thiago"}`;
  });

  await t.passo("conversa resolvida REABRE quando a cliente responde", "✅", async () => {
    const c = clientes.find((x) => x.dono === "milene");
    const rr = await post("/api/chat/status", { cliente_id: c.id, status: "resolvida", motivo: "venda_realizada" }, sim.sessaoDe("milene"));
    if (rr.status !== 200) throw new Error(`não consegui resolver: ${rr.status} ${(rr.texto ?? "").slice(0, 160)}`);
    await sim.clienteEscreve(c.i, "ah, esqueci de perguntar uma coisa");
    await espera(400);
    const { data } = await t.db.sb.from("chat_conversa").select("status").eq("cliente_id", c.id).maybeSingle();
    if (data?.status !== "aberta") throw new Error(`status ficou "${data?.status}" — devia ter reaberto`);
    return "resolvida -> cliente responde -> aberta";
  });

  // =========================================================================
  // ATO 3b — DOIS NÚMEROS AO MESMO TEMPO
  //
  // O plano do lançamento é migrar o número oficial e manter os DOIS vivos.
  // Até 30/08/2026 todo envio saía por `WHATSAPP_PHONE_NUMBER_ID`, um valor só
  // para o sistema inteiro: a cliente escreveria para o número oficial e seria
  // respondida por outro, numa conversa que no aparelho dela é outra conversa —
  // e a janela de 24h, que é por par (número, cliente), recusaria o envio.
  // =========================================================================

  const LINHA_2 = "999000111222333";   // linha de ensaio, removida no fim

  await t.passo("DOIS NÚMEROS: a resposta sai pelo número em que a cliente escreveu", "✅", async () => {
    await t.db.sb.from("chat_linha").upsert({
      phone_number_id: LINHA_2, numero: "+5591900000002", rotulo: "Linha de ensaio", ativo: true,
    }, { onConflict: "phone_number_id" });
    t.db.anotarRastro(`chat_linha ${LINHA_2}`, (c) => c.from("chat_linha").delete().eq("phone_number_id", LINHA_2));

    // uma cliente escreve para a linha PADRÃO, outra para a SEGUNDA linha
    const a = { i: 910, id: sim.idFicticio(910) };
    const b = { i: 911, id: sim.idFicticio(911) };
    clientes.push({ ...a, dono: null }, { ...b, dono: null });
    await sim.clienteEscreve(a.i, "escrevi para o número de sempre");
    await sim.clienteEscreve(b.i, "escrevi para o número novo", undefined, LINHA_2);
    await espera(400);

    const ra = await post("/api/send-message", { cliente_id: a.id, texto: "resposta A" }, SESSOES.admin);
    const rb = await post("/api/send-message", { cliente_id: b.id, texto: "resposta B" }, SESSOES.admin);
    if (ra.status !== 200 || rb.status !== 200) throw new Error(`envios: ${ra.status}/${rb.status}`);

    const linhaDe = async (id) => {
      const { data } = await t.db.sb.from("mensagens").select("linha_id")
        .eq("cliente_id", id).eq("enviada_por", "operator").order("criada_em", { ascending: false }).limit(1);
      return data?.[0]?.linha_id ?? null;
    };
    const [la, lb] = [await linhaDe(a.id), await linhaDe(b.id)];
    if (la !== sim.LINHA) throw new Error(`quem escreveu para a linha padrão foi respondida por ${la}`);
    if (lb !== LINHA_2) {
      throw new Error(
        `quem escreveu para a SEGUNDA linha foi respondida por ${lb} — no aparelho dela isso é outra conversa, ` +
        `e a janela de 24h daquele número não vale para este`,
      );
    }
    return `A respondida por ${la} · B respondida por ${lb} — cada uma pelo número em que escreveu`;
  });

  await t.passo("DOIS NÚMEROS: linha DESATIVADA no cadastro não é usada para enviar", "✅", async () => {
    // Linha desativada existe só para dar rótulo a conversa antiga (§28.8).
    // Enviar por ela falharia na Meta, então o envio cai no número padrão.
    await t.db.sb.from("chat_linha").update({ ativo: false }).eq("phone_number_id", LINHA_2);
    const c = { i: 912, id: sim.idFicticio(912) };
    clientes.push({ ...c, dono: null });
    await sim.clienteEscreve(c.i, "escrevi para uma linha que foi desativada", undefined, LINHA_2);
    await espera(400);
    const r = await post("/api/send-message", { cliente_id: c.id, texto: "resposta C" }, SESSOES.admin);
    if (r.status !== 200) throw new Error(`envio: ${r.status} ${(r.texto ?? "").slice(0, 160)}`);
    const { data } = await t.db.sb.from("mensagens").select("linha_id")
      .eq("cliente_id", c.id).eq("enviada_por", "operator").order("criada_em", { ascending: false }).limit(1);
    const l = data?.[0]?.linha_id ?? null;
    if (l !== sim.LINHA) throw new Error(`caiu em ${l}, esperava o número padrão ${sim.LINHA}`);
    return `linha inativa ignorada; respondeu pelo padrão (${l})`;
  });

  await t.passo("DOIS NÚMEROS: a thread diz por qual número vai responder", "✅", async () => {
    await t.db.sb.from("chat_linha").update({ ativo: true }).eq("phone_number_id", LINHA_2);
    const b = sim.idFicticio(911);
    const r = await chamar(`/api/chat/thread?cliente_id=${encodeURIComponent(b)}`, { sessao: SESSOES.admin });
    if (r.status !== 200) throw new Error(`thread devolveu ${r.status}`);
    if (!("linha_envio" in (r.json ?? {}))) {
      throw new Error("a thread não devolve `linha_envio` — a tela contaria a janela de 24h sobre as duas linhas juntas");
    }
    if (r.json.linha_envio !== LINHA_2) {
      throw new Error(`thread diz linha_envio=${r.json.linha_envio}, esperava ${LINHA_2}`);
    }
    return `linha_envio=${r.json.linha_envio} — a faixa da janela conta sobre o número certo`;
  });

  // =========================================================================
  // ATO 4 — envio REAL para os números autorizados
  // =========================================================================

  // Fluxo de verdade para número que nunca escreveu: cadastrar o contato e
  // mandar TEMPLATE. Mensagem livre só existe dentro da janela de 24h, e a
  // janela só abre quando a CLIENTE fala — então tentar texto primeiro daria
  // 131047 nos quatro, o que prova a regra mas não exercita o envio.
  const contatosReais = [];

  await t.passo("envio real: cadastrar os 4 números autorizados como contato", "✅", async () => {
    const detalhes = [];
    for (const numero of AUTORIZADOS) {
      exigirAutorizado(numero);
      const r = await chamar("/api/chat/novo-contato", {
        metodo: "POST", sessao: SESSOES.admin,
        corpo: { telefone: numero, nome: `Ensaio ${numero.slice(-4)}` },
      });
      const id = r.json?.cliente_id ?? r.json?.cliente?.cliente_id ?? `wa:${numero}`;
      const { data: cli } = await t.db.sb.from("clientes").select("id,nome_completo").eq("id", id).maybeSingle();
      if (cli) contatosReais.push({ numero, id });
      detalhes.push(`${numero}: HTTP ${r.status} -> ${cli ? cli.id : "NÃO criou"}`);
    }
    if (!contatosReais.length) throw new Error(`nenhum contato criado:\n${detalhes.join("\n")}`);
    return detalhes.join("\n");
  });

  await t.passo(`envio real: TEMPLATE de verdade para os autorizados (teto ${TETO_TEMPLATES})`, "✅", async () => {
    const { data: tpl } = await t.db.sb.from("crm_templates")
      .select("id,nome,meta_nome,canal,ativo,padrao,status,idioma,corpo,usa_nome").eq("canal", "cloud").eq("ativo", true);
    const aprovados = (tpl ?? []).filter((x) => x.status === "APPROVED");
    if (!aprovados.length) {
      throw new Error(`nenhum template cloud APROVADO em crm_templates — achei ${(tpl ?? []).length} ativo(s): ` +
        (tpl ?? []).map((x) => `${x.meta_nome}=${x.status}`).join(", "));
    }
    const detalhes = [];
    for (const c of contatosReais) {
      if (templatesReais >= TETO_TEMPLATES) { detalhes.push(`${c.numero}: teto atingido`); continue; }
      // O template padrao tem 2 campos, e a rota RECUSA (400 comporNoChat) quem
      // nao manda os valores — de proposito: inventar texto em nome do vendedor
      // seria pior que recusar (§26.5). Aqui a suite faz o que o chat faz: manda
      // os campos. O {{1}} continua sendo o primeiro nome.
      const escolhido = aprovados.find((x) => x.padrao) ?? aprovados[0];
      const nCampos = escolhido?.corpo ? (escolhido.corpo.match(/\{\{\s*\d+\s*\}\}/g) ?? []).length : 1;
      const valores = nCampos > 1
        ? [`Ensaio ${c.numero.slice(-4)}`, ...Array.from({ length: nCampos - 1 }, () => "Murano Professional")]
        : undefined;
      const r = await chamar("/api/send-template", {
        metodo: "POST", sessao: SESSOES.admin,
        corpo: { cliente_id: c.id, template_id: escolhido?.id, ...(valores ? { variaveis: valores } : {}) },
      });
      if (r.status === 200) {
        templatesReais++;
        const { data: msg } = await t.db.sb.from("mensagens").select("id,status")
          .eq("cliente_id", c.id).eq("enviada_por", "operator").order("criada_em", { ascending: false }).limit(1);
        const id = msg?.[0]?.id ?? "";
        if (id && !id.startsWith("sim.")) enviadosReais.push(id);
        detalhes.push(`${c.numero}: enviado (wamid ${id.slice(0, 18)}…)`);
      } else {
        detalhes.push(`${c.numero}: FALHOU ${r.status} — ${(r.json?.error ?? r.texto ?? "").slice(0, 180)}`);
      }
    }
    if (!templatesReais) throw new Error(detalhes.join("\n"));
    return `${templatesReais} template(s) real(is) · ${aprovados.map((x) => x.meta_nome).join(", ")}\n${detalhes.join("\n")}`;
  });

  await t.passo("envio real: recibo da Meta volta e promove wait -> success/read", "✅", async () => {
    if (!enviadosReais.length) throw new Error("PULAR:nenhum envio real aconteceu");
    // O recibo chega no webhook de PRODUÇÃO, que escreve no MESMO banco — então
    // dá para medir daqui, mesmo o envio tendo saído do servidor local.
    const t0 = Date.now();
    const fim = t0 + 60_000;
    let promovidos = [];
    while (Date.now() < fim) {
      const { data } = await t.db.sb.from("mensagens").select("id,status,erro").in("id", enviadosReais);
      promovidos = (data ?? []).filter((x) => x.status !== "wait");
      if (promovidos.length === enviadosReais.length) break;
      await espera(2000);
    }
    if (!promovidos.length) {
      throw new Error(
        `${enviadosReais.length} envio(s) real(is) e NENHUM saiu de "wait" em 60s. ` +
        `É o sintoma exato da §28.3 (app não inscrito na WABA) — conferir subscribed_apps.`,
      );
    }
    const falhadas = promovidos.filter((p) => p.status === "failed");
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    if (falhadas.length) {
      return `${promovidos.length}/${enviadosReais.length} com recibo em ${seg}s · ⚠️ ${falhadas.length} FALHOU: ${falhadas.map((f) => JSON.stringify(f.erro)).join(" | ").slice(0, 300)}`;
    }
    return `${promovidos.length}/${enviadosReais.length} promovidas em ${seg}s · estados: ${[...new Set(promovidos.map((p) => p.status))].join(", ")}`;
  });

  await t.passo("envio real: mensagem livre é recusada fora da janela de 24h", "✅", async () => {
    if (!contatosReais.length) throw new Error("PULAR:nenhum contato real");
    const c = contatosReais[0];
    const r = await chamar("/api/send-message", {
      metodo: "POST", sessao: SESSOES.admin,
      corpo: { cliente_id: c.id, texto: "Ensaio do Pulse — texto livre, pode ignorar." },
    });
    if (r.status === 200) return `a janela estava ABERTA para ${c.numero} (alguém respondeu) — texto livre entregue`;
    if (r.status === 422 && r.json?.foraDaJanela) return `422 foraDaJanela, com o recado certo: "${(r.json.error ?? "").slice(0, 120)}"`;
    throw new Error(`esperava 200 (janela aberta) ou 422 foraDaJanela, obtive ${r.status} — ${(r.json?.error ?? r.texto ?? "").slice(0, 200)}`);
  });

  await t.passo("envio real: mídia para quem respondeu (se alguém respondeu)", "✅", async () => {
    const arq = sim.arquivosDeEnsaio();
    const abertas = [];
    for (const c of contatosReais) {
      const { data } = await t.db.sb.from("mensagens").select("criada_em")
        .eq("cliente_id", c.id).eq("enviada_por", "customer")
        .gte("criada_em", new Date(Date.now() - 24 * 3600_000).toISOString()).limit(1);
      if (data?.length) abertas.push(c);
    }
    if (!abertas.length) {
      throw new Error("PULAR:nenhum dos 4 números respondeu ainda — a janela de 24h só abre quando a CLIENTE fala. Peça a alguém para responder o template e rode de novo com `node testes/run.mjs ciclo10`.");
    }
    const detalhes = [];
    for (const c of abertas) {
      for (const tipo of ["imagem", "audio", "documento"]) {
        const r = await sim.enviarMidia(chamar, SESSOES.admin, c.id, arq[tipo],
          tipo === "audio" ? "" : `Ensaio do Pulse — ${tipo}`);
        detalhes.push(`${c.numero} ${tipo}: ${r.status === 200 ? "ok" : `FALHOU ${r.status} ${(r.json?.error ?? "").slice(0, 140)}`}`);
      }
    }
    return detalhes.join("\n");
  });

  // =========================================================================
  // ATO 5 — o que o volume deixou no banco
  // =========================================================================

  await t.passo("o espelho no banco bate com o que foi enviado", "✅", async () => {
    const ids = clientes.map((c) => c.id);
    const { count: total } = await t.db.sb.from("mensagens").select("*", { count: "exact", head: true }).in("cliente_id", ids);
    const { count: nossas } = await t.db.sb.from("mensagens").select("*", { count: "exact", head: true }).in("cliente_id", ids).eq("enviada_por", "operator");
    const { count: delas } = await t.db.sb.from("mensagens").select("*", { count: "exact", head: true }).in("cliente_id", ids).eq("enviada_por", "customer");
    const { count: comMidia } = await t.db.sb.from("mensagens").select("*", { count: "exact", head: true }).in("cliente_id", ids).not("midia_path", "is", null);
    const enviosOk = m.amostras.filter((a) => /send-message|enviar-midia/.test(a.rota) && a.status === 200).length;
    if ((nossas ?? 0) < enviosOk) throw new Error(`${enviosOk} envios devolveram 200 mas só ${nossas} viraram linha — espelho perdendo mensagem`);
    return `${total} mensagens (${nossas} nossas, ${delas} delas), ${comMidia} com arquivo no bucket`;
  });

  await t.passo("a mídia enviada foi mesmo parar no bucket wa-midia", "✅", async () => {
    const ids = clientes.map((c) => c.id);
    const { data } = await t.db.sb.from("mensagens").select("midia_path").in("cliente_id", ids).not("midia_path", "is", null).limit(5);
    if (!data?.length) throw new Error("nenhuma mensagem do ensaio tem midia_path — o upload para o bucket não aconteceu");
    const { data: baixado, error } = await t.db.sb.storage.from("wa-midia").download(data[0].midia_path);
    if (error || !baixado) throw new Error(`midia_path existe mas o arquivo não: ${error?.message}`);
    return `${data.length} amostras com caminho; a primeira baixou ${baixado.size} bytes`;
  });

  await t.passo("limpeza: nada do ensaio fica no banco", "✅", async () => {
    const relato = await sim.limparEnsaio(t.db.sb);
    const { count } = await t.db.sb.from("clientes").select("*", { count: "exact", head: true }).like("id", sim.PADRAO_ID_FICTICIO);
    if ((count ?? 0) > 0) throw new Error(`sobraram ${count} clientes fictícios:\n${relato.join("\n")}`);
    return relato.join("\n");
  });

  // deixa o laudo pronto para o relatório final
  t.metricas10 = m.porRota();
}

/**
 * Trava dura de destino. `ajuda.mjs` só conhece UM número autorizado (o da §0);
 * esta sessão ampliou a lista para quatro, com autorização explícita do usuário.
 * Mantida como função própria para a lista continuar num lugar só, conferida
 * antes de cada envio real.
 */
function exigirAutorizado(numero) {
  const t8 = String(numero).replace(/\D/g, "").slice(-8);
  if (!AUTORIZADOS.some((n) => n.slice(-8) === t8)) {
    throw new Error(`BLOQUEADO pela suíte: ${numero} não está entre os 4 autorizados desta sessão`);
  }
  return true;
}
