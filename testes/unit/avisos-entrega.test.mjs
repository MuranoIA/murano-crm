// Parte B do card #19 do Entregas: POST /api/interno/avisos-entrega.
//
// Nada sai daqui: o banco é um objeto falso que só grava o que recebeu, e a
// Meta é o `fetch` global trocado por uma resposta montada. O envio passa pelo
// `sendTemplate` DE VERDADE (lib/whatsapp.ts) — é assim que a classificação de
// erro é provada contra o formato real de erro que ele produz, e não contra um
// erro inventado no teste.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  recusaDoSegredo, telefoneDoAviso, componentesDoAviso, classificarFalha, processarAvisos,
} from "../../web/lib/avisoEntrega.ts";
import { sendTemplate } from "../../web/lib/whatsapp.ts";

// ---------------------------------------------------------------- puras -----

test("recusaDoSegredo: env ausente 503, errado 401, certo null", () => {
  assert.equal(recusaDoSegredo("x", undefined), 503);
  assert.equal(recusaDoSegredo("x", "  "), 503);
  assert.equal(recusaDoSegredo(null, "segredo-longo"), 401);
  assert.equal(recusaDoSegredo("segredo-longo-", "segredo-longo"), 401);
  assert.equal(recusaDoSegredo("outro", "segredo-longo"), 401);
  assert.equal(recusaDoSegredo("segredo-longo", "segredo-longo"), null);
});

test("telefoneDoAviso: normaliza e acrescenta o 9 só em local 7/8 de 10 dígitos", () => {
  assert.equal(telefoneDoAviso("(91) 8123-4567"), "5591981234567");
  assert.equal(telefoneDoAviso("9171234567"), "5591971234567");
  assert.equal(telefoneDoAviso("559181234567"), "5591981234567");   // já com o 55
  assert.equal(telefoneDoAviso("91 98123-4567"), "5591981234567");  // já tem o 9
  assert.equal(telefoneDoAviso("9132234567"), "559132234567");      // fixo: fica
  assert.equal(telefoneDoAviso("9191234567"), "559191234567");      // local 9: regra do dono é 7/8
});

test("telefoneDoAviso: inválido vira null", () => {
  for (const cru of [null, "", "sem", "81234567", "123456789012345", "2012345678"]) {
    assert.equal(telefoneDoAviso(cru), null, String(cru));
  }
});

test("componentesDoAviso: exatamente o formato do contrato", () => {
  assert.deepEqual(componentesDoAviso({ primeiro_nome: "Maria", pedido: 36001817, link_token: "tok123" }), [
    { type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "36001817" }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "tok123" }] },
  ]);
  assert.equal(componentesDoAviso({ primeiro_nome: " ", pedido: 1, link_token: "t" })[0].parameters[0].text, "cliente");
});

test("classificarFalha: recusa da Meta falha; 5xx, rede e limite voltam para a fila", () => {
  const e = (msg, extra) => Object.assign(new Error(msg), extra);
  const recusa = classificarFalha(e("Graph 131026: Message undeliverable", { graphCode: 131026, httpStatus: 400 }));
  assert.equal(recusa.status, "falhou");
  assert.match(recusa.motivo, /não recebe no WhatsApp/);
  assert.match(recusa.motivo, /Message undeliverable/);          // o texto cru não some

  assert.equal(classificarFalha(e("Graph 1: x", { graphCode: 1, httpStatus: 500 })).status, "pendente");
  assert.equal(classificarFalha(e("Graph 131000: x", { graphCode: 131000, httpStatus: 503 })).status, "pendente");
  assert.equal(classificarFalha(e("Graph 130429: rate", { graphCode: 130429, httpStatus: 400 })).status, "pendente");
  assert.equal(classificarFalha(new TypeError("fetch failed")).status, "pendente");
  const desconhecido = classificarFalha(e("Graph 999999: estranho", { graphCode: 999999, httpStatus: 400 }));
  assert.equal(desconhecido.status, "falhou");
  assert.match(desconhecido.motivo, /estranho/);
});

// ---------------------------------------------- fluxo, Meta simulada ------

