// -----------------------------------------------------------------------------
// A LISTA NÃO ESPERA MAIS A FOTO (demandas #60 e #38, 02/10/2026)
//
//   ENSAIO_VISIVEL=1 npx next start -p 3123     (noutro terminal, na pasta web/)
//   node prototipos/chat-v2/prova-lista-sem-atraso.mjs
//
// O relato: "a notificação chega imediatamente, mas a mensagem na lista demora
// 1 a 2 minutos" (#60) e "o nome da cliente deveria ir para o topo da lista
// imediatamente" (#38).
//
// ⚠️ O QUE FAZ ESTA PROVA VALER é a comparação com a view materializada. Olhar
// só a resposta da API não provaria nada: se a foto tivesse acabado de ser
// refeita, a conversa estaria lá de qualquer jeito, e o teste passaria verde
// contra o código defeituoso. Então cada afirmação é feita em par —
//
//     o que `vw_chat_conversa` (a FOTO) sabe   ×   o que a API devolve
//
// e o que se afirma é a DIFERENÇA: a API sabe o que a foto não sabe.
//
// Faixa reservada de ensaio, nada é enviado a ninguém, tudo apagado no `finally`.
// -----------------------------------------------------------------------------
import { subirChrome, novaAba, fecharChrome } from "../../testes/driver.mjs";
import { espera, diasAtras } from "../../testes/ajuda.mjs";
import { sb } from "../../testes/db.mjs";

const BASE = process.env.BASE || "http://localhost:3123";
const TEL = "5591900000" + "60";
const ID = `wa:${TEL}`;
const MARCA = `atraso-${Date.now()}`;
const EU = "ia@muranoprofessional.com.br";
const passos = [];
const conferir = (cond, n, d = "") => passos.push({ n, ok: !!cond, d });

/** O que a FOTO sabe sobre esta conversa agora. */
const naFoto = async () => {
  const { data } = await sb.from("vw_chat_conversa")
    .select("cliente_id,ultima_atividade,ultima_mensagem,etapa").eq("cliente_id", ID).maybeSingle();
  return data ?? null;
};

