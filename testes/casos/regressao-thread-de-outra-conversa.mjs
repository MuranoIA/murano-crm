// -----------------------------------------------------------------------------
// REGRESSÃO — as mensagens de uma conversa apareciam dentro de outra.
//
// Relatado em 09/09/2026: o consultor manda mensagem para a cliente A, clica no
// nome da cliente B em seguida, e por alguns segundos as últimas mensagens de A
// aparecem na tela de B. Clicar em B de novo "conserta" — porque aí a thread é
// montada do zero.
//
// Não é dado errado no servidor: é uma CORRIDA no navegador. Toda ida à
// `/api/chat/thread` escrevia na thread aberta sem dizer para QUEM ela era, e
// trocar de conversa é sempre mais rápido que a rede. A resposta de A chegava
// depois de B abrir e pintava por cima.
//
// ⚠️ O DEFEITO É UM PISCAR, e medir só o estado final NÃO o encontra — foi o
// primeiro erro deste teste, que passou verde contra o código defeituoso. Se a
// resposta de B chega depois da de A, ela cobre o vazamento em um ou dois
// segundos e a tela termina certa. Por isso aqui a conversa é AMOSTRADA de
// 150 em 150 ms durante a janela toda: o que se afirma é que as mensagens de A
// nunca aparecem, não que sumiram no fim.
//
// O teste não fixa nenhum cliente (o repositório é público, §15.5): escolhe as
// duas conversas no ar, pelo conteúdo, e nunca imprime mensagem — só contagens.
// -----------------------------------------------------------------------------
import { readFileSync } from "node:fs";

export const ciclo = "Regressão — mensagem de uma conversa aparecendo em outra";

const PAGINA = "web/app/chat/page.tsx";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const limpo = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

/** `nomeComCodigo` do app, replicado — é o rótulo que a lista desenha. */
const rotulo = (nome, codcli) => {
  const n = limpo(nome), c = codcli == null ? "" : String(codcli).trim();
  if (!c || !n) return n;
  return new RegExp(`^${c}\\b`).test(n) ? n : `${c} - ${n}`;
};

/**
 * Os botões da lista de conversas.
 *
 * ⚠️ `button:has(b)` NÃO serve: o próprio seletor de fila ("Meus atendimentos")
 * tem um <b> dentro e vira o índice 0 — o teste clicava no dropdown e concluía
 * que a tela não pedia thread nenhuma. O que distingue a linha de conversa é a
 * PROFUNDIDADE: nela o nome está três níveis abaixo do botão
 * (button > span > span > b), por causa do avatar e da linha de prévia.
 */
const LISTA_JS = `[...document.querySelectorAll('button')].filter((btn)=>{
  const b=btn.querySelector('b'); if(!b) return false;
  let d=0,e=b; while(e && e!==btn){ d++; e=e.parentElement; }
  return d===3;
})`;

/**
 * O texto da CONVERSA aberta, e só dele.
 *
 * ⚠️ `document.body.textContent` não serve de régua: a barra lateral mostra a
 * prévia da última mensagem de cada conversa, então um texto da conversa A está
 * legitimamente na tela sem vazamento nenhum — e a primeira versão deste teste
 * acusou exatamente isso. A pista foi a cadeia de ancestrais do achado terminar
 * em BUTTON, que é a linha da lista, não uma bolha.
 *
 * A separação é estrutural e estável: prévia de conversa vive DENTRO de um
 * <button>; bolha de mensagem, não.
 */
const TEXTO_DA_CONVERSA = `(()=>{
  const w=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const partes=[];
  while(w.nextNode()){
    let e=w.currentNode.parentElement, naLista=false;
    while(e){ if(e.tagName==='BUTTON'){ naLista=true; break; } e=e.parentElement; }
    if(!naLista) partes.push(w.currentNode.nodeValue||'');
  }
  return partes.join(' ').replace(/\\s+/g,' ');
})()`;

