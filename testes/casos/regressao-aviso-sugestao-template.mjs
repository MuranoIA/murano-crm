// -----------------------------------------------------------------------------
// Regressão — o administrador é avisado quando chega sugestão de template.
//
// Pedido do usuário em 14/09/2026: "quando consultor criar template (que
// aparece em sugestão de template), deve aparecer uma notificação aviso na tela
// do administrador, para que ele possa aprovar o template. para que o template
// não fique esquecido lá."
//
// ⚠️ ESTE CASO PLANTA UMA SUGESTÃO PORQUE HOJE NÃO HÁ NENHUMA PENDENTE.
// Em 15/09/2026 a fila estava zerada — as 12 sugestões da tabela já tinham sido
// avaliadas. Sem plantar, o selo e a faixa ficariam invisíveis e o caso passaria
// sem medir nada, que é o pior tipo de teste verde.
//
// ---- de onde vem o limiar de 4 horas ---------------------------------------
// Das 11 sugestões já avaliadas, SETE foram respondidas em menos de 4h (mediana
// ~1h) e QUATRO passaram de um dia — duas delas de 9 e 12 dias. A média de 2
// dias e 7 horas engana: ela é puxada por essas duas, que eram testes de agosto.
//
// Daí os DOIS avisos, com papéis diferentes, e é isso que o caso protege:
//   selo  -> aparece desde a primeira. É ambiente: informa, não cobra.
//   faixa -> só depois de 4h. Cobra. Teria aparecido nas 4 que passaram do dia
//            e em NENHUMA das 7 que foram bem.
// Uma faixa que aparecesse sempre estaria errada 7 vezes em 11 — e aviso que
// aparece quando está tudo bem é aviso que se aprende a ignorar.
// -----------------------------------------------------------------------------

export const ciclo = "Regressão — aviso de sugestão de template ao admin";

const NOME = "ensaio aviso sugestao";

/** O selo ao lado de "Administração" — medido pela ESTRUTURA, não pelo texto:
 *  o rótulo tem emoji e o número vive num <span> próprio dentro do link. */
const SELO = `
  (() => {
    const a = [...document.querySelectorAll('a')].find(x => /Administra/.test(x.textContent || ''));
    if (!a) return { achouLink: false };
    const selo = a.querySelector('span');
    return {
      achouLink: true,
      temSelo: !!selo,
      numero: selo ? (selo.textContent || '').trim() : null,
      // vermelho = está cobrando; cinza = só informando
      fundo: selo ? getComputedStyle(selo).backgroundColor : null,
      titulo: a.getAttribute('title') || (selo && selo.getAttribute('title')) || null,
    };
  })()
`;

/** A faixa de cobrança, acima das colunas do board. */
const FAIXA = `
  (() => {
    const d = [...document.querySelectorAll('div')].find(
      x => /sugest(ão|ões) de template/i.test(x.textContent || '')
        && /Avaliar/.test(x.textContent || '')
        && x.querySelectorAll('div').length === 0);
    if (!d) {
      // pode estar no pai: o texto e o link são irmãos
      const p = [...document.querySelectorAll('div')].find(
        x => /espera(m)? sua avalia/i.test(x.textContent || ''));
      return p ? { tem: true, texto: (p.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200) } : { tem: false };
    }
    return { tem: true, texto: (d.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200) };
  })()
`;

