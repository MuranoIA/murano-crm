// -----------------------------------------------------------------------------
// Regressão — disparo em massa por lista/planilha: o teto é 5.000 e SÓ ele.
//
// Pedido do usuário em 18/09/2026: "que siga independente da quantidade de
// nomes na lista, respeitando apenas o teto de 5 mil".
//
// Havia TRÊS tetos, e só o primeiro aparecia na tela:
//   1. a rota recusava acima de 500 códigos (`LIMITE_MANUAL`);
//   2. a peneira cortava em 2.000 (`LIMITE_MAX`);
//   3. ESCONDIDO: os códigos iam ao WinThor numa consulta só, e o PostgREST
//      corta a resposta em 1.000 linhas SEM avisar — do milésimo código em
//      diante, clientes reais voltavam como "código não existe".
//
// O terceiro é o que este caso mais protege, e por isso a asserção central não é
// "deu 200": é que TODO código enviado volta contado, como card ou como "não deu
// para alcançar". Se um código some no caminho, a conta não fecha.
//
// ⚠️ NADA É ENVIADO. Só `resolver` e `previa`. E os clientes reais usados são só
// os que JÁ têm contato em `clientes` com o mesmo telefone — assim a conferência
// não cria contato nenhum (ela cria quando não acha).
// -----------------------------------------------------------------------------
export const ciclo = "Regressão — disparo por planilha até 5.000";

const TETO = 5000;
const LOTE = 250;

const digitos = (x) => String(x ?? "").replace(/\D/g, "");
const tel8 = (x) => digitos(x).slice(-8);

async function todos(sb, tabela, colunas) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from(tabela).select(colunas).order(colunas.split(",")[0]).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return linhas;
}

function csv(codigos, extra = []) {
  return "codcli;nome\r\n" + [...codigos, ...extra].map((c) => `${c};x`).join("\r\n") + "\r\n";
}

async function subir(api, conteudo, nome = "lista.csv") {
  const fd = new FormData();
  fd.append("arquivo", new File([conteudo], nome, { type: "text/csv" }));
  return api.chamar("/api/admin/disparo-massa/planilha", { metodo: "POST", sessao: api.SESSOES.admin, corpo: fd });
}

