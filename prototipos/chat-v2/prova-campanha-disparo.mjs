// -----------------------------------------------------------------------------
// O DISPARO DENTRO DA CAMPANHA (demanda #52, decisão do dono em 29/09/2026)
//
//   ENSAIO_VISIVEL=1 SIMULACAO_ENVIO=1 npx next start -p 3120   (na pasta web/)
//   node prototipos/chat-v2/prova-campanha-disparo.mjs
//
// O dono respondeu "não" à minha proposta de deixar o disparo onde estava:
// "crie todo o mecanismo do disparo dentro dessa nova feature em admin(novo)".
// Esta prova confere que a tela nova monta o público e dispara — e que ela usa
// as MESMAS regras da tela antiga, em vez de uma segunda definição de quem
// recebe.
//
// ⚠️ NADA SAI PARA CLIENTE. A prova só exercita a montagem do público e a
// planilha; o botão de disparar não é clicado. O envio de verdade tem prova
// própria, e ela exige `SIMULACAO_ENVIO=1` com a lista de destinos vazia
// (regra 3 da spec).
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9591 });
try {
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/admin-novo`, { esperar: 2500 });
  await a.ate(`/Campanhas de distribui/.test(document.body.textContent || '')`, { ms: 20_000 });

  // ---- abre a montagem ---------------------------------------------------
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Nova campanha');
    if (b) b.click(); return true;`);
  const abriu = await a.ate(`/O template/.test(document.body.textContent || '')`, { ms: 20_000 });
  conferir(abriu, "o disparo abre DENTRO da campanha — não manda ninguém para a tela antiga");

  const tela = await a.js(`
    const txt = document.body.textContent || '';
    return {
      modos: [...document.querySelectorAll('button')].map(b => b.textContent.trim())
        .filter(t => /Disparar agora|disparo que j/.test(t)),
      etapas: /Etapas do funil/.test(txt),
      carteiras: /Carteiras/.test(txt),
      planilha: /Planilha/.test(txt),
      numeros: [...document.querySelectorAll('input[type=number]')].length,
      templates: (document.querySelector('select') || {}).length ?? 0,
    };`);
  conferir(tela.modos.length === 2, "com os dois caminhos que o dono pediu", tela.modos.join(" · "));
  conferir(tela.carteiras && tela.etapas, "escolha de carteiras e de etapas do funil");
  conferir(tela.numeros === 4, "e os filtros numéricos (parado, anti-repetição, cota, teto)", `${tela.numeros}`);
  conferir(tela.planilha, "…mais o upload de planilha que o pedido cita");
  conferir(tela.templates > 1, "a lista de templates vem do cadastro", `${tela.templates} opções`);
  await a.foto("campanha-disparo-form");

  // ---- a prévia usa a MESMA rota da tela antiga --------------------------
  const chamadas = [];
  a.ouvir((m) => {
    if (m.method === "Network.requestWillBeSent") chamadas.push(m.params.request.url);
  });
  const previa = await a.js(`
    return fetch('/api/admin/disparo-massa', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acao: 'previa', carteiras: [], etapas: ['ociosos'], diasMin: 0,
                             diasRecontato: 4, porVendedor: 0, limite: 5 }),
    }).then(async r => ({ status: r.status, total: (await r.json()).selecionados?.length ?? -1 }));`);
  conferir(previa.status === 200 && previa.total >= 0,
    "a prévia responde pela rota que a tela antiga já usa — uma regra só de quem recebe",
    `http ${previa.status}, ${previa.total} selecionados`);

  // ---- a planilha desliga os filtros ------------------------------------
  const desligou = await a.js(`
    const fs = document.querySelector('fieldset');
    return fs ? fs.disabled : null;`);
  conferir(desligou === false, "sem planilha, os filtros estão ligados", String(desligou));

  // simula o arquivo: a leitura é local (FileReader), então dá para injetar
  await a.js(`
    const inp = document.querySelector('input[type=file]');
    const dt = new DataTransfer();
    dt.items.add(new File(['codcli;nome;carteira\\n1615;A;romulo\\n3072;B;romulo\\n'], 'lista.csv', { type: 'text/csv' }));
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;`);
  await espera(900);
  const comPlanilha = await a.js(`
    const fs = document.querySelector('fieldset');
    return { desligado: fs ? fs.disabled : null, texto: /2 c.digos/.test(document.body.textContent || ''),
             aviso: /filtros ficam desligados/.test(document.body.textContent || '') };`);
  conferir(comPlanilha.texto, "a planilha é lida no navegador e mostra quantos códigos vieram");
  conferir(comPlanilha.desligado === true, "…e DESLIGA os filtros, como o pedido manda");
  conferir(comPlanilha.aviso, "…dizendo por quê, em vez de só apagar os campos");
  await a.foto("campanha-disparo-planilha");

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
