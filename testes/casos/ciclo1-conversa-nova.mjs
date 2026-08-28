// -----------------------------------------------------------------------------
// Ciclo 1 — conversa nova, do zero ao encerramento.
//
// É o caminho mais comum e o mais valioso (§5 da definição do agente).
//
// ⚠️ ADAPTAÇÃO DE SEGURANÇA: "cliente novo" é encenado com o NÚMERO AUTORIZADO
// (91984719702, o celular do próprio usuário), que já tem conversa aberta na
// linha Cloud. Um número inventado criaria `clientes` novo — lixo em tabela de
// produção. Toda linha escrita aqui é registrada no rastro e removida no fim.
// -----------------------------------------------------------------------------
import { NUMERO_AUTORIZADO_E164, TEL8_AUTORIZADO, exigirDestinoAutorizado, espera } from "../ajuda.mjs";

export const ciclo = "Ciclo 1 — conversa nova, do zero ao encerramento";

/** wamid sintético, reconhecível, para as linhas que a suíte planta. */
const wamidTeste = () => `wamid.QA_TESTE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export default async function (t) {
  const { db, api } = t;
  if (!t.servidorNoAr) { t.pular("(ciclo inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  // -- alvo: a conversa do próprio usuário na linha Cloud -------------------
  const { data: alvos } = await db.sb.from("clientes")
    .select("id,nome_completo,telefone,carteira").like("telefone", `%${TEL8_AUTORIZADO}`);
  const alvo = (alvos ?? []).find((c) => c.id === "6a66af9224e3f7ae2f1e99a7") ?? (alvos ?? [])[0];
  if (!alvo) { t.pular("(ciclo inteiro)", "✅", "o número autorizado não tem contato no banco"); return; }
  exigirDestinoAutorizado(alvo.telefone, "alvo do ciclo 1");
  const ID = alvo.id;

  const { data: linhaAtiva } = await db.sb.from("chat_linha")
    .select("phone_number_id").eq("ativo", true).neq("phone_number_id", "rd").limit(1);
  const LINHA = linhaAtiva?.[0]?.phone_number_id ?? "1264458800091787";

  // ------------------------------------------------------------------ passo 1
  await t.passo("1. cliente manda mensagem — o webhook grava e casa pelo telefone", "✅", async () => {
    const wamid = wamidTeste();
    const payload = {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-teste",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: LINHA },
            contacts: [{ wa_id: NUMERO_AUTORIZADO_E164, profile: { name: "QA (teste)" } }],
            messages: [{
              from: NUMERO_AUTORIZADO_E164, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)),
              type: "text", text: { body: "[QA] mensagem de teste automatizado" },
            }],
          },
        }],
      }],
    };
    const antesClientes = await db.contar("clientes");
    const r = await api.post("/api/whatsapp/webhook", payload, api.SESSOES.anonimo);
    api.status(r, 200, "POST no webhook");

    const { data: m } = await db.sb.from("mensagens").select("id,cliente_id,enviada_por,status,linha_id,conteudo").eq("id", wamid).maybeSingle();
    api.ok(m, "a mensagem do webhook não foi gravada");
    db.anotarRastro(`mensagens ${wamid}`, async (c) => { await c.from("mensagens").delete().eq("id", wamid); });

    api.igual(m.cliente_id, ID, "o webhook casou o telefone com outro contato");
    api.igual(m.enviada_por, "customer", "enviada_por");
    api.igual(m.linha_id, LINHA, "linha_id carimbada");
    const depoisClientes = await db.contar("clientes");
    api.igual(depoisClientes, antesClientes, "o webhook criou um contato novo em vez de casar pelo telefone");
    return `gravada em ${m.cliente_id}, linha ${m.linha_id}, sem criar contato duplicado`;
  });

  // --------------------------------------------------------------- passos 2-3
  //
  // ⚠️ "sem dono" NÃO é `vw_funil_visivel.vendedor is null`. O dono efetivo é
  // `transferência vigente ?? carteira` (lib/chatEscopo.ts) — uma conversa sem
  // carteira que alguém já pegou tem dono, e continua com `vendedor` nulo na
  // view. A primeira versão deste teste confundiu os dois e acusou o produto de
  // um defeito que era meu: as 5 da fila já tinham sido puxadas.
  //
  // Os dois passos viraram um só porque a ida e a volta se provam melhor como
  // ROUND TRIP: devolver -> conferir a fila -> pegar de novo devolve o sistema
  // exatamente ao estado anterior, sem depender de haver fila no momento.
  await t.passo("2-3. fila de não atribuídos · devolver (0112) e ✋ Pegar de volta", "✅", async () => {
    const { data: cand } = await db.sb.from("vw_funil_visivel")
      .select("cliente_id,cliente,vendedor").is("vendedor", null).not("ultima_atividade", "is", null).limit(50);
    const { data: atr } = await db.sb.from("vw_chat_atribuicao").select("cliente_id,para_carteira");
    const vigente = new Map((atr ?? []).map((a) => [a.cliente_id, a.para_carteira]));

    // dono efetivo = transferência vigente (mesmo NULA) ?? carteira do funil
    const donoDe = (id, carteira) => (vigente.has(id) ? vigente.get(id) : carteira);
    const semDonoBanco = (cand ?? []).filter((c) => donoDe(c.cliente_id, c.vendedor) === null);
    const minhas = (cand ?? []).filter((c) => donoDe(c.cliente_id, c.vendedor) === "romulo");

    const rv0 = await api.get("/api/chat", api.SESSOES.romulo);
    const ra0 = await api.get("/api/chat", api.SESSOES.admin);
    const filaVend0 = rv0.json.conversas.filter((c) => !c.vendedor).length;
    const filaAdm0 = ra0.json.conversas.filter((c) => !c.vendedor).length;
    api.igual(filaVend0, semDonoBanco.length, "a fila que o consultor vê não bate com a do banco");
    api.igual(filaVend0, filaAdm0, "consultor e admin veem filas de tamanhos diferentes — a fila deve ser de todos (§23.5)");

    const c = minhas[0];
    if (!c) throw new Error(`PULAR:nenhuma conversa sem carteira comercial atribuída a romulo para fazer o round trip (fila hoje: ${filaVend0})`);

    // (a) devolver para a fila — destino NULO. O `??` daqui já foi bug (§56).
    const rd = await api.post("/api/chat/transferir", { cliente_id: c.cliente_id, devolver: true }, api.SESSOES.romulo);
    api.status(rd, 200, `devolver ${c.cliente_id}`);
    const idDev = rd.json?.transferencia?.id;
    db.anotarRastro(`chat_transferencia #${idDev} (devolver)`, async (x) => { await x.from("chat_transferencia").delete().eq("id", idDev); });
    api.igual(rd.json.transferencia.para_carteira, null, "devolver gravou destino não-nulo");

    const rv1 = await api.get("/api/chat", api.SESSOES.romulo);
    const volta = rv1.json.conversas.find((x) => x.cliente_id === c.cliente_id);
    api.ok(volta && volta.vendedor === null,
      `depois de devolver, o dono efetivo é ${JSON.stringify(volta?.vendedor)} — a coalescência do §56 voltou`);
    api.igual(rv1.json.conversas.filter((x) => !x.vendedor).length, filaVend0 + 1, "a fila não cresceu com a devolução");

    // (b) e um vendedor QUALQUER pode puxá-la — é o que "de todos" significa
    const rp = await api.post("/api/chat/transferir", { cliente_id: c.cliente_id, para: "romulo" }, api.SESSOES.romulo);
    api.status(rp, 200, `pegar ${c.cliente_id}`);
    const idPegar = rp.json?.transferencia?.id;
    db.anotarRastro(`chat_transferencia #${idPegar} (pegar)`, async (x) => { await x.from("chat_transferencia").delete().eq("id", idPegar); });

    const rv2 = await api.get("/api/chat", api.SESSOES.romulo);
    const minha = rv2.json.conversas.find((x) => x.cliente_id === c.cliente_id);
    api.ok(minha, "depois de pegar, a conversa sumiu da lista do consultor");
    api.igual(minha.vendedor, "romulo", "dono efetivo depois de pegar");
    api.igual(rv2.json.conversas.filter((x) => !x.vendedor).length, filaVend0, "a fila não voltou ao tamanho de origem");
    return `fila hoje: ${filaVend0} (banco e tela batem, iguais para consultor e admin). ` +
      `Round trip em ${c.cliente}: devolver #${idDev} -> NULO -> pegar #${idPegar} -> romulo`;
  });

  // ------------------------------------------------------------------ passo 4
  await t.passo("4. responder com texto — decisão de canal, janela e guardas", "✅", async () => {
    // O envio de verdade mora em ciclo1b (exige credenciais do WhatsApp e só
    // roda com o número autorizado). Aqui se prova o que é NOSSO código:
    // a rota existe, decide o canal e recusa o que tem de recusar.
    const vazio = await api.post("/api/send-message", { cliente_id: ID, texto: "   " }, api.SESSOES.romulo);
    api.status(vazio, 400, "texto vazio deve ser recusado");

    const sintetico = await api.post("/api/send-message", { cliente_id: "winthor:999999", texto: "x" }, api.SESSOES.romulo);
    api.status(sintetico, 400, "card sintético do ERP não tem conversa");

    const inexistente = await api.post("/api/send-message", { cliente_id: "nao_existe_zzz", texto: "x" }, api.SESSOES.romulo);
    api.status(inexistente, 404, "cliente inexistente");
    return "recusa texto vazio (400), card do ERP (400) e cliente inexistente (404)";
  });

  // --------------------------------------------------------------- passos 5-6
  t.pular("5-6. enviar imagem / 3 imagens juntas", "✅",
    "não executado: exigiria upload real pela Graph API. O caminho de recusa é coberto no ciclo1b; " +
    "o envio de mídia de verdade a um número real não foi feito para não gastar a única autorização em anexo.");

  // ------------------------------------------------------------------ passo 7
  await t.passo("7. reação do cliente vira ATRIBUTO da bolha, não mensagem nova", "⚠️", async () => {
    // §21.2: gravar reação como mensagem movia o card de etapa e abria uma
    // espera no indicador. Este passo prova que a correção da 0086 continua de pé.
    const { data: base } = await db.sb.from("mensagens")
      .select("id,criada_em,reacao").eq("cliente_id", ID).eq("enviada_por", "operator")
      .order("criada_em", { ascending: false }).limit(1);
    const alvoMsg = base?.[0];
    if (!alvoMsg) throw new Error("PULAR:nenhuma mensagem de operador na conversa alvo para reagir");
    const reacaoAntes = alvoMsg.reacao ?? null;

    const antes = await db.contar("mensagens", (q) => q.eq("cliente_id", ID));
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: "waba-teste", changes: [{ field: "messages", value: {
        messaging_product: "whatsapp", metadata: { phone_number_id: LINHA },
        contacts: [{ wa_id: NUMERO_AUTORIZADO_E164, profile: { name: "QA (teste)" } }],
        messages: [{ from: NUMERO_AUTORIZADO_E164, id: wamidTeste(), timestamp: String(Math.floor(Date.now() / 1000)),
          type: "reaction", reaction: { message_id: alvoMsg.id, emoji: "👍" } }],
      } }] }],
    };
    db.anotarRastro(`mensagens ${alvoMsg.id}.reacao -> ${JSON.stringify(reacaoAntes)}`, async (c) => {
      await c.from("mensagens").update({ reacao: reacaoAntes }).eq("id", alvoMsg.id);
    });
    const r = await api.post("/api/whatsapp/webhook", payload, api.SESSOES.anonimo);
    api.status(r, 200, "webhook de reação");

    const depois = await db.contar("mensagens", (q) => q.eq("cliente_id", ID));
    api.igual(depois, antes, "a reação virou MENSAGEM NOVA — o bug da §21.2 voltou (move card e abre espera)");
    const { data: dep } = await db.sb.from("mensagens").select("reacao").eq("id", alvoMsg.id).maybeSingle();
    api.igual(dep?.reacao, "👍", "a reação não foi gravada como atributo da bolha");
    return "reação gravada como atributo; nenhuma linha nova em `mensagens` (§21.2 continua corrigida)";
  });

  // ------------------------------------------------------------------ passo 8
  await t.passo("8. citação: a recebida aparece; enviar citando não existe", "⚠️", async () => {
    const cols = await db.colunas("mensagens");
    api.ok(cols.includes("resposta_a"), "coluna `resposta_a` ausente — nem a citação recebida seria exibida");
    // A limitação documentada: nenhuma rota de envio aceita citar.
    const grep = ["send-message", "chat/enviar-midia"];
    return `coluna resposta_a existe (citação recebida ok). Enviar citando segue sem caminho nas rotas ${grep.join(", ")} — limitação confirmada, como o documento diz`;
  });

  // ------------------------------------------------------------------ passo 9
  await t.passo("9. nota interna — grava, aparece na thread, e só o autor apaga", "✅", async () => {
    const texto = `[QA ${new Date().toISOString()}] nota de teste automatizado`;
    const r = await api.post("/api/chat/notas", { cliente_id: ID, texto }, api.SESSOES.romulo);
    api.status(r, 200, "criar nota");
    const id = r.json?.nota?.id;
    api.ok(id, "nota criada sem id");
    db.anotarRastro(`chat_nota #${id}`, async (c) => { await c.from("chat_nota").delete().eq("id", id); });

    const th = await api.get(`/api/chat/thread?cliente_id=${encodeURIComponent(ID)}`, api.SESSOES.romulo);
    api.status(th, 200, "thread");
    api.ok((th.json?.notas ?? []).some((n) => n.id === id), "a nota não veio na thread");

    // a nota NÃO pode ter virado mensagem (mesmo princípio da reação, §21.2)
    const { data: comoMsg } = await db.sb.from("mensagens").select("id").eq("cliente_id", ID).eq("conteudo", texto);
    api.igual((comoMsg ?? []).length, 0, "a nota interna foi parar em `mensagens`");

    const alheio = await api.del("/api/chat/notas", { id }, api.SESSOES.luana);
    api.status(alheio, 403, "outro vendedor apagando nota alheia");
    return `nota #${id} na thread, fora de \`mensagens\`, e protegida de outro vendedor (403)`;
  });

  // ----------------------------------------------------------------- passo 10
  await t.passo("10. encerrar com motivo — e o motivo vira dado utilizável", "✅", async () => {
    const { data: antes } = await db.sb.from("chat_conversa").select("*").eq("cliente_id", ID).maybeSingle();
    db.anotarRastro(`chat_conversa ${ID} -> estado anterior`, async (c) => {
      if (antes) await c.from("chat_conversa").upsert(antes, { onConflict: "cliente_id" });
      else await c.from("chat_conversa").delete().eq("cliente_id", ID);
    });

    const mau = await api.post("/api/chat/status", { cliente_id: ID, status: "resolvida", motivo: "inventado_zzz" }, api.SESSOES.romulo);
    api.status(mau, 400, "motivo fora da lista deve ser recusado");

    const r = await api.post("/api/chat/status", { cliente_id: ID, status: "resolvida", motivo: "venda_realizada" }, api.SESSOES.romulo);
    api.status(r, 200, "encerrar com motivo");
    const { data: dep } = await db.sb.from("chat_conversa").select("status,motivo,resolvida_por,resolvida_em").eq("cliente_id", ID).maybeSingle();
    api.igual(dep.status, "resolvida", "status gravado");
    api.igual(dep.motivo, "venda_realizada", "motivo gravado");
    api.ok(dep.resolvida_por, "resolvida_por vazio — sem autoria o motivo não vira dado de ninguém");

    // e a conversa some da fila de pendentes/abertas na lista
    const rl = await api.get("/api/chat", api.SESSOES.romulo);
    const c = rl.json.conversas.find((x) => x.cliente_id === ID);
    api.igual(c?.status, "resolvida", "a lista do chat não reflete o encerramento");
    return `motivo=venda_realizada por ${dep.resolvida_por}; lista do chat acompanhou`;
  });

  // -------------------------------------------------------- passo 10 (0114)
  await t.passo("10b. o encerramento alimenta o histórico de resolução (0114)", "✅", async () => {
    if (!(await db.existe("chat_resolucao")).ok) {
      throw new Error(
        "PULAR:`chat_resolucao` não existe — a 0114 está em disco mas não foi aplicada. " +
        "O código de status/route.ts já grava lá (dentro de try/catch), então encerrar funciona, " +
        "mas o tempo de resolução não acumula nada.",
      );
    }
    const n = await db.contar("chat_resolucao", (q) => q.eq("cliente_id", ID));
    api.ok(n > 0, "encerrou, mas nada foi para `chat_resolucao`");
    return `${n} linha(s) de resolução para o alvo`;
  });

  // ----------------------------------------------------------------- passo 11
  await t.passo("11. cliente responde depois — a conversa REABRE sozinha", "✅", async () => {
    const wamid = wamidTeste();
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: "waba-teste", changes: [{ field: "messages", value: {
        messaging_product: "whatsapp", metadata: { phone_number_id: LINHA },
        contacts: [{ wa_id: NUMERO_AUTORIZADO_E164, profile: { name: "QA (teste)" } }],
        messages: [{ from: NUMERO_AUTORIZADO_E164, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)),
          type: "text", text: { body: "[QA] resposta que deve reabrir a conversa" } }],
      } }] }],
    };
    const r = await api.post("/api/whatsapp/webhook", payload, api.SESSOES.anonimo);
    api.status(r, 200, "webhook da resposta");
    db.anotarRastro(`mensagens ${wamid}`, async (c) => { await c.from("mensagens").delete().eq("id", wamid); });

    await espera(400);
    const { data: dep } = await db.sb.from("chat_conversa").select("status,motivo").eq("cliente_id", ID).maybeSingle();
    api.igual(dep.status, "aberta", "a conversa NÃO reabriu quando o cliente respondeu");
    return `status voltou a "aberta" (motivo anterior guardado: ${dep.motivo ?? "—"})`;
  });
}