/** Banco falso: responde às RPCs e tabelas que o fluxo usa e anota tudo. */
function bancoFalso(itens) {
  const log = { registros: [], inserts: [], upserts: [] };
  const tabela = (nome) => {
    const q = {
      _nome: nome, select: () => q, eq: () => q, in: () => q,
      maybeSingle: async () => {
        if (nome === "wth_carteira") return { data: { codcli: 4453, nome: "MARIA DA SILVA", cpf: "00000000000", rca_num: 46 }, error: null };
        if (nome === "carteira_config") return { data: { slug: "luana" }, error: null };
        return { data: null, error: null };
      },
      then: (ok) => ok(nome === "crm_templates"
        ? { data: [{ meta_nome: "entrega_saiu", corpo: "Olá, {{1}}! Seu pedido {{2}} saiu." }], error: null }
        : { data: [], error: null }),
      insert: async (row) => { log.inserts.push({ tabela: nome, row }); return { error: null }; },
      upsert: async (row) => { log.upserts.push({ tabela: nome, row }); return { error: null }; },
    };
    return q;
  };
  const sb = {
    from: tabela,
    rpc: async (fn, args) => {
      if (fn === "ent_avisos_pegar") return { data: itens, error: null };
      if (fn === "ent_aviso_registrar") { log.registros.push(args); return { error: null }; }
      return { data: null, error: { message: `rpc inesperada ${fn}` } };
    },
  };
  return { sb, log };
}

const item = (over = {}) => ({
  id: "a1", tipo: "saiu", meta_nome: "entrega_saiu", idioma: "pt_BR", codcli: 4453, pedido: 36001817,
  primeiro_nome: "Maria", telefone_cru: "(91) 8123-4567", link_token: "tok123", ...over,
});

const deps = (sb) => ({
  sb,
  enviar: sendTemplate,
  acharContato: async (_sb, opts) => ({ cliente_id: `wa:${opts.telefone}`, carteira: opts.erp?.carteira ?? null, telefone: opts.telefone }),
  linhaDe: async () => "PHONE_ID_TESTE",
  agora: () => new Date("2026-09-25T12:00:00Z"),
});

let fetchOriginal;
let chamadasMeta;
function metaResponde(fn) {
  globalThis.fetch = async (url, init) => {
    chamadasMeta.push({ url: String(url), body: JSON.parse(init.body) });
    return fn();
  };
}
beforeEach(() => {
  fetchOriginal = globalThis.fetch;
  chamadasMeta = [];
  process.env.WHATSAPP_TOKEN = "token-de-teste";
  delete process.env.SIMULACAO_ENVIO;
});
afterEach(() => { globalThis.fetch = fetchOriginal; });

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("fluxo: envia com o payload do contrato, registra 'enviado' e espelha como bot", async () => {
  metaResponde(() => json(200, { messages: [{ id: "wamid.ABC" }] }));
  const { sb, log } = bancoFalso([item()]);
  const r = await processarAvisos(deps(sb));

  assert.deepEqual(r, { processados: 1, enviados: 1, pulados: 0, falhos: 0, adiados: 0 });
  assert.equal(chamadasMeta.length, 1);
  assert.match(chamadasMeta[0].url, /PHONE_ID_TESTE\/messages$/);
  const corpo = chamadasMeta[0].body;
  assert.equal(corpo.to, "5591981234567");                        // com o 9 acrescentado
  assert.equal(corpo.template.name, "entrega_saiu");
  assert.deepEqual(corpo.template.components, componentesDoAviso(item()));

  assert.deepEqual(log.registros, [{ p_id: "a1", p_status: "enviado", p_motivo: null, p_wamid: "wamid.ABC", p_telefone: "5591981234567" }]);
  const msg = log.upserts.find((u) => u.tabela === "mensagens").row;
  assert.equal(msg.enviada_por, "bot");
  assert.equal(msg.tipo, "template");
  assert.equal(msg.conteudo, "Olá, Maria! Seu pedido 36001817 saiu.");
  assert.equal(msg.vendedor_carteira, "luana");                  // dona da carteira no ERP
  const disp = log.inserts.find((i) => i.tabela === "disparos_template").row;
  assert.equal(disp.operator_id, null);
  assert.equal(disp.template_id, "entrega_saiu");
});

