// -----------------------------------------------------------------------------
// RESPONDER CITANDO uma mensagem, como no WhatsApp.
//
//   node prototipos/chat-v2/prova-citar.mjs
//
// O que precisa ser verdade, e por que cada item existe:
//
//   · o botao aparece na mensagem da CLIENTE e na NOSSA, e em MIDIA;
//   · NAO aparece onde nao da para citar (id nosso `tmp:`, id herdado do RD):
//     citar um id que a Meta nao conhece faz o Graph recusar a mensagem
//     INTEIRA com 131009, e o que a pessoa escreveu se perde por causa do
//     enfeite;
//   · o trecho fica VISIVEL acima da caixa enquanto se escreve, senao a pessoa
//     esquece a que esta respondendo;
//   · o envio leva `responder_a`, e a citacao SOME depois -- uma citacao que
//     sobra e a proxima mensagem respondendo a coisa errada;
//   · trocar de conversa limpa a citacao;
//   · ⚠️ o SERVIDOR recusa citar mensagem de OUTRA conversa. Esta e a parte de
//     seguranca: `context.message_id` vai direto para a Meta, e sem conferir a
//     tela poderia pedir para citar o wamid de outra cliente.
//
// ⚠️ Com `SIMULACAO_ENVIO=1` o envio devolve um wamid falso ANTES de falar com
// a Meta -- entao o que se prova aqui e a NOSSA tubulacao (tela -> rota ->
// banco), nao o `context` chegando ao WhatsApp. Isso so a Fase C confirma.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ENSAIO = process.env.ENSAIO || "wa:559190000077";
const COOKIE = "crm_sessao=admin; crm_email=ia@muranoprofessional.com.br";

const passos = [];
const ok = (n, d = "") => passos.push({ n, ok: true, d });
const falha = (n, d = "") => passos.push({ n, ok: false, d });

// ---- a peça de ensaio -----------------------------------------------------
// A conversa de ensaio é fabricada, então as mensagens dela têm ids nossos
// (`ensaio.`/`sim.`) — nenhuma é citável, que é exatamente o que o teste acima
// verifica. Para exercitar o caminho FELIZ é preciso uma com id no formato da
// Meta; ela é plantada aqui e removida no fim.
//
// ⚠️ De propósito na conversa de ensaio, e não numa real: escrever numa
// conversa de verdade não envia nada (SIMULACAO_ENVIO), mas deixa uma linha que
// aparece no chat dos consultores.
const FIXO = `wamid.ENSAIOCITAR${Date.now()}`;
await sb.from("mensagens").insert({
  id: FIXO,
  cliente_id: ENSAIO,
  enviada_por: "customer",
  tipo: "mensagem",
  conteudo: "ensaio: mensagem que vai ser citada",
  status: "success",
  criada_em: new Date().toISOString(),
  // ⚠️ COM `linha_id`. `filtroLinhas` exclui `linha_id IS NULL` sempre, desde o
  // fim do RD (§69) — uma peça sem linha simplesmente não aparece na thread, e
  // o teste acusaria "não há mensagem citável" achando que é bug da tela.
  linha_id: (await sb.from("chat_linha").select("phone_number_id").eq("ativo", true).limit(1)
    .then((r) => r.data?.[0]?.phone_number_id ?? null)),
});