export default async function (t) {
  const { api } = t;

  await t.passo("1. toda resposta da thread diz para qual conversa ela é", "✅", async () => {
    const src = readFileSync(new URL(`../../${PAGINA}`, import.meta.url), "utf8");
    const faltando = [];
    if (!/const aindaAberta = useCallback/.test(src)) faltando.push("aindaAberta não existe");
    // os quatro caminhos que escrevem na conversa aberta
    for (const [onde, re] of [
      ["carregarThread", /if \(!aindaAberta\(c\.cliente_id\)\) return;/],
      ["apanharNovas", /if \(!aindaAberta\(c\.cliente_id\)\) return 0;/],
      ["carregarAntigas", /if \(!aindaAberta\(sel\.cliente_id\)\) return;/],
      ["carregarContatoDe", /if \(!aindaAberta\(clienteId\)\) return;/],
    ]) if (!re.test(src)) faltando.push(onde);
    // e `abrir()` marca o alvo ANTES do setState: `selRef.current = sel` roda no
    // render, então sem isto o ref ficaria um render atrás durante todo o clique
    // e a guarda compararia com quem acabou de sair da tela
    if (!/function abrir\(c: Conversa\) \{[\s\S]{0,400}?selRef\.current = c;[\s\S]{0,200}?setSel\(c\);/.test(src)) {
      faltando.push("abrir() não marca selRef antes do setSel");
    }
    api.ok(faltando.length === 0, `sem guarda em: ${faltando.join(", ")}`);
    return "guarda presente em carregarThread, apanharNovas, carregarAntigas e carregarContatoDe";
  });

  await t.passo("2. a thread de A chegando atrasada nunca aparece dentro de B", "✅", async () => {
    if (!t.servidorNoAr) throw new Error(`PULAR:servidor fora do ar em ${api.BASE}`);

    // --- escolha das duas conversas, pelo CONTEÚDO -------------------------
    // ⚠️ Pegar "as duas primeiras da lista" não serve: a ordem é por atividade e
    // muda sozinha em base viva. Numa rodada o topo era uma conversa de UMA
    // mensagem, e o teste virou PULADO sem ter medido nada — falso verde.
    const textosDe = async (id) => {
      const r = await api.chamar(`/api/chat/thread?cliente_id=${encodeURIComponent(id)}`,
        { sessao: api.SESSOES.admin });
      return (r.json?.mensagens ?? []).map((m) => limpo(m.conteudo)).filter((x) => x.length >= 14);
    };
    const rl = await api.chamar("/api/chat", { sessao: api.SESSOES.admin });
    api.ok(rl.status === 200, `/api/chat respondeu ${rl.status}`);
    let A = null, B = null;
    for (const c of (rl.json?.conversas ?? []).filter((x) => x.ultima_atividade).slice(0, 16)) {
      const textos = await textosDe(c.cliente_id);
      if (!A) { if (textos.length >= 3) A = { ...c, textos }; continue; }
      // B precisa ter ao menos um texto próprio: é por ele que se sabe QUANDO a
      // thread de B terminou de pintar — sem isso a linha de base seria tirada
      // de uma tela ainda vazia, e o marcador sairia errado
      const proprios = textos.filter((x) => !A.textos.includes(x));
      if (proprios.length) { B = { ...c, textos: proprios }; break; }
    }
    if (!A || !B) throw new Error("PULAR:não achei duas conversas com conteúdo distinto nesta base");

    // --- a tela ------------------------------------------------------------
    const aba = await t.aba();
    let preso = null;                       // { requestId }
    let idas = 0;
    aba.ouvir((m) => {
      if (m.method !== "Fetch.requestPaused") return;
      const { requestId, request } = m.params;
      const id = new URL(request.url).searchParams.get("cliente_id");
      if (id) idas++;
      // segura só a de A, e só a primeira vez
      if (id === A.cliente_id && !preso) { preso = { requestId }; return; }
      aba.enviar("Fetch.continueRequest", { requestId }).catch(() => { /* aba fechou */ });
    });
    await aba.enviar("Fetch.enable", {
      patterns: [{ urlPattern: "*api/chat/thread*", requestStage: "Request" }],
    });

    await aba.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, api.BASE);
    await aba.ir(`${api.BASE}/chat`, { esperar: 2500 });
    // a lista é a rota mais cara do chat (1,3 a 2,2 s): esperar por ela, não por
    // um tempo fixo
    if (!(await aba.ate(`${LISTA_JS}.length >= 2`, { ms: 30_000 }))) {
      throw new Error("PULAR:a lista de conversas não carregou");
    }

    const clicarNome = (nome) => aba.js(`
      const alvo=${JSON.stringify(nome)};
      const b=${LISTA_JS}.find(x=>((x.querySelector('b')||{}).textContent||'').trim()===alvo);
      if(!b) return false; b.click(); return true;
    `);
    const conversaNaTela = () => aba.js(`return ${TEXTO_DA_CONVERSA};`);

    // 1) abre A. A resposta fica PRESA — é o estado em que o consultor clica em
    //    outra pessoa; no relato, logo depois de enviar uma mensagem, que
    //    dispara exatamente esta mesma recarga da conversa.
    if (!(await clicarNome(rotulo(A.cliente, A.codcli)))) {
      throw new Error("PULAR:a conversa escolhida não está na parte visível da lista");
    }
    for (let i = 0; i < 50 && !preso; i++) await espera(100);
    api.ok(preso, "a thread de A não foi interceptada");

    // 2) abre B enquanto a de A ainda está no ar, e espera ELA PINTAR
    if (!(await clicarNome(rotulo(B.cliente, B.codcli)))) {
      throw new Error("PULAR:a segunda conversa não está na parte visível da lista");
    }
    const marcaB = B.textos[0];
    let baseB = "";
    for (let i = 0; i < 80; i++) {                 // até 12 s
      baseB = await conversaNaTela();
      if (baseB.includes(marcaB)) break;
      await espera(150);
    }
    if (!baseB.includes(marcaB)) throw new Error("PULAR:a conversa B não pintou a tempo");

    // 3) o que só existe em A. Fica de fora o que já está na tela de B — assim a
    //    régua se calibra sozinha em vez de depender de conversa nenhuma.
    const soDeA = A.textos.filter((c) => !baseB.includes(c));
    if (!soDeA.length) throw new Error("PULAR:as duas conversas têm o mesmo texto — sem marcador");

    // 4) solta a resposta de A e OLHA O TEMPO TODO. Antes da correção ela
    //    pintava a thread de A por cima da de B por um ou dois segundos.
    await aba.enviar("Fetch.continueRequest", { requestId: preso.requestId });
    const vistos = new Set();
    for (let i = 0; i < 40; i++) {                 // ~6 s de vigilância
      const agora = await conversaNaTela();
      for (const c of soDeA) if (agora.includes(c)) vistos.add(c);
      await espera(150);
    }

    await aba.foto("regressao-thread-de-outra-conversa");
    api.ok(vistos.size === 0,
      `${vistos.size} de ${soDeA.length} mensagens da conversa A apareceram dentro da conversa B`);
    api.ok(aba.excecoes.length === 0, `exceção no navegador: ${aba.excecoes[0]}`);
    return `${soDeA.length} marcadores vigiados por ~6 s · ${idas} idas à thread · nada apareceu`;
  });
}
