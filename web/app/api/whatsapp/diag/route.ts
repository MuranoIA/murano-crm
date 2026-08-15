import { cookies } from "next/headers";
import { podeAdmin } from "../../../../lib/papel";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Diagnóstico e configuração da conexão app <-> WABA. TEMPORÁRIA.
//
// Existe para responder, sem ninguém manusear token, duas perguntas que só a
// Meta sabe: (1) quais números o nosso app enxerga e qual o `phone_number_id`
// de cada um; (2) o app está inscrito para receber os webhooks daquela WABA?
// E para AGIR na segunda: inscrever o app na WABA.
//
// Usa o WHATSAPP_TOKEN que já está na Vercel — o mesmo do envio. Portanto só
// consegue enxergar/alterar WABAs atribuídas ao usuário do sistema dono do
// token; associar a WABA ao usuário do sistema é passo de ADMIN do portfólio,
// fora do alcance deste token (e desta rota).
//
// Protegida por sessão de admin do CRM. REMOVER quando a Fase C fechar.
// ---------------------------------------------------------------------------
const GRAPH = "v22.0";
const BUSINESS_ID = "1132196710850578"; // portfólio Murano Professional

// ---------------------------------------------------------------------------
// TRAVA DE ESCRITA — desenho por LISTA DE PERMISSÃO, não de bloqueio.
//
// Contexto (verificado em 13/08/2026): a WABA `Murano Pro` (1441580480587007)
// abriga o número +55 91 2018-2357, que é o número OFICIAL em produção — os
// vendedores atendem por ele AGORA, via RD/Tallos, e o faturamento da empresa
// depende de ele não parar. E o token do nosso usuário do sistema ENXERGA essa
// conta: sem trava, um id trocado num POST mexeria na assinatura de webhook da
// produção.
//
// Por que lista de PERMISSÃO e não de bloqueio: uma lista de bloqueio protege
// apenas as contas que alguém lembrou de listar. Qualquer WABA nova — inclusive
// uma futura conta de produção — nasceria desprotegida. Aqui é o contrário:
// tudo é negado, e só as contas de TESTE abaixo aceitam escrita.
//
// Leitura (GET) segue liberada para qualquer conta: é inofensiva e é o que torna
// esta rota útil como diagnóstico.
//
// Para liberar uma conta nova para escrita, acrescente o id aqui, de propósito,
// com o time avisado — nunca por parâmetro na chamada.
// ---------------------------------------------------------------------------
// Mesma lógica para NÚMEROS: registrar um número o vincula ao NOSSO app para
// envio (e desaloja o app que o detinha). O número oficial de produção
// (1004405886099218) jamais pode entrar nesta lista.
const NUMEROS_REGISTRO_PERMITIDO = new Set([
  "973434089176828",  // +55 91 9806-0032 — linha piloto (Murano Shop)
  "1221847701011584", // número de teste da Meta
]);

const WABAS_ESCRITA_PERMITIDA = new Set([
  "1384896129703324", // Murano Shop — linha secundária do piloto
  "28189344217325382", // Test WhatsApp Business Account — número de teste da Meta
]);

function token(): string | null {
  const t = process.env.WHATSAPP_TOKEN;
  return t ? t.replace(/[^\x21-\x7E]/g, "") : null;
}