const chrome = await subirChrome({ porta: 9435 });
try {
  const aba = await novaAba(chrome);
  await aba.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await aba.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ENSAIO)}`, { esperar: 7000 });

  const pronta = await aba.ate(`!!document.querySelector('textarea')`, { ms: 25_000 });
  if (!pronta) {
    falha("a conversa de ensaio abre");
  } else {
    ok("a conversa de ensaio abre");

    // espiona o corpo do envio sem deixar nada sair para a Meta
    await aba.js(`
      window.__envios = [];
      const original = window.fetch;
      window.fetch = function (entrada, opcoes) {
        const url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || '';
        if (url.includes('/api/send-message') && opcoes && opcoes.body) {
          try { window.__envios.push(JSON.parse(opcoes.body)); } catch {}
        }
        return original.apply(this, arguments);
      };
      return true;`);

    // ---- 1. o botão só existe onde dá para citar -------------------------
    const mapa = await aba.js(`
      const bolhas = [...document.querySelectorAll('[data-msg]')];
      return bolhas.map(b => ({
        id: b.getAttribute('data-msg'),
        temResponder: [...b.querySelectorAll('button')].some(x => /responder/i.test(x.textContent||'')),
      }));`);
    const citaveis = mapa.filter((m) => m.id.startsWith("wamid."));
    const naoCitaveis = mapa.filter((m) => !m.id.startsWith("wamid."));
    citaveis.length && citaveis.every((m) => m.temResponder)
      ? ok("o botão responder existe em toda mensagem citável", `${citaveis.length} bolhas`)
      : falha("o botão responder existe em toda mensagem citável", JSON.stringify(citaveis.slice(0, 3)));
    naoCitaveis.every((m) => !m.temResponder)
      ? ok("e NÃO existe no que a Meta não conhece", `${naoCitaveis.length} bolhas sem wamid`)
      : falha("e NÃO existe no que a Meta não conhece", JSON.stringify(naoCitaveis.slice(0, 3)));

    // ---- 2. clicar mostra o trecho acima da caixa ------------------------
    const alvo = citaveis[citaveis.length - 1]?.id;
    if (!alvo) falha("há uma mensagem citável na conversa de ensaio");
    else {
      ok("há uma mensagem citável na conversa de ensaio");
      await aba.js(`
        const b = document.querySelector('[data-msg="${alvo}"]');
        const r = [...b.querySelectorAll('button')].find(x => /responder/i.test(x.textContent||''));
        if (r) r.click(); return true;`);
      const faixa = await aba.ate(`/respondendo (você|a cliente)/i.test(document.body.textContent||'')`, { ms: 6000 });
      faixa ? ok("o trecho citado aparece acima da caixa") : falha("o trecho citado aparece acima da caixa");

      const focou = await aba.js(`return document.activeElement && document.activeElement.tagName === 'TEXTAREA';`);
      focou ? ok("o cursor vai para a caixa") : falha("o cursor vai para a caixa");

      // ---- 3. o X cancela -----------------------------------------------
      await aba.js(`
        const b = [...document.querySelectorAll('button')].find(x => /Cancelar a citação/i.test(x.getAttribute('aria-label')||''));
        if (b) b.click(); return true;`);
      const sumiu = await aba.ate(`!/respondendo (você|a cliente)/i.test(document.body.textContent||'')`, { ms: 5000 });
      sumiu ? ok("o X cancela a citação") : falha("o X cancela a citação");

      // ---- 4. envia citando ---------------------------------------------
      await aba.js(`
        const b = document.querySelector('[data-msg="${alvo}"]');
        const r = [...b.querySelectorAll('button')].find(x => /responder/i.test(x.textContent||''));
        if (r) r.click(); return true;`);
      await espera(500);
      await aba.js(`
        const campo = document.querySelector('textarea');
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        set.call(campo, 'ensaio: citando');
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;`);
      await espera(2500);

      const envios = await aba.js(`return window.__envios;`);
      const comCitacao = (envios ?? []).find((e) => e.responder_a === alvo);
      comCitacao
        ? ok("o envio leva `responder_a` com o id certo")
        : falha("o envio leva `responder_a`", JSON.stringify(envios).slice(0, 200));

      const limpou = await aba.ate(`!/respondendo (você|a cliente)/i.test(document.body.textContent||'')`, { ms: 6000 });
      limpou
        ? ok("a citação some depois de enviar")
        : falha("a citação some depois de enviar — a próxima mensagem responderia a coisa errada");

      // a bolha nova tem de mostrar o trecho citado
      const naBolha = await aba.ate(
        `[...document.querySelectorAll('[data-msg]')].some(b => /ensaio: citando/.test(b.textContent||'') && /CLIENTE|VOCÊ/i.test(b.textContent||''))`,
        { ms: 8000 },
      );
      naBolha
        ? ok("a bolha enviada mostra o trecho citado")
        : falha("a bolha enviada mostra o trecho citado");

      // ---- 5. o que o BANCO guardou -------------------------------------
      const { data } = await sb.from("mensagens")
        .select("id,conteudo,resposta_a").eq("cliente_id", ENSAIO)
        .eq("conteudo", "ensaio: citando").order("criada_em", { ascending: false }).limit(1);
      data?.[0]?.resposta_a === alvo
        ? ok("o banco guardou o `resposta_a`", data[0].id)
        : falha("o banco guardou o `resposta_a`", JSON.stringify(data?.[0] ?? null));
    }

    // ---- 6. ⚠️ o servidor recusa citar mensagem de OUTRA conversa --------
    const { data: alheia } = await sb.from("mensagens")
      .select("id,cliente_id").neq("cliente_id", ENSAIO).like("id", "wamid.%").limit(1);
    if (!alheia?.[0]) falha("achou uma mensagem de outra conversa para o teste");
    else {
      ok("achou uma mensagem de outra conversa para o teste");
      const r = await fetch(`${BASE}/api/send-message`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: COOKIE },
        body: JSON.stringify({ cliente_id: ENSAIO, texto: "ensaio: citacao alheia", responder_a: alheia[0].id }),
      });
      const passou = r.ok;
      await espera(1200);
      const { data: gravada } = await sb.from("mensagens")
        .select("id,resposta_a").eq("cliente_id", ENSAIO)
        .eq("conteudo", "ensaio: citacao alheia").order("criada_em", { ascending: false }).limit(1);
      // a mensagem SAI (perder o texto por causa do enfeite seria pior), mas a
      // citação é descartada — é a régua de `lib/citacao.ts`
      passou && gravada?.[0] && gravada[0].resposta_a === null
        ? ok("citar mensagem de OUTRA conversa é recusado, e a mensagem sai sem citação")
        : falha("citar mensagem de outra conversa é recusado",
            `http ${r.status}, resposta_a = ${JSON.stringify(gravada?.[0]?.resposta_a)}`);
    }
  }

  aba.excecoes.length
    ? falha("sem exceção no console", aba.excecoes.slice(0, 2).join(" | "))
    : ok("sem exceção no console");
} finally {
  // limpa a peça e o que o teste escreveu
  await sb.from("mensagens").delete().eq("id", FIXO);
  await sb.from("mensagens").delete().eq("cliente_id", ENSAIO)
    .in("conteudo", ["ensaio: citando", "ensaio: citacao alheia"]);
  fecharChrome(chrome);
}

const bons = passos.filter((p) => p.ok).length;
for (const p of passos) console.log(`${p.ok ? "OK  " : "FALHA"} ${p.n}${p.d ? ` — ${p.d}` : ""}`);
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