export default async function (t) {
  const { api, db } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  await t.passo("1. o servidor informa o teto (5.000) e o lote (250)", "✅", async () => {
    const r = await api.chamar("/api/admin/disparo-massa", { sessao: api.SESSOES.admin });
    api.status(r, 200, "GET /api/admin/disparo-massa");
    const c = r.json?.["disparo-massa"] ?? {};
    api.ok(c.limiteLista === TETO, `limiteLista devia ser ${TETO} e veio ${c.limiteLista}`);
    api.ok(c.loteResolver === LOTE, `loteResolver devia ser ${LOTE} e veio ${c.loteResolver}`);
    return `teto ${c.limiteLista} · lote ${c.loteResolver}`;
  });

  await t.passo("2. a planilha de EXEMPLO baixa, abre e sobe de volta lendo os 3 códigos", "✅", async () => {
    const ck = Object.entries(api.SESSOES.admin).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    const r = await fetch(api.BASE + "/api/admin/disparo-massa/planilha", { headers: { cookie: ck } });
    api.ok(r.status === 200, `baixar o exemplo devolveu ${r.status}`);
    api.ok(/spreadsheetml/.test(r.headers.get("content-type") ?? ""), `tipo do arquivo: ${r.headers.get("content-type")}`);
    api.ok(/attachment/.test(r.headers.get("content-disposition") ?? ""), "não veio como download");
    const bytes = new Uint8Array(await r.arrayBuffer());
    api.ok(bytes[0] === 0x50 && bytes[1] === 0x4b, "o arquivo não é um .xlsx (falta a assinatura PK)");

    // o exemplo tem de ser UM ARQUIVO QUE O PRÓPRIO SISTEMA ACEITA
    const fd = new FormData();
    fd.append("arquivo", new File([bytes], "planilha-exemplo-disparo.xlsx"));
    const up = await api.chamar("/api/admin/disparo-massa/planilha", { metodo: "POST", sessao: api.SESSOES.admin, corpo: fd });
    api.status(up, 200, "subir o próprio exemplo");
    api.igual(JSON.stringify(up.json?.codclis), JSON.stringify([900000001, 900000002, 900000003]), "códigos lidos do exemplo");

    // ⚠️ e os códigos do exemplo NÃO PODEM existir no WinThor: se existissem, quem
    // subisse o exemplo sem apagar dispararia para gente de verdade
    const { data } = await db.sb.from("wth_carteira").select("codcli").in("codcli", [900000001, 900000002, 900000003]);
    api.ok((data ?? []).length === 0, `um código do exemplo existe no WinThor: ${JSON.stringify(data)}`);

    // só admin baixa
    const luana = await fetch(api.BASE + "/api/admin/disparo-massa/planilha", {
      headers: { cookie: Object.entries(api.SESSOES.luana).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ") },
    });
    api.ok(luana.status === 403 || luana.status === 401, `vendedor conseguiu baixar o exemplo (${luana.status})`);
    return `${bytes.length} bytes, sobe de volta com 3 códigos, nenhum existe no WinThor`;
  });

  await t.passo("3. planilha de 5.000 passa; repetidos contam uma vez; 5.001 é RECUSADA", "✅", async () => {
    const cinco = Array.from({ length: TETO }, (_, i) => 800000001 + i);
    const ok = await subir(api, csv(cinco, cinco.slice(0, 200)));
    api.status(ok, 200, "planilha de 5.000");
    api.igual(ok.json?.codclis?.length, TETO, "códigos únicos lidos");
    api.igual(ok.json?.repetidos, 200, "linhas repetidas");

    const seis = Array.from({ length: TETO + 1 }, (_, i) => 800000001 + i);
    const nao = await subir(api, csv(seis));
    api.status(nao, 400, "planilha de 5.001");
    api.ok(/5000/.test(nao.json?.error ?? ""), `o recado não cita o teto: ${nao.json?.error}`);
    return `5.000 → ${ok.ms} ms (200 repetidos contados uma vez) · 5.001 → 400 "${(nao.json?.error ?? "").slice(0, 50)}…"`;
  });

  // ---- a lista real: só clientes que JÁ têm contato (a conferência não cria nada)
  let reais = [];
  await t.passo("4. escolhe clientes reais que já têm contato, para a conferência não escrever nada", "✅", async () => {
    const carteira = await todos(db.sb, "wth_carteira", "codcli,telefone");
    const contatos = await todos(db.sb, "clientes", "id,telefone");
    const jaTem = new Set(contatos.map((c) => tel8(c.telefone)).filter((x) => x.length === 8));
    reais = carteira
      .filter((c) => digitos(c.telefone).length >= 10 && jaTem.has(tel8(c.telefone)))
      .map((c) => Number(c.codcli));
    api.ok(reais.length >= 1500, `só ${reais.length} clientes reais com contato — o teste precisa de mais de 1.500 para provar que passa de 1.000`);
    return `${reais.length} clientes reais com contato existente`;
  });

  await t.passo(`5. UM lote de ${LOTE} códigos reais confere dentro do tempo`, "✅", async () => {
    const lote = reais.slice(0, LOTE);
    const r = await api.chamar("/api/admin/disparo-massa", {
      metodo: "POST", sessao: api.SESSOES.admin, corpo: { acao: "resolver", codclis: lote },
    });
    api.status(r, 200, "resolver 250");
    const conta = (r.json?.cards?.length ?? 0) + (r.json?.semAlcance?.length ?? 0);
    api.igual(conta, LOTE, "cards + semAlcance");
    api.ok(r.ms < 45_000, `um lote levou ${r.ms} ms — a rota tem 60 s e o lote precisa caber com folga`);
    return `${r.json.cards.length} cards, ${r.json.semAlcance.length} sem alcance, ${r.ms} ms`;
  });

  await t.passo("6. um lote maior que o combinado é RECUSADO com recado", "✅", async () => {
    const r = await api.chamar("/api/admin/disparo-massa", {
      metodo: "POST", sessao: api.SESSOES.admin,
      corpo: { acao: "resolver", codclis: Array.from({ length: LOTE + 1 }, (_, i) => 700000001 + i) },
    });
    api.status(r, 400, "resolver 251");
    return `400 "${(r.json?.error ?? "").slice(0, 60)}…"`;
  });

  await t.passo(`7. O FLUXO DE ${TETO}: nenhum código se perde, e o público passa de 2.000`, "✅", async () => {
    const codigos = reais.slice(0, TETO);
    // completa até 5.000 com códigos que não existem: eles TÊM de voltar como
    // "não existe" — se sumirem, é exatamente o corte silencioso que este caso caça
    let n = 0;
    while (codigos.length < TETO) codigos.push(600000001 + n++);
    const inexistentes = codigos.length - Math.min(reais.length, TETO);

    const t0 = Date.now();
    const cards = [], semAlcance = [];
    let maiorLote = 0;
    const tempos = [];
    for (let de = 0; de < codigos.length; de += LOTE) {
      const r = await api.chamar("/api/admin/disparo-massa", {
        metodo: "POST", sessao: api.SESSOES.admin,
        corpo: { acao: "resolver", codclis: codigos.slice(de, de + LOTE) },
      });
      api.status(r, 200, `lote ${de / LOTE + 1}`);
      maiorLote = Math.max(maiorLote, r.ms);
      tempos.push(r.ms);
      cards.push(...r.json.cards);
      semAlcance.push(...r.json.semAlcance);
    }
    const msResolver = Date.now() - t0;

    // A CONTA QUE FECHA: todo código voltou, como card ou como "não alcançado"
    api.igual(cards.length + semAlcance.length, TETO, "cards + semAlcance (a conta tem de fechar)");
    const naoExiste = semAlcance.filter((s) => /não existe/.test(s.motivo)).length;
    api.ok(naoExiste >= inexistentes,
      `só ${naoExiste} dos ${inexistentes} códigos inexistentes voltaram como "não existe" — os outros sumiram ou viraram outra coisa`);
    // e nenhum código REAL foi tomado por inexistente (o corte de 1.000 linhas)
    const reaisEnviados = new Set(codigos.slice(0, Math.min(reais.length, TETO)));
    const reaisComoInexistentes = semAlcance.filter((s) => /não existe/.test(s.motivo) && reaisEnviados.has(s.codcli));
    api.ok(reaisComoInexistentes.length === 0,
      `${reaisComoInexistentes.length} cliente(s) REAL(is) voltaram como "código não existe no WinThor" — `
      + `é o corte de 1.000 linhas do PostgREST. Ex.: ${JSON.stringify(reaisComoInexistentes.slice(0, 3))}`);

    const previa = await api.chamar("/api/admin/disparo-massa", {
      metodo: "POST", sessao: api.SESSOES.admin, corpo: { acao: "previa", cards, pularProtecoes: true },
    });
    api.status(previa, 200, "prévia de 5.000");
    const sel = previa.json?.selecionados?.length ?? 0;
    // Quem compartilha telefone com outro da lista recebe UMA vez — e o corte
    // tem de vir NOMEADO, e não como diferença que ninguém explica.
    const unicos = new Set(cards.map((c) => c.cliente_id)).size;
    const rep = previa.json?.cortes?.telefone_repetido ?? 0;
    api.ok(sel === unicos, `a prévia selecionou ${sel} mas a lista tem ${unicos} contatos distintos — cortes: ${JSON.stringify(previa.json?.cortes)}`);
    api.ok(cards.length - sel === rep,
      `${cards.length - sel} saíram da prévia e só ${rep} vieram nomeados como "telefone repetido" — o resto sumiu em silêncio`);
    api.ok(sel > 2000, `só ${sel} selecionados — o teto de 2.000 do automático ainda vale para a lista`);
    api.ok(maiorLote < 20_000, `o maior lote levou ${maiorLote} ms — devia ser bem menor que os 28 s de antes da leitura única. Lotes (ms): ${tempos.join(" ")}`);
    return `${TETO} códigos em ${Math.round(msResolver / 1000)} s (maior lote ${maiorLote} ms) · `
      + `${cards.length} cards + ${semAlcance.length} sem alcance = ${TETO} · prévia ${sel} selecionados (${rep} telefone repetido)`;
  });

  await t.passo("8. 5.001 cards na prévia são RECUSADOS; o caminho antigo com lista grande também", "✅", async () => {
    const molde = { cliente_id: "wa:559100000000", telefone: "559100000000", codcli: 1, cliente: "x", vendedor: null };
    const muitos = Array.from({ length: TETO + 1 }, (_, i) => ({ ...molde, cliente_id: `wa:5591${i}`, codcli: i + 1 }));
    const r = await api.chamar("/api/admin/disparo-massa", {
      metodo: "POST", sessao: api.SESSOES.admin, corpo: { acao: "previa", cards: muitos, pularProtecoes: true },
    });
    api.status(r, 400, "prévia de 5.001 cards");
    api.ok(/5000/.test(r.json?.error ?? ""), `o recado não cita o teto: ${r.json?.error}`);

    const velha = await api.chamar("/api/admin/disparo-massa", {
      metodo: "POST", sessao: api.SESSOES.admin,
      corpo: { acao: "previa", codclis: Array.from({ length: LOTE + 1 }, (_, i) => 500000001 + i), pularProtecoes: true },
    });
    api.status(velha, 400, "caminho antigo com lista grande");
    api.ok(/Recarregue/i.test(velha.json?.error ?? ""), `o recado não manda recarregar a página: ${velha.json?.error}`);

    const incompleto = await api.chamar("/api/admin/disparo-massa", {
      metodo: "POST", sessao: api.SESSOES.admin,
      corpo: { acao: "previa", cards: [{ cliente_id: "wa:1" }], pularProtecoes: true },
    });
    api.status(incompleto, 400, "card incompleto");
    return "5.001 → 400 · lista grande no caminho antigo → 400 (recarregue) · card incompleto → 400";
  });

  // ---- a TELA: o caminho que a consultora faz com o mouse ---------------------
  await t.passo("9. na TELA: trocar para Planilha não trava o botão; sobe, confere e mostra o resultado", "✅", async () => {
    try { await t.chrome(); } catch (e) { throw new Error("PULAR:" + String(e.message).replace(/^PULAR:/, "")); }
    if (reais.length < 300) throw new Error("PULAR:poucos clientes reais para a lista de 300");
    const { writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const caminho = `${tmpdir()}/lista-300-teste.csv`;
    writeFileSync(caminho, "codcli\r\n" + reais.slice(0, 300).join("\r\n") + "\r\n");

    const aba = await t.aba();
    try {
      await aba.enviar("Emulation.setDeviceMetricsOverride", { width: 1300, height: 1100, deviceScaleFactor: 1, mobile: false });
      await aba.cookies(api.SESSOES.admin);
      await aba.ir(`${api.BASE}/admin`, { esperar: 2500 });
      const clicar = (txt) => aba.js(`const b=[...document.querySelectorAll('button')].find(e=>(e.textContent||'').includes(${JSON.stringify(txt)})); if(!b) return false; b.click(); return true;`);
      const tem = (txt) => `document.body.textContent.includes(${JSON.stringify(txt)})`;

      api.ok(await clicar("Templates"), "não achei a aba Templates do /admin");
      await new Promise((r) => setTimeout(r, 2000));
      api.ok(await clicar("Disparo em massa"), "não achei a chave Disparo em massa");
      await new Promise((r) => setTimeout(r, 1500));
      // ⚠️ SEM esperar a prévia automática (que varre ~4 mil clientes): é
      // justamente trocar de fonte com ela em andamento que travava o botão.
      api.ok(await clicar("Planilha"), "não achei a fonte Planilha");

      const doc = await aba.enviar("DOM.getDocument", {});
      const q = await aba.enviar("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
      await aba.enviar("DOM.setFileInputFiles", { nodeId: q.nodeId, files: [caminho] });
      api.ok(await aba.ate(tem("300 código(s) reconhecido(s)"), { ms: 60_000, passo: 300 }),
        "a planilha de 300 códigos não foi reconhecida pela tela");
      api.ok(await aba.ate(tem("300 de 5.000 clientes na lista"), { ms: 10_000, passo: 200 }),
        "a tela não mostrou o contador 300 de 5.000");

      const habilitado = `[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('Conferir público (300)') && !b.disabled)`;
      api.ok(await aba.ate(habilitado, { ms: 40_000, passo: 300 }),
        'o botão "Conferir público" ficou desabilitado — a prévia automática interrompida deixou "Conferindo…" preso');

      api.ok(await clicar("Conferir público (300)"), "não consegui clicar em Conferir");
      api.ok(await aba.ate(tem("vão receber"), { ms: 120_000, passo: 500 }), "a prévia não apareceu depois de conferir");
      // ⚠️ `\\s`/`\\d` com barra dupla: dentro de template literal a barra simples
      // some, e a expressão regular passa a procurar a letra "s" e a letra "d"
      const n = await aba.js(`const m=document.body.textContent.match(/vão receber\\s*(\\d+)/); return m ? Number(m[1]) : null;`);
      api.ok(n != null && n >= 250 && n <= 300, `a prévia diz que ${n} vão receber, de 300 códigos reais — esperava entre 250 e 300`);
      api.ok(aba.excecoes.length === 0, `exceção de JS: ${aba.excecoes.slice(0, 2).join(" | ")}`);
      // NUNCA clica em Revisar / Confirmar: só conferir. O botão de envio existe,
      // mas este caso para aqui.
      return `300 códigos → prévia "vão receber ${n}" · nada enviado`;
    } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
  });
}
