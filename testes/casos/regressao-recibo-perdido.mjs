// -----------------------------------------------------------------------------
// REGRESSÃO — mensagem entregue e lida ficava com UM TIQUE, como se não tivesse
// saído do aparelho.
//
// Relatado em 31/08/2026: "o cliente recebe, visualiza, mas mesmo assim só fica
// um palitinho... às vezes funciona normal e às vezes fica dessa maneira".
//
// NÃO era a tela, nem o iframe do hub: o banco tinha `status='wait'` de verdade.
// Medido no dia, na MESMA conversa e no mesmo minuto:
//
//   15:01:36  mensagem nossa  -> read     (o caminho de volta estava vivo)
//   15:01:55  mensagem DELA   -> chegou   (o webhook estava recebendo)
//   15:02:00  mensagem nossa  -> wait     <- presa
//   15:02:11  mensagem DELA   -> chegou
//   15:02:48  mensagem nossa  -> wait     <- presa
//
// A causa é uma CORRIDA. A rota de envio só grava a linha depois que o Graph
// responde; o recibo da Meta chega antes disso e o `UPDATE ... WHERE id=<wamid>`
// não encontra nada. O PostgREST não chama zero linhas de erro — devolve
// sucesso —, então o recibo era descartado em silêncio e, logo depois, o envio
// inseria a linha com "wait". O recibo que a consertaria já tinha ido embora.
//
// A assinatura de corrida está nos dados (30 dias, mensagens nossas na Cloud):
//
//                    n     mediana   MAIOR atraso de gravação
//   presas (wait)    13    0,126 s   1,580 s
//   com recibo      344    0,114 s   0,691 s
//
// Medianas iguais, caudas diferentes: não é lentidão sistemática, é o tempo em
// que a linha não existe. Quanto maior essa janela, maior a chance de o recibo
// chegar primeiro — que é exatamente o que uma corrida produz.
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";

export const ciclo = "Regressão — recibo perdido (mensagem lida com um tique só)";

const LIB = "../../web/lib/reciboStatus.ts";
const ROTA = "web/app/api/whatsapp/webhook/route.ts";

/**
 * Supabase de mentira, só com o que `aplicarRecibo` usa:
 * `.from().update().eq().in().select()` e `.from().select().eq().maybeSingle()`.
 *
 * `linhas` é um Map id -> { status, erro }. `aparecerApos` simula a rota de
 * envio terminando no meio do caminho: a linha nasce na N-ésima consulta.
 */
function fakeSb({ linhas = new Map(), aparecerApos = null, nasceCom = "wait" } = {}) {
  const reg = { updates: 0, leituras: 0 };
  const talvezNascer = () => {
    reg.leituras++;
    if (aparecerApos !== null && reg.leituras >= aparecerApos && !linhas.size) {
      linhas.set(fakeSb.id, { status: nasceCom, erro: null });
    }
  };
  return {
    reg, linhas,
    from() {
      let modo = null, patch = null, id = null, estados = null;
      const q = {
        update(p) { modo = "update"; patch = p; return q; },
        select() {
          if (modo !== "update") { modo = "select"; return q; }
          // UPDATE ... RETURNING: só devolve o que casou de verdade
          reg.updates++;
          const linha = linhas.get(id);
          const casou = linha && (estados === null || estados.includes(linha.status));
          if (casou) Object.assign(linha, patch);
          return Promise.resolve({ data: casou ? [{ id }] : [], error: null });
        },
        eq(_c, v) { id = v; return q; },
        in(_c, v) { estados = v; return q; },
        maybeSingle() {
          talvezNascer();
          const linha = linhas.get(id);
          return Promise.resolve({ data: linha ? { id } : null, error: null });
        },
      };
      return q;
    },
  };
}
fakeSb.id = "wamid.TESTE";

const agoraS = () => Math.floor(Date.now() / 1000);
const recibo = (status, extra = {}) => ({ id: fakeSb.id, status, timestamp: String(agoraS()), ...extra });

