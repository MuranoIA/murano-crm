// -----------------------------------------------------------------------------
// AS DÍVIDAS DE BOLETO NO CHAT (demanda #64, 03/10/2026)
//
//   npx next start -p 3122      (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-boletos.mjs
//
// ⚠️ SÓ LÊ. O cliente de ensaio é ESCOLHIDO no banco, não inventado: cobrança
// é dinheiro de gente de verdade, e criar uma cobrança falsa para testar
// deixaria lixo num extrato financeiro.
//
// ⚠️ E NENHUM NOME DE CLIENTE entra neste arquivo (§15.5) — o repositório é
// público. A prova trabalha com `codcli` e descobre o resto sozinha.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3122";
const EU = "ia@muranoprofessional.com.br";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

const chrome = await subirChrome({ porta: 9683 });
try {
  // ---- 1. a régua: vencido é por DATA, não por status --------------------
  const { data: tudo } = await sb.from("vw_cliente_boleto").select("status_cobranca,vencido,valor_reais").limit(2000);
  const pendVencida = (tudo ?? []).filter((k) => k.status_cobranca === "pending" && k.vencido);
  conferir(
    pendVencida.length > 0,
    "existem cobranças `pending` que JÁ VENCERAM — é o caso que a régua por data pega",
    `${pendVencida.length} de ${(tudo ?? []).length}`,
  );
  const soStatus = (tudo ?? []).filter((k) => k.status_cobranca === "overdue").length;
  const porData = (tudo ?? []).filter((k) => k.vencido).length;
  conferir(
    porData > soStatus,
    "…e contar pelo status esconderia parte delas",
    `por data ${porData} · por status ${soStatus}`,
  );

  // ---- 2. um cliente de verdade, com contato no Pulse --------------------
  const { data: cands } = await sb.from("vw_cliente_boleto").select("codcli,vencido").eq("vencido", true).limit(1000);
  const porCod = new Map();
  for (const k of cands ?? []) porCod.set(Number(k.codcli), (porCod.get(Number(k.codcli)) ?? 0) + 1);
  const ordenados = [...porCod.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);

  let alvo = null;
  for (const cod of ordenados.slice(0, 40)) {
    const { data: v } = await sb.from("wth_vinculo").select("cliente_id").eq("codcli", cod).limit(1);
    const id = v?.[0]?.cliente_id;
    if (!id) continue;
    const { data: conv } = await sb.from("vw_chat_conversa").select("cliente_id").eq("cliente_id", id).maybeSingle();
    if (conv) { alvo = { codcli: cod, cliente_id: id }; break; }
  }
  conferir(!!alvo, "achei um cliente com dívida vencida E conversa no Pulse", alvo ? `codcli ${alvo.codcli}` : "nenhum");
  if (!alvo) throw new Error("sem cliente de ensaio — a base mudou?");

  // ---- 3. a rota do painel devolve as dívidas ---------------------------
  const pedir = (rota) =>
    fetch(`${BASE}${rota}`, {
      headers: { cookie: `crm_sessao=admin; crm_email=${EU}`, "cache-control": "no-cache" },
    }).then((r) => r.json());

  const d = await pedir(`/api/chat/contato?cliente_id=${encodeURIComponent(alvo.cliente_id)}`);
  conferir(Array.isArray(d.boletos) && d.boletos.length > 0, "o painel do contato recebe as cobranças", `${d.boletos?.length ?? 0}`);
  conferir(!!d.boletos_resumo && d.boletos_resumo.vencidas > 0, "…com o resumo somado NO SERVIDOR", JSON.stringify(d.boletos_resumo));
  conferir(
    d.boletos.every((k) => k.url_cobranca),
    "…e toda cobrança traz o link, que é o que transforma aviso em ação",
  );
  // o total da tela tem de bater com a soma das linhas que ela mostra
  const somaVencido = d.boletos.filter((k) => k.vencido).reduce((t, k) => t + Number(k.valor_reais), 0);
  conferir(
    Math.abs(somaVencido - d.boletos_resumo.total_vencido) < 0.005,
    "…e o total bate com as linhas, até o centavo",
    `${somaVencido.toFixed(2)} vs ${Number(d.boletos_resumo.total_vencido).toFixed(2)}`,
  );

  // ---- 4. quem NÃO deve não ganha bloco nenhum --------------------------
  const { data: limpos } = await sb.from("vw_chat_conversa").select("cliente_id,codcli").not("codcli", "is", null).limit(60);
  let semDivida = null;
  for (const k of limpos ?? []) {
    const { count } = await sb.from("vw_cliente_boleto").select("numero_cobranca", { count: "exact", head: true }).eq("codcli", k.codcli);
    if (!count) { semDivida = k; break; }
  }
  if (semDivida) {
    const d2 = await pedir(`/api/chat/contato?cliente_id=${encodeURIComponent(semDivida.cliente_id)}`);
    conferir(
      (d2.boletos ?? []).length === 0 && !d2.boletos_resumo,
      "cliente sem dívida vem com a lista VAZIA — um 'sem dívidas' fixo viraria ruído",
      `codcli ${semDivida.codcli}`,
    );
  }

  // ---- 5. o conjunto para o chip da lista -------------------------------
  const conj = await pedir("/api/chat-v2/boletos");
  conferir(Array.isArray(conj.ids) && conj.ids.length > 0, "a rota do chip devolve quem tem dívida", `${conj.ids?.length} clientes`);
  conferir(conj.ids.includes(alvo.cliente_id), "…e o cliente de ensaio está nela");
  // ⚠️ paginação: são mais de 1.000 cobranças e o PostgREST corta em silêncio
  const { count: totalCob } = await sb.from("vw_cliente_boleto").select("numero_cobranca", { count: "exact", head: true });
  conferir(totalCob > 1000, "a view passa de 1.000 linhas — é o teto que o PostgREST corta sem avisar", `${totalCob} cobranças`);

  // ---- 6. a tela ---------------------------------------------------------
  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: EU }, BASE);
  await a.ir(`${BASE}/chat-v2?cliente=${encodeURIComponent(alvo.cliente_id)}`, { esperar: 3000 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 25_000 });

  const temChip = await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Com dívida/.test(x.textContent||''));
    return !!b;`);
  conferir(temChip, "o chip 'Com dívida' está na lista");

  // abre o painel do cliente
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Cliente/i.test(x.getAttribute('title')||'') || /Cliente/i.test(x.getAttribute('aria-label')||''));
    if (b) b.click(); return !!b;`);
  const viu = await a.ate(`/Dívidas vencidas|A pagar/.test(document.body.textContent || '')`, { ms: 20_000 });
  conferir(viu, "o painel do cliente mostra o bloco de dívidas");
  if (viu) {
    // ⚠️ PROCURA O NÚMERO QUE O SERVIDOR MANDOU, e não um "R$" qualquer: a
    // tela tem dinheiro em quatro lugares, e um `includes("R$")` passaria
    // verde mesmo com o bloco de dívidas vazio.
    const esperado = Number(d.boletos_resumo.total_vencido)
      .toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const achou = await a.js(
      "return (document.body.textContent||'').replace(/\s+/g,' ').includes(" + JSON.stringify(esperado) + ");",
    );
    conferir(achou, "…com o total vencido impresso, igual ao do servidor", `R$ ${esperado}`);
  }
  await a.foto("boletos-painel");

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "OK " : "XX "} ${p.n}${p.d ? `  -- ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`
${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
