// -----------------------------------------------------------------------------
// Regressão — retomar um envio de PLANILHA interrompido sem mandar em dobro.
//
// O risco (18/09/2026): a planilha pula TODA proteção, inclusive a anti-repetição
// (decisão do usuário: "a planilha já é o resultado curado"). O envio é um laço
// nesta aba; com 5.000 clientes ela fica aberta por muito tempo. Se fechar aos
// 3.000 e a mesma planilha for enviada de novo, os primeiros 3.000 recebem em
// DOBRO — e a tela dizia "é só rodar de novo, que quem já recebeu fica de fora",
// o que era FALSO para planilha.
//
// Agora a prévia INFORMA quem já recebeu este template nas últimas 12 h, e a
// tela obriga a escolher entre pular esses ou enviar para todos de novo.
//
// ⚠️ NADA É ENVIADO. O envio da tela é substituído por um simulador dentro do
// navegador e este servidor não tem configuração de WhatsApp (passo 0). As únicas
// escritas são as linhas de ensaio em `disparos_template` (id `ensaio-retomar-*`),
// apagadas no fim — e registradas para limpeza mesmo se o teste for interrompido.
// -----------------------------------------------------------------------------
export const ciclo = "Regressão — retomar envio de planilha sem duplicar";

const digitos = (x) => String(x ?? "").replace(/\D/g, "");
const tel8 = (x) => digitos(x).slice(-8);
const N = 60;
const JA = 20;

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

// Lê o que a TELA mostra — e compara a tela com ela mesma. Os números não podem vir
// de uma conta feita antes na API: a equipe envia template em produção o dia todo,
// e um envio real no meio do teste mudaria "quem já recebeu" sem culpa da tela.
// (o número está num <b> próprio: no texto corrido ele gruda no dígito anterior — "5" + "21" → "521")
const LER_JA = `const b=[...document.querySelectorAll('b')].find(x=>/^\\d[\\d.]*$/.test((x.textContent||'').trim()) && /desta lista\\s*já receberam este template/.test((x.parentElement&&x.parentElement.textContent)||'')); return b ? Number(b.textContent.trim().replace(/\\./g,'')) : null;`;
const LER_TOTAL = `const m=document.body.textContent.match(/vão receber\\s*(\\d[\\d.]*)/); return m ? Number(m[1].replace(/\\./g,'')) : null;`;