export default async function (t) {
  const { api, db } = t;
  if (!t.servidorNoAr) { t.pular("(caso inteiro)", "✅", `servidor fora do ar em ${api.BASE}`); return; }

  let sugId = null;
  let aba = null;

  const limpar = async () => {
    if (sugId) {
      await db.sb.from("template_sugestao").delete().eq("id", sugId);
      sugId = null;
    }
  };

  try {
    await t.passo("0. a fila começa como está — e o caso planta a sua", "✅", async () => {
      const antes = await api.chamar("/api/templates/pendentes", { sessao: api.SESSOES.admin });
      if (antes.status !== 200) throw new Error(`/pendentes devolveu ${antes.status}`);
      const nAntes = Number(antes.json?.n ?? 0);

      const r = await api.chamar("/api/templates/sugestoes", {
        metodo: "POST", sessao: api.SESSOES.romulo,
        corpo: {
          nome: NOME,
          corpo: "Ola {{1}}, passando para avisar de uma novidade da semana.",
          justificativa: "caso de ensaio — apagado no fim deste teste",
        },
      });
      if (r.status !== 200 && r.status !== 201) {
        throw new Error(`criar sugestão devolveu ${r.status}: ${r.texto?.slice(0, 160)}`);
      }
      // acha a linha recém-criada para poder apagá-la no fim
      const { data } = await db.sb.from("template_sugestao")
        .select("id,status").eq("nome", NOME).order("id", { ascending: false }).limit(1);
      sugId = data?.[0]?.id ?? null;
      if (!sugId) throw new Error("não achei a sugestão que acabei de criar");
      if (data[0].status !== "pendente") throw new Error(`nasceu como "${data[0].status}", não pendente`);
      db.anotarRastro(`template_sugestao #${sugId} (ensaio)`, async (c) => {
        await c.from("template_sugestao").delete().eq("id", sugId);
      });
      return `fila era ${nAntes}, plantei a #${sugId}`;
    });

    await t.passo("1. a rota conta para o admin, e cala para o consultor", "✅", async () => {
      const comoAdmin = await api.chamar("/api/templates/pendentes", { sessao: api.SESSOES.admin });
      if (Number(comoAdmin.json?.n ?? 0) < 1) throw new Error("o admin não vê a sugestão pendente");
      if (!comoAdmin.json?.mais_antiga) throw new Error("não veio a data da mais antiga — a faixa não teria idade para mostrar");

      // ⚠️ Silêncio, e não 403: um erro aqui faria a tela do consultor registrar
      // falha a cada carregamento por uma pergunta que ela nem devia fazer.
      const comoVendedor = await api.chamar("/api/templates/pendentes", { sessao: api.SESSOES.luana });
      if (comoVendedor.status !== 200) throw new Error(`para o vendedor devolveu ${comoVendedor.status} — devia calar com 200`);
      if (Number(comoVendedor.json?.n ?? 0) !== 0) throw new Error("o vendedor recebeu a fila do admin");
      return `admin ${comoAdmin.json.n} · vendedor 0`;
    });

    await t.passo("2. RECÉM-CHEGADA: o selo aparece, a faixa NÃO cobra", "✅", async () => {
      aba = await t.aba();
      try {
        await aba.enviar("Network.enable");
        await aba.enviar("Network.setCacheDisabled", { cacheDisabled: true });
      } catch { /* sem cache desligado o passo ainda vale */ }
      await aba.cookies(api.SESSOES.admin, api.BASE);
      await aba.enviar("Emulation.setDeviceMetricsOverride", {
        width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false,
      });
      await aba.ir(`${api.BASE}/`, { esperar: 1200 });
      if (!await aba.ate("/na carteira/.test(document.body.innerText)", { ms: 90_000, passo: 400 })) {
        throw new Error("o board não terminou de carregar");
      }
      await new Promise((r) => setTimeout(r, 3500));

      const selo = await aba.js("return " + SELO.trim());
      if (!selo.achouLink) throw new Error("não achei o item Administração no menu");
      if (!selo.temSelo) throw new Error("o selo não apareceu — a sugestão chegou e o menu não diz nada");
      if (selo.numero !== "1") throw new Error(`o selo diz "${selo.numero}", esperava "1"`);

      const faixa = await aba.js("return " + FAIXA.trim());
      if (faixa.tem) throw new Error("a faixa cobrou uma sugestão recém-chegada — ela só deve cobrar depois de 4h");
      if (aba.excecoes.length) throw new Error(`exceção de JS: ${aba.excecoes[0].slice(0, 160)}`);
      return `selo "1" no menu, sem faixa · foto ${await aba.foto("sugestao_recem_chegada")}`;
    });

    await t.passo("3. ESQUECIDA há 5h: a faixa aparece e diz a idade", "✅", async () => {
      const cincoHoras = new Date(Date.now() - 5 * 3600_000).toISOString();
      const { error } = await db.sb.from("template_sugestao")
        .update({ criado_em: cincoHoras }).eq("id", sugId);
      if (error) throw new Error(`não consegui envelhecer a sugestão: ${error.message}`);

      await aba.ir(`${api.BASE}/`, { esperar: 1200 });
      if (!await aba.ate("/na carteira/.test(document.body.innerText)", { ms: 90_000, passo: 400 })) {
        throw new Error("o board não recarregou");
      }
      await new Promise((r) => setTimeout(r, 3500));

      const faixa = await aba.js("return " + FAIXA.trim());
      if (!faixa.tem) throw new Error("passou de 4h e a faixa não apareceu — é justamente o caso que o usuário pediu");
      if (!/há 5 horas/.test(faixa.texto)) {
        throw new Error(`a faixa não diz a idade certa. texto="${faixa.texto}"`);
      }
      // A idade é o que cria urgência; sem ela "1 pendente" não distingue o
      // normal do esquecido.
      const selo = await aba.js("return " + SELO.trim());
      if (selo.fundo && !/179|b3261e/i.test(selo.fundo)) {
        // rgb(179, 38, 30) = #b3261e
        throw new Error(`o selo devia ficar vermelho quando a faixa cobra; fundo=${selo.fundo}`);
      }
      if (aba.excecoes.length) throw new Error(`exceção de JS: ${aba.excecoes[0].slice(0, 160)}`);
      return `faixa cobrando · "${faixa.texto.slice(0, 90)}…" · foto ${await aba.foto("sugestao_esquecida")}`;
    });

    await t.passo("4. avaliada: selo e faixa somem", "✅", async () => {
      const { error } = await db.sb.from("template_sugestao")
        .update({ status: "aprovado", avaliado_por: "ensaio", avaliado_em: new Date().toISOString() })
        .eq("id", sugId);
      if (error) throw new Error(error.message);

      const r = await api.chamar("/api/templates/pendentes", { sessao: api.SESSOES.admin });
      if (Number(r.json?.n ?? 0) !== 0) throw new Error(`a fila continua em ${r.json?.n} depois de avaliada`);

      await aba.ir(`${api.BASE}/`, { esperar: 1200 });
      await aba.ate("/na carteira/.test(document.body.innerText)", { ms: 90_000, passo: 400 });
      await new Promise((r2) => setTimeout(r2, 3500));
      const selo = await aba.js("return " + SELO.trim());
      if (selo.temSelo) throw new Error("o selo ficou na tela depois de a fila esvaziar");
      const faixa = await aba.js("return " + FAIXA.trim());
      if (faixa.tem) throw new Error("a faixa ficou na tela depois de a fila esvaziar");
      return "menu limpo, board limpo";
    });
  } finally {
    await limpar();
  }
}
