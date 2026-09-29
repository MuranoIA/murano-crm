// -----------------------------------------------------------------------------
// "ESTE NÚMERO É DE OUTRO CLIENTE" (demanda #50, 29/09/2026)
//
//   node prototipos/chat-v2/prova-corrigir-cadastro.mjs [cliente_id]
//
// O caso real, com print: o WinThor tem DOIS cadastros com o mesmo telefone e
// CPFs diferentes, e o contato do chat ficou colado no errado. O consultor
// procurou por um nome, abriu a conversa e o cabeçalho mostrava outro — depois
// de já ter saído um template dizendo "Oi, <nome do outro>!" para a cliente.
//
// ⚠️ ESTA PROVA MUDA DADO DE PRODUÇÃO, e de propósito: ela executa a correção
// que o dono pediu para o caso que ele mesmo conferiu com a cliente. Não é um
// ensaio — é o uso do botão. Por isso ela imprime o antes e o depois, e não
// desfaz nada no fim.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3120";
const ALVO = process.argv[2] || process.env.CLIENTE || "";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

if (!ALVO) { console.log("❌ informe o cliente_id"); process.exit(1); }

const estado = async () => {
  const [{ data: c }, { data: v }] = await Promise.all([
    sb.from("clientes").select("nome_completo,cpf,telefone").eq("id", ALVO).maybeSingle(),
    sb.from("wth_vinculo").select("codcli,origem").eq("cliente_id", ALVO).maybeSingle(),
  ]);
  return { nome: c?.nome_completo ?? null, cpf: c?.cpf ?? null, codcli: v?.codcli ?? null, origem: v?.origem ?? null };
};

const chrome = await subirChrome({ porta: 9551 });
try {
  const antes = await estado();
  console.log("ANTES:", JSON.stringify(antes));

  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: "ia@muranoprofessional.com.br" }, BASE);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(ALVO)}`, { esperar: 3000 });
  await a.ate(`document.querySelector('textarea')`, { ms: 25_000 });

  // abre o painel do cliente
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label')||'') === 'Dados do cliente');
    if (b) b.click();
    return true;`);
  const apareceu = await a.ate(`/Este número está em/.test(document.body.textContent || '')`, { ms: 25_000 });

  const bloco = await a.js(`
    const h = [...document.querySelectorAll('h3')].find(x => /Este número está em/.test(x.textContent||''));
    const sec = h ? h.closest('section') : null;
    if (!sec) return null;
    return {
      titulo: h.textContent.trim(),
      cartoes: [...sec.querySelectorAll(':scope > div')].map(d => ({
        texto: d.textContent.replace(/\u00a0/g,' ').trim().slice(0, 90),
        emUso: /em uso/.test(d.textContent||''),
        temBotao: !!d.querySelector('button'),
      })),
    };`);

  conferir(apareceu && !!bloco, "o painel avisa que o número está em mais de um cadastro", bloco?.titulo ?? "");
  conferir(bloco?.cartoes.length === 2, "…e lista os dois cadastros do ERP", `${bloco?.cartoes.length}`);
  conferir(
    bloco?.cartoes.filter((c) => c.emUso).length === 1,
    "um deles vem marcado como EM USO — sem isso a tela não diz o que está valendo",
    (bloco?.cartoes ?? []).map((c) => (c.emUso ? "[em uso] " : "") + c.texto.split("cód.")[0].trim()).join(" | "),
  );
  conferir(
    (bloco?.cartoes ?? []).every((c) => c.emUso !== c.temBotao),
    "o botão só aparece no OUTRO — não há como 'corrigir' para o cadastro que já está valendo",
  );
  await a.foto("corrigir-cadastro-antes");

  // ---- a correção -------------------------------------------------------
  // `confirm` trocado por uma função que ACEITA e guarda o texto: o aviso é
  // parte da entrega (ele diz que a conversa muda de carteira), então a prova
  // confere o que a pessoa leria antes de clicar.
  await a.js(`window.__aviso = null; window.confirm = (t) => { window.__aviso = t; return true; }; return true;`);
  await a.js(`
    const h = [...document.querySelectorAll('h3')].find(x => /Este número está em/.test(x.textContent||''));
    const sec = h.closest('section');
    const b = [...sec.querySelectorAll('button')].find(x => /dono do número/.test(x.textContent||''));
    b.click();
    return true;`);
  await espera(400);
  const texto = await a.js(`return window.__aviso;`);
  conferir(
    /deixa de ser de/i.test(String(texto ?? "")) && /carteira/i.test(String(texto ?? "")),
    "a confirmação diz o que muda de verdade: de quem a conversa deixa de ser, e a carteira",
    String(texto ?? "").replace(/\n/g, " ⏎ ").slice(0, 120),
  );

  await espera(4000);
  const depois = await estado();
  console.log("DEPOIS:", JSON.stringify(depois));

  conferir(depois.codcli !== antes.codcli, "o vínculo passou para o outro cadastro", `${antes.codcli} → ${depois.codcli}`);
  conferir(depois.origem === "manual",
    "…com origem MANUAL — é o que impede o sincronismo de 10 min desfazer a correção", String(depois.origem));
  conferir(depois.cpf !== antes.cpf, "o CPF do contato acompanha o cadastro novo");
  conferir(
    depois.nome !== antes.nome,
    "e o nome também — senão a thread continuaria chamando a cliente pelo nome errado",
    `${antes.nome} → ${depois.nome}`,
  );

  const { data: nota } = await sb.from("chat_nota")
    .select("texto,autor").eq("cliente_id", ALVO).order("criada_em", { ascending: false }).limit(1).maybeSingle();
  conferir(
    /Cadastro corrigido/.test(String(nota?.texto ?? "")),
    "a correção fica registrada como nota na conversa, com quem fez",
    `${nota?.autor ?? "?"}: ${String(nota?.texto ?? "").slice(0, 90)}`,
  );

  // e a tela reflete
  await espera(1500);
  await a.foto("corrigir-cadastro-depois");
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