export default async function (t) {
  const { api, db } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  const plantadas = [];
  const limpar = async () => {
    if (!plantadas.length) return;
    await db.sb.from("disparos_template").delete().in("id", plantadas.splice(0));
  };
  db.anotarRastro("linhas ensaio-retomar-* em disparos_template", async (c) => {
    await c.from("disparos_template").delete().like("id", "ensaio-retomar-%");
  });

  const plantar = async (cards, template, horasAtras = 0) => {
    const rows = cards.map((c, i) => ({
      id: `ensaio-retomar-${template}-${horasAtras}-${i}-${Date.now()}`,
      cliente_id: c.cliente_id, telefone: c.telefone, vendedor: null, template_id: template, status: "sent",
      criada_em: new Date(Date.now() - horasAtras * 3_600_000).toISOString(),
    }));
    const { error } = await db.sb.from("disparos_template").insert(rows);
    if (error) throw new Error(`não consegui plantar: ${error.message}`);
    plantadas.push(...rows.map((r) => r.id));
  };

  // O que a tela DEVE mostrar, calculado pela API: cards com o mesmo telefone viram
  // UM contato, então "20 já receberam" e "59 selecionados" não são contas de
  // cabeça — são o que a prévia devolve.
  const esperadoDaApi = async (cards, template) => {
    const r = await api.chamar("/api/admin/disparo-massa", {
      metodo: "POST", sessao: api.SESSOES.admin, corpo: { acao: "previa", cards, pularProtecoes: true, templateEnvioId: template },
    });
    api.status(r, 200, "prévia de referência");
    return { ja: r.json.jaReceberam.length, tot: r.json.selecionados.length };
  };

  try {
    await t.passo("0. este servidor NÃO consegue falar com a Meta", "✅", async () => {
      const r = await api.chamar("/api/admin/saude-canal", { sessao: api.SESSOES.admin });
      const meta = JSON.stringify(r.json?.meta ?? {});
      api.ok(/Config ausente|Invalid|invalid|190|token/i.test(meta) && !/health_status|verified_name/.test(meta),
        `o servidor conseguiu consultar a Meta — tem token real. Resposta: ${meta.slice(0, 200)}`);
      return `sem acesso à Meta: ${meta.slice(0, 80)}`;
    });

    let codigos = [], cards = [];
    await t.passo(`1. ${N} clientes reais com contato existente, conferidos (só leitura)`, "✅", async () => {
      const carteira = await todos(db.sb, "wth_carteira", "codcli,telefone");
      const contatos = await todos(db.sb, "clientes", "id,telefone");
      const jaTem = new Set(contatos.map((c) => tel8(c.telefone)).filter((x) => x.length === 8));
      codigos = carteira.filter((c) => digitos(c.telefone).length >= 10 && jaTem.has(tel8(c.telefone))).map((c) => Number(c.codcli)).slice(0, N);
      const r = await api.chamar("/api/admin/disparo-massa", { metodo: "POST", sessao: api.SESSOES.admin, corpo: { acao: "resolver", codclis: codigos } });
      api.status(r, 200, "resolver");
      cards = r.json.cards;
      api.ok(cards.length >= JA + 10, `só ${cards.length} cards resolvidos`);
      return `${cards.length} cards`;
    });

    await t.passo("2. API: a prévia da planilha diz QUEM já recebeu este template — e só nas últimas 12 h", "✅", async () => {
      const TPL = "ensaio_retomar_tpl";
      const dentro = cards.slice(0, 5), fora = cards.slice(5, 7), outro = cards.slice(7, 9);
      await plantar(dentro, TPL, 0);        // recebeu agora
      await plantar(fora, TPL, 13);         // 13 h atrás: FORA da janela
      await plantar(outro, "ensaio_outro_tpl", 0);   // outro template: não conta

      const previa = (extra) => api.chamar("/api/admin/disparo-massa", {
        metodo: "POST", sessao: api.SESSOES.admin, corpo: { acao: "previa", cards, ...extra },
      });
      const com = await previa({ pularProtecoes: true, templateEnvioId: TPL });
      api.status(com, 200, "prévia com template");
      const got = new Set(com.json.jaReceberam);
      const esperado = new Set(dentro.map((c) => c.cliente_id));
      api.ok(got.size === esperado.size && [...esperado].every((x) => got.has(x)),
        `jaReceberam devia ser exatamente os 5 de agora; veio ${JSON.stringify([...got])}`);
      const semTplRef = await previa({ pularProtecoes: true });
      api.ok(com.json.selecionados.length === semTplRef.json.selecionados.length,
        "informar quem já recebeu NÃO pode cortar ninguém: a planilha continua sendo o público inteiro");
      api.igual(com.json.janelaRetomadaHoras, 12, "janela informada");

      const semTpl = await previa({ pularProtecoes: true });
      api.igual(semTpl.json.jaReceberam.length, 0, "sem templateEnvioId não há o que comparar");
      const listaManual = await previa({ pularProtecoes: false, templateEnvioId: TPL, filtros: { diasRecontato: 0 } });
      api.igual(listaManual.json.jaReceberam.length, 0, "lista manual tem a própria proteção — só a planilha informa");
      await limpar();
      return `5 de agora, 0 fora da janela (13 h), 0 de outro template · ${com.json.selecionados.length} selecionados intactos`;
    });

    await t.passo("3. TELA: envio interrompido — escolher pular, retomar, e nada em dobro (envio simulado)", "✅", async () => {
      try { await t.chrome(); } catch (e) { throw new Error("PULAR:" + String(e.message).replace(/^PULAR:/, "")); }
      const cfg = (await api.chamar("/api/admin/disparo-massa", { sessao: api.SESSOES.admin })).json?.["disparo-massa"];
      const tpls = cfg?.templates ?? [];
      const escolhido = tpls.find((x) => Number(x.id) === 0) ?? tpls.find((x) => x.padrao) ?? tpls[0];
      api.ok(escolhido?.envio_id, "não achei o template que a tela escolhe por padrão");
      // planta "o envio que foi interrompido": os JA primeiros já receberam ESTE template
      const jaRecebidos = cards.slice(0, JA);
      await plantar(jaRecebidos, escolhido.envio_id, 0);
      const jaIds = new Set(jaRecebidos.map((c) => c.cliente_id));
      const { ja: JA_N, tot: TOT } = await esperadoDaApi(cards, escolhido.envio_id);
      api.ok(JA_N >= 10, `só ${JA_N} já-receberam na prévia de referência`);

      const { writeFileSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const caminho = `${tmpdir()}/lista-retomar.csv`;
      writeFileSync(caminho, "codcli\r\n" + codigos.join("\r\n") + "\r\n");

      const aba = await t.aba();
      try {
        await aba.enviar("Emulation.setDeviceMetricsOverride", { width: 1300, height: 1200, deviceScaleFactor: 1, mobile: false });
        await aba.cookies(api.SESSOES.admin);
        await aba.ir(`${api.BASE}/admin`, { esperar: 2500 });
        const clicar = (txt) => aba.js(`const b=[...document.querySelectorAll('button')].find(e=>(e.textContent||'').includes(${JSON.stringify(txt)})); if(!b) return false; b.click(); return true;`);
        const tem = (txt) => `document.body.textContent.includes(${JSON.stringify(txt)})`;
        const botaoHabilitado = (rotulo) => `[...document.querySelectorAll('button')].some(b => (b.textContent||'').trim().startsWith(${JSON.stringify(rotulo)}) && !b.disabled)`;

        api.ok(await clicar("Templates"), "aba Templates"); await new Promise((r) => setTimeout(r, 2000));
        api.ok(await clicar("Disparo em massa"), "chave Disparo em massa"); await new Promise((r) => setTimeout(r, 1500));
        api.ok(await clicar("Planilha"), "fonte Planilha");
        const doc = await aba.enviar("DOM.getDocument", {});
        const q = await aba.enviar("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
        await aba.enviar("DOM.setFileInputFiles", { nodeId: q.nodeId, files: [caminho] });
        api.ok(await aba.ate(tem(`${codigos.length} código(s) reconhecido(s)`), { ms: 60_000, passo: 300 }), "planilha não reconhecida");
        api.ok(await aba.ate(botaoHabilitado(`Conferir público (${codigos.length})`), { ms: 40_000, passo: 300 }), "botão Conferir preso");
        api.ok(await clicar(`Conferir público (${codigos.length})`), "clicar em Conferir");
        api.ok(await aba.ate(tem("vão receber"), { ms: 120_000, passo: 500 }), "prévia não apareceu");

        // o aviso aparece, com o número certo
        api.ok(await aba.ate(`(() => { ${LER_JA} })() !== null`, { ms: 10_000, passo: 200 }),
          "a tela não avisou quantos já receberam este template");
        const jaTela = await aba.js(LER_JA);
        const totAntes = await aba.js(LER_TOTAL);
        api.ok(jaTela >= JA - 5, `a tela avisou ${jaTela} já-receberam; plantei ${JA} (menos duplicados de telefone)`);
        const rolarAoAviso = () => aba.js(`const e=[...document.querySelectorAll('div')].filter(x=>(x.textContent||'').includes('já receberam este template') && x.children.length>0).pop(); if(e) e.scrollIntoView({block:'center'}); return !!e;`);
        await rolarAoAviso(); await new Promise((r) => setTimeout(r, 400));
        const foto = await aba.foto("retomar_aviso");

        // preenche os campos extras do template (valem para a campanha inteira)
        await aba.js(`
          const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
          for (const l of [...document.querySelectorAll('label')].filter(x => /^campo \\d+$/.test((x.textContent||'').trim()))) {
            const inp = l.parentElement.querySelector('input'); if (inp) set(inp, 'ensaio');
          }
          return true;`);
        await new Promise((r) => setTimeout(r, 400));

        // ⚠️ SEM ESCOLHER, "Revisar" não destrava: é isso que impede o envio em dobro por descuido
        const revisarTravado = await aba.js(`const b=[...document.querySelectorAll('button')].find(x=>/^Revisar \\(\\d+\\)/.test((x.textContent||'').trim())); return b ? b.disabled : null;`);
        api.ok(revisarTravado === true, `"Revisar" estava habilitado sem a pessoa escolher o que fazer com quem já recebeu — foto ${foto}`);

        const cliquePular = await clicar(`Pular esses ${jaTela}`);
        if (!cliquePular) {
          const bts = await aba.js(`return [...document.querySelectorAll('button')].map(b=>(b.textContent||'').trim()).filter(x=>/Pular|Enviar para|Revisar/.test(x));`);
          throw new Error(`botão Pular esses ${jaTela} não achado. Botões: ${JSON.stringify(bts)}`);
        }
        await rolarAoAviso(); await new Promise((r) => setTimeout(r, 400));
        await aba.foto("retomar_depois_de_pular");
        const restantes = await aba.js(`const m=document.body.textContent.match(/vão receber\\s*(\\d+)/); return m ? Number(m[1]) : null;`);
        api.ok(restantes === totAntes - jaTela, `depois de pular, "vão receber" devia ser ${totAntes - jaTela} (${totAntes} - ${jaTela}); a tela diz ${restantes}`);
        api.ok(await aba.ate(botaoHabilitado("Revisar"), { ms: 5_000, passo: 200 }), '"Revisar" não destravou depois da escolha');
        await aba.js(`[...document.querySelectorAll('button')].find(b => /^Revisar \\(\\d+\\)/.test((b.textContent||'').trim())).click(); return true;`);
        api.ok(await aba.ate(tem("retomando de onde parou"), { ms: 10_000, passo: 200 }), "a confirmação não repetiu que está retomando");

        // ---- envio SIMULADO -----------------------------------------------------------
        await aba.js(`
          window.__e = { chamadas: [], reais: 0 };
          const original = window.fetch.bind(window);
          window.fetch = async (url, opts) => {
            if (!String(url).includes('/api/send-template')) return original(url, opts);
            window.__e.chamadas.push(JSON.parse(opts.body).cliente_id);
            await new Promise(r => setTimeout(r, 60));
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
          };
          return true;`);
        api.ok(await aba.js(`const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').startsWith('Confirmar e enviar')); if(!b) return false; b.click(); return true;`), "Confirmar e enviar");
        api.ok(await aba.ate(tem("Concluído"), { ms: 60_000, passo: 300 }), "o envio simulado não terminou");

        const e = await aba.js(`return window.__e;`);
        const repetidos = e.chamadas.filter((id) => jaIds.has(id));
        api.ok(repetidos.length === 0, `${repetidos.length} cliente(s) que JÁ receberam foram enviados de novo: ${JSON.stringify(repetidos.slice(0, 3))}`);
        api.ok(e.chamadas.length === restantes, `o envio fez ${e.chamadas.length} chamadas, esperava ${restantes} (os restantes)`);
        api.ok(new Set(e.chamadas).size === e.chamadas.length, "algum cliente foi chamado duas vezes no mesmo envio");
        api.ok(aba.excecoes.length === 0, `exceção de JS: ${aba.excecoes.slice(0, 2).join(" | ")}`);
        return `${jaTela} já tinham recebido → pulados; ${e.chamadas.length} enviados (simulado), nenhum em dobro`;
      } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
    });

    await t.passo('4. TELA: "enviar para todos de novo" é possível, mas a confirmação AVISA que vai duplicar', "✅", async () => {
      try { await t.chrome(); } catch (e) { throw new Error("PULAR:" + String(e.message).replace(/^PULAR:/, "")); }
      const cfg = (await api.chamar("/api/admin/disparo-massa", { sessao: api.SESSOES.admin })).json?.["disparo-massa"];
      const tpls = cfg?.templates ?? [];
      const escolhido = tpls.find((x) => Number(x.id) === 0) ?? tpls.find((x) => x.padrao) ?? tpls[0];
      await plantar(cards.slice(0, JA), escolhido.envio_id, 0);
      const { ja: JA_N, tot: TOT } = await esperadoDaApi(cards, escolhido.envio_id);
      const { writeFileSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const caminho = `${tmpdir()}/lista-retomar.csv`;
      writeFileSync(caminho, "codcli\r\n" + codigos.join("\r\n") + "\r\n");

      const aba = await t.aba();
      try {
        await aba.enviar("Emulation.setDeviceMetricsOverride", { width: 1300, height: 1200, deviceScaleFactor: 1, mobile: false });
        await aba.cookies(api.SESSOES.admin);
        await aba.ir(`${api.BASE}/admin`, { esperar: 2500 });
        const clicar = (txt) => aba.js(`const b=[...document.querySelectorAll('button')].find(e=>(e.textContent||'').includes(${JSON.stringify(txt)})); if(!b) return false; b.click(); return true;`);
        const tem = (txt) => `document.body.textContent.includes(${JSON.stringify(txt)})`;
        await clicar("Templates"); await new Promise((r) => setTimeout(r, 2000));
        await clicar("Disparo em massa"); await new Promise((r) => setTimeout(r, 1500));
        await clicar("Planilha");
        const doc = await aba.enviar("DOM.getDocument", {});
        const q = await aba.enviar("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
        await aba.enviar("DOM.setFileInputFiles", { nodeId: q.nodeId, files: [caminho] });
        api.ok(await aba.ate(tem(`${codigos.length} código(s) reconhecido(s)`), { ms: 60_000, passo: 300 }), "planilha não reconhecida");
        api.ok(await aba.ate(`[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('Conferir público (${codigos.length})') && !b.disabled)`, { ms: 40_000, passo: 300 }), "botão preso");
        await clicar(`Conferir público (${codigos.length})`);
        api.ok(await aba.ate(`(() => { ${LER_JA} })() !== null`, { ms: 120_000, passo: 300 }), "sem aviso");
        const jaTela4 = await aba.js(LER_JA);
        const tot4 = await aba.js(LER_TOTAL);
        await aba.js(`
          const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
          for (const l of [...document.querySelectorAll('label')].filter(x => /^campo \\d+$/.test((x.textContent||'').trim()))) {
            const inp = l.parentElement.querySelector('input'); if (inp) set(inp, 'ensaio');
          }
          return true;`);
        api.ok(await clicar(`Enviar para todos os ${tot4}`), "botão Enviar para todos");
        api.ok(await aba.ate(`[...document.querySelectorAll('button')].some(b => /^Revisar \\(${tot4}\\)/.test((b.textContent||'').trim()) && !b.disabled)`, { ms: 5_000, passo: 200 }),
          `"Revisar (${tot4})" não destravou com todos`);
        await aba.js(`[...document.querySelectorAll('button')].find(b => /^Revisar \\(\\d+\\)/.test((b.textContent||'').trim())).click(); return true;`);
        api.ok(await aba.ate(tem("vão receber de novo"), { ms: 10_000, passo: 200 }),
          "a confirmação NÃO avisou que quem já recebeu vai receber de novo");
        // PARA AQUI: não confirma o envio
        return `com "todos" a confirmação avisa que ${jaTela4} vão receber de novo — não enviei`;
      } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
    });
  } finally {
    await limpar();
  }
}