async function graph(caminho: string, metodo: "GET" | "POST" = "GET", corpo?: unknown) {
  const t = token();
  if (!t) return { erro: "WHATSAPP_TOKEN ausente na Vercel" };
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${t}`,
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const body = await r.json().catch(() => ({}));
  // erro COMPLETO: subcode e error_user_msg costumam trazer o motivo acionável,
  // que a mensagem genérica esconde (ex.: "#200 sem permissão" pode ser, na
  // verdade, falta de método de pagamento ou de aceite de termos na conta).
  return r.ok ? body : {
    erro: body?.error?.message ?? `HTTP ${r.status}`,
    codigo: body?.error?.code ?? null,
    subcodigo: body?.error?.error_subcode ?? null,
    titulo_usuario: body?.error?.error_user_title ?? null,
    msg_usuario: body?.error?.error_user_msg ?? null,
    tipo: body?.error?.type ?? null,
    fbtrace: body?.error?.fbtrace_id ?? null,
  };
}

// GET /api/whatsapp/diag[?waba=<id>]
// Sem `waba`, usa WHATSAPP_WABA_ID. Devolve os números da conta (com o id que
// precisamos para a env) e as inscrições de webhook vigentes.
export async function GET(req: Request) {
  if (!podeAdmin(cookies().get("crm_sessao")?.value)) {
    return Response.json({ error: "só admin" }, { status: 403 });
  }
  const waba = new URL(req.url).searchParams.get("waba") || process.env.WHATSAPP_WABA_ID;
  if (!waba) return Response.json({ error: "informe ?waba=<id> ou configure WHATSAPP_WABA_ID" }, { status: 400 });

  const [numeros, inscritos, conta, permissoes] = await Promise.all([
    graph(`${waba}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,status,name_status,throughput`),
    graph(`${waba}/subscribed_apps`),
    graph(`${waba}?fields=id,name,currency,timezone_id,message_template_namespace`),
    // QUAIS TAREFAS o nosso usuário do sistema tem nesta conta. É o que distingue
    // "consigo ler mas não enviar" (acesso parcial) de "o número não está
    // registrado na Cloud API" — as duas causas clássicas do erro #200.
    graph(`${waba}/assigned_users?business=${BUSINESS_ID}&fields=name,tasks`),
  ]);

  // O QUE O TOKEN REALMENTE COBRE. `granular_scopes` lista, por permissão, os ids
  // de conta a que ela se aplica — resposta definitiva para o #200 no envio: se
  // whatsapp_business_messaging não incluir esta WABA, o token foi gerado sem ela
  // selecionada, e nenhuma atribuição de ativo conserta (só regerar escolhendo).
  // `impressao_do_token` ajuda a saber se a Vercel está mesmo com o token novo.
  const t = token();
  const dbg: any = t ? await graph(`debug_token?input_token=${encodeURIComponent(t)}`) : { erro: "sem token" };
  const impressao = t
    ? { tamanho: t.length, comeca: t.slice(0, 6), termina: t.slice(-6) }
    : null;

  return Response.json({
    waba_consultada: waba,
    linha_de_envio_atual: process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
    conta,
    numeros,
    apps_inscritos_no_webhook: inscritos,
    permissoes_do_usuario_do_sistema: permissoes,
    escopo_do_token: dbg?.data?.granular_scopes ?? dbg,
    token_expira_em: dbg?.data?.expires_at ?? null,
    impressao_do_token: impressao,   // só tamanho e pontas: não expõe o segredo
    dica: "para ENVIAR: `escopo_do_token` precisa trazer whatsapp_business_messaging com esta WABA em target_ids. Se não trouxer, regerar o token SELECIONANDO esta conta.",
  });
}

// POST /api/whatsapp/diag  { waba?: string }
// Inscreve o NOSSO app (o dono do token) para receber os webhooks da WABA.
// Aditivo e reversível: não move número, não remove parceiro, não mexe em
// outros apps já inscritos.
export async function POST(req: Request) {
  if (!podeAdmin(cookies().get("crm_sessao")?.value)) {
    return Response.json({ error: "só admin" }, { status: 403 });
  }
  let waba: string | undefined, acao: string | undefined, phone_number_id: string | undefined,
      pin: string | undefined, destino: string | undefined;
  try {
    ({ waba, acao, phone_number_id, pin, destino } = await req.json());
  } catch { /* body opcional */ }

  // ---- ação: testar envio por uma linha ESPECÍFICA -------------------------
  // Serve para comparar a linha piloto com a de teste usando o MESMO token: se a
  // de teste envia e a piloto não, o problema é da conta; se nenhuma envia, é do
  // token. Sem isso, o env único não deixa comparar.
  if (acao === "testar-envio") {
    if (!phone_number_id || !NUMEROS_REGISTRO_PERMITIDO.has(phone_number_id)) {
      return Response.json({ error: "BLOQUEADO: só números de teste/piloto", permitidos: [...NUMEROS_REGISTRO_PERMITIDO] }, { status: 423 });
    }
    const para = String(destino ?? "").replace(/\D/g, "");
    if (!para) return Response.json({ error: "informe `destino` (E.164 sem +)" }, { status: 400 });
    const envio = await graph(`${phone_number_id}/messages`, "POST", {
      messaging_product: "whatsapp",
      to: para,
      type: "text",
      text: { body: "Teste de linha — diagnóstico do CRM Murano." },
    });
    return Response.json({ acao: "testar-envio", linha: phone_number_id, destino: para, resultado: envio });
  }

  // ---- ação: registrar o número sob o NOSSO app ---------------------------
  // Necessário para ENVIAR: receber webhook basta estar inscrito, mas enviar é
  // privilégio do app que detém o registro do número. Registrar aqui DESALOJA o
  // app que o detinha (no piloto, o "Suri by Chatbot Maker").
  if (acao === "registrar") {
    if (!phone_number_id || !NUMEROS_REGISTRO_PERMITIDO.has(phone_number_id)) {
      return Response.json({
        error: "BLOQUEADO: registro permitido apenas nos números de teste/piloto. " +
               "O número oficial de produção nunca entra nesta lista.",
        permitidos: [...NUMEROS_REGISTRO_PERMITIDO],
      }, { status: 423 });
    }
    if (!/^\d{6}$/.test(String(pin ?? ""))) {
      return Response.json({ error: "pin deve ter exatamente 6 dígitos" }, { status: 400 });
    }
    const reg = await graph(`${phone_number_id}/register`, "POST", {
      messaging_product: "whatsapp",
      pin: String(pin),
    });
    const depois = await graph(`${phone_number_id}?fields=id,display_phone_number,status,quality_rating`);
    return Response.json({ acao: "registrar", phone_number_id, resultado: reg, numero_agora: depois });
  }
  const alvo = waba || process.env.WHATSAPP_WABA_ID;
  if (!alvo) return Response.json({ error: "informe {waba} ou configure WHATSAPP_WABA_ID" }, { status: 400 });
  if (!WABAS_ESCRITA_PERMITIDA.has(alvo)) {
    return Response.json({
      error: "BLOQUEADO: escrita permitida apenas nas WABAs de teste. Esta conta não está " +
             "na lista de permissão — se for a de produção (número oficial, atendimento ativo), " +
             "mexer na assinatura de webhook pode derrubar o atendimento dos vendedores. " +
             "Para liberar de propósito, acrescente o id em WABAS_ESCRITA_PERMITIDA " +
             "(app/api/whatsapp/diag/route.ts).",
      waba: alvo,
      permitidas: [...WABAS_ESCRITA_PERMITIDA],
    }, { status: 423 }); // 423 Locked
  }

  const resultado = await graph(`${alvo}/subscribed_apps`, "POST");
  const depois = await graph(`${alvo}/subscribed_apps`);
  return Response.json({ waba: alvo, resultado, apps_inscritos_agora: depois });
}