test("fluxo: telefone inválido é pulado sem chamar a Meta", async () => {
  metaResponde(() => { throw new Error("não devia chamar"); });
  const { sb, log } = bancoFalso([item({ telefone_cru: "1234" })]);
  const r = await processarAvisos(deps(sb));
  assert.deepEqual(r, { processados: 1, enviados: 0, pulados: 1, falhos: 0, adiados: 0 });
  assert.equal(chamadasMeta.length, 0);
  assert.deepEqual(log.registros[0], { p_id: "a1", p_status: "pulado", p_motivo: "telefone_invalido", p_wamid: null, p_telefone: "1234" });
});

test("fluxo: recusa da Meta vira 'falhou' com a explicação, sem espelho no chat", async () => {
  metaResponde(() => json(400, { error: { code: 131026, message: "Message undeliverable", error_data: { details: "" } } }));
  const { sb, log } = bancoFalso([item()]);
  const r = await processarAvisos(deps(sb));
  assert.equal(r.falhos, 1);
  assert.equal(log.registros[0].p_status, "falhou");
  assert.match(log.registros[0].p_motivo, /Message undeliverable/);
  assert.equal(log.upserts.length, 0);
});

test("fluxo: 5xx e erro de rede devolvem à fila ('pendente') e o laço continua", async () => {
  let n = 0;
  metaResponde(() => {
    n++;
    if (n === 1) return json(502, { error: { code: 1, message: "Bad gateway" } });
    if (n === 2) throw new TypeError("fetch failed");
    return json(200, { messages: [{ id: "wamid.OK" }] });
  });
  const { sb, log } = bancoFalso([item({ id: "a" }), item({ id: "b" }), item({ id: "c" })]);
  const r = await processarAvisos(deps(sb));
  assert.deepEqual(r, { processados: 3, enviados: 1, pulados: 0, falhos: 0, adiados: 2 });
  assert.deepEqual(log.registros.map((x) => [x.p_id, x.p_status]), [["a", "pendente"], ["b", "pendente"], ["c", "enviado"]]);
});

test("fluxo: falha ao REGISTRAR não derruba os itens seguintes", async () => {
  metaResponde(() => json(200, { messages: [{ id: "wamid.OK" }] }));
  const { sb, log } = bancoFalso([item({ id: "a" }), item({ id: "b" })]);
  const rpc = sb.rpc;
  sb.rpc = async (fn, args) => (fn === "ent_aviso_registrar" && args.p_id === "a")
    ? { error: { message: "banco fora" } } : rpc(fn, args);
  const r = await processarAvisos(deps(sb));
  assert.equal(r.processados, 2);
  assert.equal(r.enviados, 1);
  assert.equal(r.falhos, 1);
  assert.deepEqual(log.registros.map((x) => x.p_id), ["b"]);
});

// ------------------------------------------------ a porta da rota -------

test("rota: sem env 503, segredo errado 401, sem credencial 503 — sem pegar nada da fila", async () => {
  const { POST } = await import("../../web/app/api/interno/avisos-entrega/route.ts");
  const pedido = (segredo) => new Request("http://x/api/interno/avisos-entrega", {
    method: "POST", body: "{}", headers: segredo ? { "x-entregas-aviso-segredo": segredo } : {},
  });
  const antes = { ...process.env };
  try {
    delete process.env.ENTREGAS_AVISO_SEGREDO;
    assert.equal((await POST(pedido("qualquer"))).status, 503);

    process.env.ENTREGAS_AVISO_SEGREDO = "segredo-de-teste";
    assert.equal((await POST(pedido())).status, 401);
    assert.equal((await POST(pedido("errado"))).status, 401);

    // segredo certo, mas sem SUPABASE_*: recusa ANTES de chamar ent_avisos_pegar
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal((await POST(pedido("segredo-de-teste"))).status, 503);
  } finally {
    process.env = antes;
  }
});
