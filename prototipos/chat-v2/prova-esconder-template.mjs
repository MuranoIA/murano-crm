// -----------------------------------------------------------------------------
// TIRAR UM TEMPLATE DA LISTA DO CHAT (demanda #59, 02/10/2026)
//
//   ENSAIO_VISIVEL=1 npx next start -p 3122     (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-esconder-template.mjs
//
// O pedido do dono: "a lista fica extensa e há templates desatualizados que só
// serviam para eventos específicos que a data já passou... um botão que permite
// fazer com que esse template desapareça dessa lista, não precisa
// necessariamente apagar de fato da meta".
//
// ⚠️ A prova cria DOIS templates de ensaio em `crm_templates`. Não há banco de
// teste neste projeto, então por ~1 minuto eles aparecem na lista de quem
// estiver com o chat aberto — por isso o nome começa com "ENSAIO". Nada é
// enviado a ninguém e nada é criado na Meta: a prova só mexe no cadastro local.
// O `finally` apaga os dois.
//
// O que se afirma aqui, e que não dá para afirmar lendo o código:
//  1. o botão só aparece para um template que PODE sair (o padrão não pode);
//  2. um clique não basta — a ação vale para toda a equipe;
//  3. depois de tirar, ele some da lista NA HORA, sem recarregar a tela;
//  4. o banco guarda QUEM tirou e QUANDO, que é o que o admin vai ler;
//  5. quem não é admin consegue esconder e NÃO consegue editar mais nada;
//  6. o admin devolve à lista, e a marca é LIMPA junto.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3122";
const TEL = "5591900000" + "59";
const ID = `wa:${TEL}`;
const MARCA = `esc-${Date.now()}`;
const EU = "ia@muranoprofessional.com.br";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9651 });
let idAlvo = null, idPadrao = null;
try {
  // ---- o cenário ---------------------------------------------------------
  // dois templates de ensaio: um que deve poder sair, e um marcado como padrão
  // para provar que o padrão NÃO sai (quebraria o botão do card e o disparo).
  const base = {
    canal: "cloud", status: "APPROVED", ativo: true, idioma: "pt_BR",
    usa_nome: false, meta_nome: null,
  };
  const { data: alvo, error: e1 } = await sb.from("crm_templates").insert({
    ...base, nome: `ENSAIO alvo ${MARCA}`, corpo: "ENSAIO — não enviar. Texto do alvo.",
  }).select("id").single();
  if (e1) throw new Error(`não criei o template de ensaio: ${e1.message}`);
  idAlvo = alvo.id;

  // o padrão de VERDADE do sistema não é tocado: a prova pergunta por ele e usa
  // o que já existe, porque só pode haver um (índice único parcial)
  const { data: pad } = await sb.from("crm_templates")
    .select("id,nome").eq("padrao", true).eq("ativo", true).maybeSingle();
  idPadrao = pad?.id ?? null;
  conferir(!!idPadrao, "existe um template padrão para a regra ser exercitada", String(pad?.nome ?? "—"));

  // a conversa: uma mensagem recebida AGORA deixa a janela de 24h aberta, que é
  // o estado em que o botão de template mora na barra (com a janela fechada ele
  // muda de lugar, e a prova mediria outra tela)
  await sb.from("clientes").upsert(
    { id: ID, nome_completo: "ENSAIO esconder template (não é cliente)", telefone: TEL, carteira: null },
    { onConflict: "id" },
  );
  const { data: ref } = await sb.from("mensagens")
    .select("linha_id").not("linha_id", "is", null).limit(1).maybeSingle();
  await sb.from("mensagens").upsert({
    id: `${MARCA}.1`, cliente_id: ID, enviada_por: "customer", tipo: "mensagem",
    conteudo: "mensagem de ensaio", status: "success",
    criada_em: new Date(Date.now() - 60_000).toISOString(), linha_id: ref?.linha_id ?? null,
  }, { onConflict: "id" });

  // ---- a tela ------------------------------------------------------------
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: EU }, BASE);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ID)}`, { esperar: 3000 });
  await a.ate(`document.querySelector('button[aria-label="Template"]')`, { ms: 25_000 });
  await a.js(`document.querySelector('button[aria-label="Template"]').click(); return true;`);
  await a.ate(`/Enviar template/.test(document.body.textContent || '')`, { ms: 15_000 });
  await a.ate(`document.querySelector('select')`, { ms: 15_000 });
  await espera(400);

  const temNaLista = await a.js(`
    const s = document.querySelector('select');
    return [...s.options].some(o => /ENSAIO alvo/.test(o.textContent || ''));`);
  conferir(temNaLista, "o template de ensaio está na lista de escolha");

  // ---- 1. o PADRÃO não oferece o botão -----------------------------------
  await a.js(`
    const s = document.querySelector('select');
    const o = [...s.options].find(x => /★/.test(x.textContent || ''));
    if (!o) return false;
    s.value = o.value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;`);
  await espera(500);
  const noPadrao = await a.js(`
    const txt = document.body.textContent || '';
    return {
      temBotao: [...document.querySelectorAll('button')].some(b => /Tirar “/.test(b.textContent || '')),
      explica: /é o template padrão/.test(txt),
    };`);
  conferir(!noPadrao.temBotao, "no template PADRÃO o botão nem aparece — não é um botão que falha depois do clique");
  conferir(noPadrao.explica, "…e a tela diz por quê, em vez de só esconder", JSON.stringify(noPadrao));

  // ---- 2. no template comum, o botão aparece e PERGUNTA -------------------
  await a.js(`
    const s = document.querySelector('select');
    const o = [...s.options].find(x => /ENSAIO alvo/.test(x.textContent || ''));
    s.value = o.value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;`);
  await espera(500);
  const temBotao = await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Tirar “/.test(x.textContent || ''));
    return b ? b.textContent.trim() : null;`);
  conferir(!!temBotao && /ENSAIO alvo/.test(temBotao), "o botão nomeia o template que vai sair", String(temBotao));

  await a.js(`
    [...document.querySelectorAll('button')].find(x => /Tirar “/.test(x.textContent || '')).click();
    return true;`);
  await espera(400);
  const pergunta = await a.js(`
    const t = document.body.textContent || '';
    return {
      avisaEquipe: /toda a equipe/.test(t),
      avisaQueNaoApaga: /não apaga nada no whatsapp/i.test(t.replace(/\\s+/g, ' ')),
      diaOndeVolta: /Administração .{0,3} Templates/.test(t),
      temConfirmar: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Tirar da lista'),
      temCancelar: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Cancelar'),
    };`);
  conferir(pergunta.temConfirmar && pergunta.temCancelar, "um clique não basta: pergunta, com saída", JSON.stringify(pergunta));
  conferir(pergunta.avisaEquipe, "…e avisa que vale para TODA a equipe — não é uma preferência pessoal");
  conferir(pergunta.avisaQueNaoApaga, "…que não apaga nada no WhatsApp");
  conferir(pergunta.diaOndeVolta, "…e onde se traz de volta");
  await a.foto("esconder-template-pergunta");

  // ---- 3. confirmar: some da lista NA HORA --------------------------------
  const antes = await a.js(`return document.querySelector('select').options.length;`);
  await a.js(`
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Tirar da lista').click();
    return true;`);
  await a.ate(`/saiu da lista/.test(document.body.textContent || '')`, { ms: 15_000 });
  const depois = await a.js(`
    const s = document.querySelector('select');
    return {
      n: s.options.length,
      aindaTem: [...s.options].some(o => /ENSAIO alvo/.test(o.textContent || '')),
      recado: (document.body.textContent.match(/".{0,60}" saiu da lista[^]{0,60}/) || [''])[0],
    };`);
  conferir(!depois.aindaTem, "o template sai da lista na hora, sem recarregar a tela");
  conferir(depois.n === antes - 1, "…e sai UM, não a lista toda", `${antes} → ${depois.n}`);
  conferir(/trazer de volta/.test(depois.recado), "…com um recado que diz que dá para voltar atrás", depois.recado);
  await a.foto("esconder-template-depois");

  // ---- 4. o banco guarda quem e quando ------------------------------------
  const { data: linha } = await sb.from("crm_templates")
    .select("ativo,oculto_por,oculto_em").eq("id", idAlvo).single();
  conferir(linha?.ativo === false, "no banco, o template saiu da lista de escolha");
  conferir(linha?.oculto_por === EU, "…e ficou registrado QUEM tirou", String(linha?.oculto_por));
  conferir(!!linha?.oculto_em, "…e QUANDO", String(linha?.oculto_em));

  // ---- 5. o recorte de quem não é admin -----------------------------------
  // devolve o template à lista para exercitar a recusa com ele ativo
  await sb.from("crm_templates").update({ ativo: true, oculto_em: null, oculto_por: null }).eq("id", idAlvo);

  const comoVendedor = async (corpo) => {
    const b = await novaAba(chrome);
    await b.cookies({ crm_sessao: "romulo", crm_email: "romuloalbuquerque@muranoprofessional.com.br" }, BASE);
    await b.ir(`${BASE}/chat-v2`, { esperar: 1500 });
    return b.js(
      "return fetch('/api/templates', { method: 'PATCH'," +
      " headers: { 'content-type': 'application/json' }," +
      ` body: ${JSON.stringify(JSON.stringify(corpo))} })` +
      ".then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));",
    );
  };

  const edicaoProibida = await comoVendedor({ id: idAlvo, nome: "renomeado por quem não devia" });
  conferir(edicaoProibida.status === 403, "quem não é admin não EDITA template", `http ${edicaoProibida.status}`);
  const { data: naoMudou } = await sb.from("crm_templates").select("nome").eq("id", idAlvo).single();
  conferir(/^ENSAIO alvo/.test(String(naoMudou?.nome)), "…e o nome continua o mesmo — a recusa não foi só de fachada");

  const esconderPeloVendedor = await comoVendedor({ id: idAlvo, ativo: false });
  conferir(esconderPeloVendedor.status === 200, "…mas ESCONDE, que é o que o dono pediu", `http ${esconderPeloVendedor.status}`);
  const { data: porEla } = await sb.from("crm_templates").select("oculto_por").eq("id", idAlvo).single();
  conferir(
    String(porEla?.oculto_por).startsWith("romuloalbuquerque"),
    "…assinando com o e-mail de quem escondeu, não com o papel",
    String(porEla?.oculto_por),
  );

  if (idPadrao) {
    const noPadraoApi = await comoVendedor({ id: idPadrao, ativo: false });
    conferir(noPadraoApi.status === 409, "o servidor também barra esconder o PADRÃO — a tela pode estar velha, ele não",
      `http ${noPadraoApi.status}`);
    conferir(/padr/i.test(String(noPadraoApi.j?.error ?? "")), "…dizendo o que fazer antes", String(noPadraoApi.j?.error ?? "").slice(0, 90));
  }

  // ---- 6. o admin devolve, e a marca é limpa ------------------------------
  const c = await novaAba(chrome);
  await c.cookies({ crm_sessao: "admin", crm_email: EU }, BASE);
  await c.ir(`${BASE}/admin`, { esperar: 1500 });
  const devolveu = await c.js(
    "return fetch('/api/admin/templates-whatsapp', { method: 'PATCH'," +
    " headers: { 'content-type': 'application/json' }," +
    ` body: JSON.stringify({ id: ${idAlvo}, ativo: true }) })` +
    ".then(async r => ({ status: r.status, j: await r.json().catch(() => ({})) }));",
  );
  const { data: volta } = await sb.from("crm_templates")
    .select("ativo,oculto_em,oculto_por").eq("id", idAlvo).single();
  conferir(devolveu.status === 200 && volta?.ativo === true, "o admin devolve o template à lista", `http ${devolveu.status}`);
  conferir(
    volta?.oculto_em === null && volta?.oculto_por === null,
    "…e a marca é LIMPA junto — um template de volta não está escondido por ninguém",
    JSON.stringify(volta),
  );

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  if (idAlvo) await sb.from("crm_templates").delete().eq("id", idAlvo);
  await sb.from("crm_templates").delete().like("nome", `ENSAIO%${MARCA}`);
  await sb.from("mensagens").delete().like("id", `${MARCA}%`);
  await sb.from("chat_conversa").delete().eq("cliente_id", ID);
  await sb.from("clientes").delete().eq("id", ID);
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
