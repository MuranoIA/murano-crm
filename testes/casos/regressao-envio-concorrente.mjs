// -----------------------------------------------------------------------------
// Regressão — o envio em massa CONCORRENTE se comporta, sem enviar NADA real.
//
// O #220 trocou o laço "um por vez, com pausa de 1,8 s" por 6 faixas paralelas
// com retentativa. Isso mexe com dinheiro (R$ 0,43 por template) e com o que a
// cliente recebe, e a PR dizia que o laço nunca tinha sido exercitado. Este caso
// o exercita, medindo as três coisas que importam:
//
//   1. há concorrência de verdade (mais de uma chamada em voo) e ela respeita o
//      teto de 6 faixas;
//   2. limite explícito da Meta (130429…) é RETENTADO — a mensagem NÃO saiu;
//   3. erro de REDE NÃO é retentado — não dá para saber se a resposta se perdeu
//      antes ou depois de a Meta receber, e tentar de novo pode mandar o mesmo
//      template DUAS vezes (achado na revisão do #220, 19/09/2026).
//
// ⚠️ COMO NADA REAL SAI (duas travas independentes):
//   a) dentro do navegador, `fetch` de /api/send-template é substituído por um
//      simulador — a chamada nunca chega ao servidor;
//   b) o servidor deste teste DEVE subir com `WHATSAPP_TOKEN=invalido`, para que,
//      mesmo que a trava (a) falhe, a Graph API recuse a autenticação. O passo 0
//      confere isso: sem a segunda trava o caso não roda.
//
// Só a prévia (conferir a planilha) usa dados reais: clientes que já têm contato.
// -----------------------------------------------------------------------------
export const ciclo = "Regressão — envio em massa concorrente (simulado)";

const digitos = (x) => String(x ?? "").replace(/\D/g, "");
const tel8 = (x) => digitos(x).slice(-8);
const N_CODIGOS = 60;

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