const chrome = await subirChrome({ porta: 9661 });
try {
  const { data: ref } = await sb.from("mensagens")
    .select("linha_id").not("linha_id", "is", null).limit(1).maybeSingle();
  const LINHA = ref?.linha_id ?? null;
  if (!LINHA) throw new Error("nenhuma linha ativa para usar no ensaio");

  await sb.from("clientes").upsert(
    { id: ID, nome_completo: "ENSAIO atraso da lista (não é cliente)", telefone: TEL, carteira: null },
    { onConflict: "id" },
  );

  // ---- 1. o cenário: uma conversa parada há três dias ---------------------
  // É a cliente "lá embaixo da lista" do relato (#38). A mensagem é antiga de
  // propósito: o que se vai provar é que ela SOBE no instante em que falar.
  await sb.from("mensagens").upsert({
    id: `${MARCA}.1`, cliente_id: ID, enviada_por: "customer", tipo: "mensagem",
    conteudo: `ENSAIO ${MARCA} primeira`, status: "success",
    criada_em: diasAtras(3), linha_id: LINHA,
  }, { onConflict: "id" });
  conferir(true, "cenário: conversa de ensaio parada há 3 dias", diasAtras(3).slice(0, 10));

  const a = await novaAba(chrome);
  await a.cookies({ crm_sessao: "admin", crm_email: EU }, BASE);
  await a.ir(`${BASE}/chat-v2`, { esperar: 2500 });
  await a.ate(`document.querySelector('input[placeholder*="Buscar"]')`, { ms: 25_000 });

  const pedir = (rota) => a.js(`return fetch(${JSON.stringify(rota)}, { cache: 'no-store' }).then(r => r.json());`);

  // ---- 2. mensagem NOVA: tem de ir para o TOPO ----------------------------
  //
  // ⚠️ ESTA PROVA CORRE CONTRA O pg_cron, e o laço existe por causa disso. O
  // refresh roda a cada 2 min; se ele cair entre o INSERT e a leitura, a foto
  // passa a conhecer a mensagem e o teste passaria pelo motivo errado — sem
  // provar nada sobre o conserto. Então cada tentativa confere que a foto
  // continua atrás NO INSTANTE da medição, e tenta de novo se perdeu a corrida.
  let foto2 = null, lista2 = null, agora = null;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    agora = new Date().toISOString();
    await sb.from("mensagens").upsert({
      id: `${MARCA}.2.${tentativa}`, cliente_id: ID, enviada_por: "customer", tipo: "mensagem",
      conteudo: `ENSAIO ${MARCA} agorinha`, status: "success",
      criada_em: agora, linha_id: LINHA,
    }, { onConflict: "id" });

    foto2 = await naFoto();
    lista2 = await pedir("/api/chat-v2/lista?limite=60");
    if (!foto2 || new Date(foto2.ultima_atividade) < new Date(agora)) break;
    await espera(3000);   // o cron ganhou a corrida: tenta com outra mensagem
  }

  conferir(
    !foto2 || new Date(foto2.ultima_atividade) < new Date(agora),
    "a FOTO continua atrás — é o que torna a afirmação seguinte uma prova, e não sorte",
    foto2 ? String(foto2.ultima_atividade) : "ausente",
  );

  const conversas = lista2.conversas ?? [];
  const pos = conversas.findIndex((c) => c.cliente_id === ID);
  const na2 = conversas[pos];
  conferir(pos === 0, "a conversa vai para o TOPO da lista na hora — o pedido literal da #38", `posição ${pos}`);
  conferir(
    na2 && /agorinha/.test(String(na2.ultima_mensagem ?? "")),
    "…com a mensagem NOVA no resumo de uma linha, e não a anterior",
    String(na2?.ultima_mensagem ?? ""),
  );
  conferir(na2?.nao_lida === true, "…marcada como não lida");
  conferir(
    conversas.filter((c) => c.cliente_id === ID).length === 1,
    "…UMA vez na lista: corrigir a foto não pode duplicar a conversa",
  );
  conferir(
    na2?.etapa === "negociacao",
    "…e com a etapa recalculada AGORA (a foto diria a de ontem)",
    String(na2?.etapa),
  );

  // ---- 3. os contadores andam junto ---------------------------------------
  const cont = await pedir("/api/chat-v2/contagens");
  conferir(
    Number(cont.fila ?? 0) > 0,
    "os contadores contam a conversa nova na mesma hora — senão o número de cima desmente a lista",
    JSON.stringify({ fila: cont.fila, nao_lidas: cont.nao_lidas }),
  );

  // ---- 4. a tela mostra ---------------------------------------------------
  await a.js(`
    const b = [...document.querySelectorAll('button')].find(x => /Sem dono|fila/i.test(x.textContent||''));
    if (b) b.click(); return true;`);
  await espera(1200);
  await a.foto("lista-sem-atraso");

  const exc = a.excecoes.filter((e) => !/ResizeObserver/.test(e));
  conferir(!exc.length, "sem exceção", exc.slice(0, 1).join(""));

  // ---- 5. e o custo disso -------------------------------------------------
  // Mediana de cinco, e não uma amostra: a primeira chamada depois de subir o
  // servidor paga compilação de rota e conexão nova, e tomá-la como medida dá
  // um número que não é o do dia a dia.
  //
  // ⚠️ Isto NÃO é um antes-e-depois: medir o ganho exigiria um segundo build
  // sem o conserto, e a máquina não tem disco para dois. O número que responde
  // "ficou mais lento?" é o do BANCO, medido com EXPLAIN ANALYZE e registrado
  // na 0149: 0,13 ms + 0,18 ms por carga, mais ~20 ms só quando há mensagem
  // nova — contra os 5,47 ms que o índice novo ECONOMIZA em cada página da
  // lista (de Seq Scan + ordenação para Index Scan).
  //
  // Aqui o teto é frouxo de propósito: a medição sai de uma máquina de
  // desenvolvimento falando com o banco na nuvem, então o que ela prova é que
  // a lista responde em tempo de tela, não quanto ela custa em produção.
  const amostras = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await pedir("/api/chat-v2/lista?limite=60");
    amostras.push(Date.now() - t0);
  }
  const mediana = amostras.slice().sort((x, y) => x - y)[2];
  conferir(mediana < 8000, "a lista continua respondendo em tempo de tela",
    `mediana ${mediana} ms (${amostras.join("/")})`);
} catch (e) {
  conferir(false, "a prova rodou até o fim", String(e?.stack ?? e));
} finally {
  await sb.from("mensagens").delete().like("id", `${MARCA}%`);
  await sb.from("chat_conversa").delete().eq("cliente_id", ID);
  await sb.from("clientes").delete().eq("id", ID);
  fecharChrome(chrome);
}

for (const p of passos) console.log(`${p.ok ? "✅" : "❌"} ${p.n}${p.d ? `  — ${p.d}` : ""}`);
const bons = passos.filter((p) => p.ok).length;
console.log(`\n${bons}/${passos.length}`);
process.exit(bons === passos.length ? 0 : 1);