export default async function ({ passo, api, db }) {
  let lib;

  // ---------------------------------------------------------------- passo 1
  await passo("1. a lógica do recibo é importável e isolada", "✅", async () => {
    lib = await import(LIB).catch((e) => { throw new Error(`não importou: ${e.message}`); });
    api.ok(typeof lib.aplicarRecibo === "function", "`aplicarRecibo` não exportada");
    api.ok(typeof lib.ehFalhaAoGravar === "function", "`ehFalhaAoGravar` não exportada");
    return `JANELA_RECIBO_ORFAO_S=${lib.JANELA_RECIBO_ORFAO_S} · esperas=${lib.ESPERAS_RECIBO_MS.join("/")}ms`;
  });

  // ---------------------------------------------------------------- passo 2
  await passo("2. delivered → read avançam o tique", "✅", async () => {
    const linhas = new Map([[fakeSb.id, { status: "wait", erro: null }]]);
    const sb = fakeSb({ linhas });
    await lib.aplicarRecibo(sb, recibo("delivered"), { esperas: [] });
    api.ok(linhas.get(fakeSb.id).status === "success", "delivered não virou success");
    await lib.aplicarRecibo(sb, recibo("read"), { esperas: [] });
    api.ok(linhas.get(fakeSb.id).status === "read", "read não virou read");
    return "wait -> success -> read";
  });

  // ---------------------------------------------------------------- passo 3
  await passo("3. ⭐ O DEFEITO: recibo que chega ANTES da linha existir", "✅", async () => {
    // A linha aparece na 2ª consulta — a rota de envio terminando no meio.
    const linhas = new Map();
    const sb = fakeSb({ linhas, aparecerApos: 2 });
    await lib.aplicarRecibo(sb, recibo("read"), { esperas: [1, 1, 1] });
    api.ok(linhas.size === 1, "a linha nunca nasceu — teste mal montado");
    api.ok(linhas.get(fakeSb.id).status === "read",
      `o recibo foi perdido: a mensagem ficou em "${linhas.get(fakeSb.id).status}" ` +
      `depois de a cliente ter LIDO — este é exatamente o bug relatado`);
    return "a espera curta alcançou a linha; recibo aplicado";
  });

  // ---------------------------------------------------------------- passo 4
  await passo("4. corrida mais longa que a espera vira 503 (a Meta reenvia)", "✅", async () => {
    const sb = fakeSb({ linhas: new Map() });   // a linha nunca aparece
    let erro = null;
    try { await lib.aplicarRecibo(sb, recibo("read"), { esperas: [1, 1] }); }
    catch (e) { erro = e; }
    api.ok(erro, "recibo fresco sem linha deveria pedir reenvio, e não sumir calado");
    api.ok(lib.ehFalhaAoGravar(erro),
      "o erro não é reconhecido por `ehFalhaAoGravar` — o webhook responderia 200 e a " +
      "Meta nunca reenviaria");
    return "503 pedido; o reenvio encontra a linha já gravada";
  });

  // ---------------------------------------------------------------- passo 5
  await passo("5. recibo velho NÃO vira reenvio eterno", "⚠️", async () => {
    // Mensagem que não é nossa (outra ferramenta no mesmo número): insistir
    // faria a Meta reenviar o lote inteiro para sempre.
    const antigo = { id: fakeSb.id, status: "read", timestamp: String(agoraS() - lib.JANELA_RECIBO_ORFAO_S - 60) };
    const sb = fakeSb({ linhas: new Map() });
    await lib.aplicarRecibo(sb, antigo, { esperas: [] });   // não pode lançar
    return "aceito e registrado, sem pedir reenvio";
  });

  // --------------------------------------------------------------- passo 5b
  await passo("5b. `sent` sem linha ainda não pede reenvio (é o recibo mais comum)", "✅", async () => {
    // `sent` é o primeiro degrau e a linha nasce em "wait" de qualquer jeito.
    // Se ele entrasse no laço de espera, o recibo MAIS frequente da corrida
    // gastaria ~2 s e terminaria em 503 — reentregando as mensagens da cliente
    // e repetindo o push do vendedor, tudo para não mudar nada.
    const sb = fakeSb({ linhas: new Map() });
    const t0 = Date.now();
    await lib.aplicarRecibo(sb, recibo("sent"));   // esperas REAIS de propósito
    const ms = Date.now() - t0;
    api.ok(ms < 100, `demorou ${ms}ms — o \`sent\` entrou no laço de espera`);
    api.ok(sb.reg.updates === 0, "gastou ida ao banco para um recibo que não avança nada");
    return `saiu em ${ms}ms, sem tocar o banco`;
  });

  // ---------------------------------------------------------------- passo 6
  await passo("6. recibo fora de ordem não rebaixa o tique", "✅", async () => {
    // A Meta não garante ordem: `delivered` e `read` vêm em POSTs separados,
    // atendidos por invocações concorrentes. Sem guarda, um `sent` atrasado
    // devolvia a "wait" uma mensagem já lida — a bolha voltava a um tique só.
    const linhas = new Map([[fakeSb.id, { status: "read", erro: null }]]);
    const sb = fakeSb({ linhas });
    await lib.aplicarRecibo(sb, recibo("sent"), { esperas: [] });
    api.ok(linhas.get(fakeSb.id).status === "read", "um `sent` atrasado rebaixou uma mensagem lida");
    await lib.aplicarRecibo(sb, recibo("delivered"), { esperas: [] });
    api.ok(linhas.get(fakeSb.id).status === "read", "um `delivered` atrasado rebaixou uma mensagem lida");
    return "read resiste a sent e a delivered atrasados";
  });

  // ---------------------------------------------------------------- passo 7
  await passo("7. `failed` guarda o motivo da Meta e vale mesmo já lida", "✅", async () => {
    const linhas = new Map([[fakeSb.id, { status: "read", erro: null }]]);
    const sb = fakeSb({ linhas });
    await lib.aplicarRecibo(sb, recibo("failed", {
      errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "" } }],
    }), { esperas: [] });
    const linha = linhas.get(fakeSb.id);
    api.ok(linha.status === "failed", "falha não foi aplicada");
    api.ok(/131047/.test(linha.erro ?? ""),
      `o motivo da Meta não foi guardado (erro="${linha.erro}") — a tela mostraria "falhou" sem causa`);
    // `details` vazio não pode engolir o resto (§22.6.1: string vazia vence o `??`)
    api.ok(/Re-engagement/.test(linha.erro ?? ""), "`details` vazio comeu a explicação");
    return `erro gravado: ${linha.erro}`;
  });

  // ---------------------------------------------------------------- passo 8
  await passo("8. o webhook não volta a aplicar recibo por conta própria", "✅", async () => {
    // Guarda estrutural: o defeito nasceu de um `.update({ status })` solto,
    // que parecia certo e descartava zero linhas em silêncio. Se alguém
    // reintroduzir um ali, os sete passos acima continuariam verdes.
    const src = readFileSync(ROTA, "utf8");
    api.ok(/aplicarRecibo\(sb, st\)/.test(src), "o webhook deixou de chamar `aplicarRecibo`");
    const solto = src.match(/from\("mensagens"\)[\s\S]{0,120}?\.update\(\{[\s\S]{0,60}?status/g) ?? [];
    api.ok(solto.length === 0,
      `voltou a existir UPDATE de status dentro do route.ts (${solto.length}) — ` +
      "zero linhas casadas ali é sucesso para o PostgREST, e o recibo some de novo");
    return "o recibo passa só por lib/reciboStatus.ts";
  });

  // ---------------------------------------------------------------- passo 9
  await passo("9. quantas mensagens nossas seguem presas em `wait` (produção)", "⚠️", async () => {
    if (!db?.sb) throw new Error("PULAR:sem acesso ao banco");
    const { data, error } = await db.sb
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("enviada_por", "operator").eq("status", "wait").like("id", "wamid.%");
    if (error) throw new Error(`PULAR:${error.message}`);
    // Reportado, não exigido: as presas ANTIGAS não têm conserto — o recibo
    // que diria se foram lidas já foi descartado, e inventar um estado seria
    // pior que mostrar o que se sabe. O que a correção promete é que a
    // contagem pare de crescer.
    return `${data?.length ?? "?"} presa(s) acumuladas antes da correção (não são reparáveis)`;
  });
}