export default async function (t) {
  const { api, db } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }
  try { await t.chrome(); } catch (e) { t.pular("(caso inteiro)", "✅", String(e.message).replace(/^PULAR:/, "")); return; }

  // ---- trava (b): o servidor tem de estar com o token inválido ----------------
  await t.passo("0. este servidor NÃO consegue falar com a Meta (segunda trava)", "✅", async () => {
    // O diagnóstico do canal vai à Graph API com o token do servidor. Sem
    // configuração de WhatsApp (ou com token inválido) ele responde erro — e é
    // isso que prova que, mesmo que o simulador falhasse, nada sairia.
    const r = await api.chamar("/api/admin/saude-canal", { sessao: api.SESSOES.admin });
    api.status(r, 200, "GET /api/admin/saude-canal");
    const meta = JSON.stringify(r.json?.meta ?? {});
    api.ok(/Config ausente|Invalid|invalid|190|token/i.test(meta) && !/health_status|verified_name/.test(meta),
      `o servidor conseguiu consultar a Meta — tem token real. Suba SEM as variáveis WHATSAPP_* ou com WHATSAPP_TOKEN=invalido. Resposta: ${meta.slice(0, 200)}`);
    return `sem acesso à Meta: ${meta.slice(0, 90)}`;
  });

  let codigos = [];
  await t.passo(`1. escolhe ${N_CODIGOS} clientes reais com contato existente (a conferência não escreve nada)`, "✅", async () => {
    const carteira = await todos(db.sb, "wth_carteira", "codcli,telefone");
    const contatos = await todos(db.sb, "clientes", "id,telefone");
    const jaTem = new Set(contatos.map((c) => tel8(c.telefone)).filter((x) => x.length === 8));
    codigos = carteira.filter((c) => digitos(c.telefone).length >= 10 && jaTem.has(tel8(c.telefone))).map((c) => Number(c.codcli)).slice(0, N_CODIGOS);
    api.ok(codigos.length === N_CODIGOS, `só ${codigos.length} clientes reais com contato`);
    return `${codigos.length} códigos`;
  });

  await t.passo("2. na tela: prévia real, depois o envio SIMULADO — concorrência, retentativa só do seguro", "✅", async () => {
    const { writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const caminho = `${tmpdir()}/lista-envio-concorrente.csv`;
    writeFileSync(caminho, "codcli\r\n" + codigos.join("\r\n") + "\r\n");

    const aba = await t.aba();
    try {
      await aba.enviar("Emulation.setDeviceMetricsOverride", { width: 1300, height: 1100, deviceScaleFactor: 1, mobile: false });
      await aba.cookies(api.SESSOES.admin);
      await aba.ir(`${api.BASE}/admin`, { esperar: 2500 });
      const clicar = (txt) => aba.js(`const b=[...document.querySelectorAll('button')].find(e=>(e.textContent||'').includes(${JSON.stringify(txt)})); if(!b) return false; b.click(); return true;`);
      const tem = (txt) => `document.body.textContent.includes(${JSON.stringify(txt)})`;

      api.ok(await clicar("Templates"), "não achei a aba Templates");
      await new Promise((r) => setTimeout(r, 2000));
      api.ok(await clicar("Disparo em massa"), "não achei a chave Disparo em massa");
      await new Promise((r) => setTimeout(r, 1500));
      api.ok(await clicar("Planilha"), "não achei a fonte Planilha");

      const doc = await aba.enviar("DOM.getDocument", {});
      const q = await aba.enviar("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
      await aba.enviar("DOM.setFileInputFiles", { nodeId: q.nodeId, files: [caminho] });
      api.ok(await aba.ate(tem(`${N_CODIGOS} código(s) reconhecido(s)`), { ms: 60_000, passo: 300 }), "planilha não reconhecida");
      api.ok(await aba.ate(`[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('Conferir público (${N_CODIGOS})') && !b.disabled)`, { ms: 40_000, passo: 300 }),
        "o botão Conferir ficou desabilitado");
      api.ok(await clicar(`Conferir público (${N_CODIGOS})`), "não cliquei em Conferir");
      api.ok(await aba.ate(tem("vão receber"), { ms: 120_000, passo: 500 }), "a prévia não apareceu");

      // campos extras do template padrão ("campo 2"…): valem para a campanha inteira
      await aba.js(`
        const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
        for (const l of [...document.querySelectorAll('label')].filter(x => /^campo \\d+$/.test((x.textContent||'').trim()))) {
          const inp = l.parentElement.querySelector('input'); if (inp) set(inp, 'ensaio');
        }
        return true;`);
      await new Promise((r) => setTimeout(r, 400));

      // ---- o SIMULADOR de /api/send-template (trava a) ----------------------------
      await aba.js(`
        window.__e = { chamadas: {}, ordem: [], emVoo: 0, maxEmVoo: 0, total: 0, reais: 0 };
        const original = window.fetch.bind(window);
        const seqDe = {};
        window.fetch = async (url, opts) => {
          if (!String(url).includes('/api/send-template')) return original(url, opts);
          const cid = JSON.parse(opts.body).cliente_id;
          if (!(cid in seqDe)) seqDe[cid] = Object.keys(seqDe).length + 1;
          const seq = seqDe[cid];
          window.__e.chamadas[cid] = (window.__e.chamadas[cid] || 0) + 1;
          window.__e.ordem.push({ cid, seq, n: window.__e.chamadas[cid] });
          window.__e.total++;
          window.__e.emVoo++; window.__e.maxEmVoo = Math.max(window.__e.maxEmVoo, window.__e.emVoo);
          await new Promise(r => setTimeout(r, 120));
          window.__e.emVoo--;
          const n = window.__e.chamadas[cid];
          const resp = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
          if (seq === 5) throw new TypeError('Failed to fetch');                                   // queda de REDE
          if (seq === 7) return resp(502, { error: 'Graph 131026: Message undeliverable' });      // falha PERMANENTE
          if (seq % 10 === 3 && n === 1) return resp(502, { error: 'Graph 130429: Rate limit hit' }); // limite da Meta, 1a vez
          return resp(200, { ok: true });
        };
        return true;`);

      api.ok(await aba.ate(`[...document.querySelectorAll('button')].some(b => /^Revisar \\(\\d+\\)$/.test((b.textContent||'').trim()) && !b.disabled)`, { ms: 20_000, passo: 300 }),
        'o botão "Revisar" não ficou habilitado (falta template ou campo?)');
      await aba.js(`[...document.querySelectorAll('button')].find(b => /^Revisar \\(\\d+\\)$/.test((b.textContent||'').trim())).click(); return true;`);
      api.ok(await aba.ate(tem("Confirmar disparo"), { ms: 10_000, passo: 200 }), "a tela de confirmação não abriu");
      const total = await aba.js(`const m=document.body.textContent.match(/Vai enviar\\s*(\\d+)/); return m ? Number(m[1]) : null;`);
      api.ok(total != null && total >= 40, `a confirmação diz ${total} — esperava quase ${N_CODIGOS}`);
      api.ok(await aba.js(`const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').startsWith('Confirmar e enviar')); if(!b) return false; b.click(); return true;`),
        "não achei o botão Confirmar e enviar");
      api.ok(await aba.ate(tem("Concluído"), { ms: 90_000, passo: 300 }), "o envio simulado não terminou");

      const e = await aba.js(`return window.__e;`);
      const ui = await aba.js(`const m=document.body.textContent.match(/(\\d+)\\/(\\d+)\\s*·\\s*✔\\s*(\\d+)\\s*enviados\\s*·\\s*✖\\s*(\\d+)/); return m ? { feitos: +m[1], total: +m[2], ok: +m[3], falhas: +m[4] } : null;`);
      const falhasTxt = await aba.js(`return document.body.textContent.includes('PODE ter saído');`);

      api.ok(e.reais === 0, "uma chamada de envio ESCAPOU do simulador");
      api.ok(e.maxEmVoo >= 2, `nunca houve mais de uma chamada em voo (${e.maxEmVoo}) — o envio não é concorrente`);
      api.ok(e.maxEmVoo <= 6, `chegou a ${e.maxEmVoo} chamadas em voo — passou do teto de 6 faixas`);

      const porSeq = {};
      for (const o of e.ordem) porSeq[o.seq] = Math.max(porSeq[o.seq] ?? 0, o.n);
      api.ok(porSeq[5] === 1, `queda de REDE foi retentada (${porSeq[5]} chamadas) — pode mandar o template em dobro`);
      api.ok(porSeq[7] === 1, `falha permanente (131026) foi retentada (${porSeq[7]} chamadas)`);
      const com429 = Object.entries(porSeq).filter(([s]) => Number(s) % 10 === 3 && Number(s) !== 5 && Number(s) !== 7);
      api.ok(com429.length > 0 && com429.every(([, n]) => n === 2),
        `limite da Meta devia ser retentado UMA vez (2 chamadas): ${JSON.stringify(com429)}`);
      api.ok(ui && ui.feitos === ui.total && ui.total === total, `progresso final incoerente: ${JSON.stringify(ui)} (confirmação: ${total})`);
      api.ok(ui.falhas === 2 && ui.ok === total - 2, `esperava 2 falhas (rede + permanente) e ${total - 2} enviados; a tela diz ${JSON.stringify(ui)}`);
      api.ok(falhasTxt, 'a falha de rede não avisou que "PODE ter saído"');
      api.ok(aba.excecoes.length === 0, `exceção de JS: ${aba.excecoes.slice(0, 2).join(" | ")}`);

      return `${total} clientes · máx ${e.maxEmVoo} em voo · ${e.total} chamadas · ${ui.ok} ok / ${ui.falhas} falhas · rede NÃO retentada, 130429 retentado 1x`;
    } finally { try { await aba.enviar("Page.close"); } catch { /* já foi */ } }
  });
}
