// Webhook da WhatsApp Cloud API (Meta) — canal direto, sem RD Conversas.
//
// GET  = verificação de assinatura do webhook (hub.challenge), feita uma vez ao
//        cadastrar a URL no painel da Meta.
// POST = eventos em tempo real: mensagens recebidas de clientes e atualizações
//        de status (sent/delivered/read/failed) das mensagens que enviamos.
//
// Grava nas MESMAS tabelas do ETL do RD (`clientes`, `mensagens`), então o board,
// a vw_funil e o Realtime (migration 0069, trigger de statement em `mensagens`)
// funcionam sem nenhuma mudança. O id da mensagem é o `wamid` da Meta — id real,
// estável e único, então o upsert é idempotente por natureza (a Meta pode
// reentregar o mesmo evento; reentrega vira no-op).
//
// Vínculo com o cliente: pelo telefone (últimos 8 dígitos — mesmo padrão tel8 do
// resto do projeto, porque o telefone vindo do RD às vezes não tem o nono dígito).
// Se não existe, cria um cliente novo com id sintético `wa:<wa_id>` — mesmo
// padrão dos ids sintéticos `winthor:<codcli>` da prospecção.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { baixarMidia, extensaoDoMime } from "../../../../lib/whatsapp";
import { avisar, destinatarios } from "../../../../lib/chatPush";
import { avisarForaDeHorario } from "../../../../lib/foraDeHorario";

import { acharCpfNoTexto } from "../../../../lib/cpf";
import { ligarPorCpf, recadoDoVinculo } from "../../../../lib/vinculoCpf";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// GET — verificação do webhook (painel da Meta manda ?hub.mode=subscribe&...)
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// ---------------------------------------------------------------------------
// POST — eventos
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  // A Meta reenvia o evento se não receber 200 rápido — e reenvia PARA SEMPRE um
  // payload que a gente não consegue processar. Por isso: qualquer erro interno é
  // logado e a resposta é 200 mesmo assim (o upsert idempotente torna isso seguro).
  const raw = await req.text();
  try {
    if (!verificarAssinatura(req, raw)) {
      // assinatura inválida É 403 (não 200): payload não veio da Meta.
      return new Response("bad signature", { status: 403 });
    }
    const body = JSON.parse(raw);
    await processar(body);
  } catch (e: any) {
    console.error("[wa-webhook] erro:", e?.message ?? e);
  }
  return new Response("ok", { status: 200 });
}

// Assinatura X-Hub-Signature-256 = HMAC-SHA256(raw body, app secret).
// Se WHATSAPP_APP_SECRET não estiver configurado, aceita sem validar (dev).
function verificarAssinatura(req: Request, raw: string): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  const header = req.headers.get("x-hub-signature-256") ?? "";
  const esperado = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function processar(body: any): Promise<void> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      // campo `calls` = chamadas de voz (Calling API, migration 0087). Assinatura
      // separada de `messages` no painel da Meta — assinar um não assina o outro.
      if (change?.field === "calls") {
        await processarChamadas(sb, change.value ?? {});
        continue;
      }
      if (change?.field !== "messages") continue;
      const value = change.value ?? {};
      // POR QUAL LINHA esta mensagem entrou. Com mais de um número ativo, é o que
      // permite responder pelo número certo — a janela de 24h é por par
      // (número, cliente), então responder pela linha errada quebra a conversa.
      const linhaId: string | null = value?.metadata?.phone_number_id
        ? String(value.metadata.phone_number_id)
        : null;
      // nome de perfil por wa_id (vem junto com as mensagens)
      const nomes = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c?.wa_id && c?.profile?.name) nomes.set(c.wa_id, c.profile.name);
      }
      for (const msg of value.messages ?? []) {
        await gravarMensagemRecebida(sb, msg, nomes.get(msg.from), linhaId);
      }
      for (const st of value.statuses ?? []) {
        await atualizarStatus(sb, st);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mensagem recebida do cliente
// ---------------------------------------------------------------------------
async function gravarMensagemRecebida(
  sb: any, msg: any, nomePerfil?: string, linhaId?: string | null,
): Promise<void> {
  const waId: string = String(msg.from ?? "");
  const wamid: string = String(msg.id ?? "");
  if (!waId || !wamid) return;

  // REAÇÃO não é mensagem: é atributo da mensagem reagida (como no WhatsApp).
  // Gravá-la como linha nova a tornaria "a última mensagem" da conversa — mexendo
  // na etapa do funil — e abriria uma "espera" no indicador de tempo de resposta
  // que ninguém precisa responder. `emoji` vazio = reação removida.
  if (msg.type === "reaction") {
    const alvo = String(msg.reaction?.message_id ?? "");
    if (!alvo) return;
    const emoji = String(msg.reaction?.emoji ?? "").trim() || null;
    const { error } = await sb.from("mensagens").update({ reacao: emoji }).eq("id", alvo);
    if (error) console.error("[wa-webhook] reação não gravada:", error.message);
    return;
  }

  const cliente = await acharOuCriarCliente(sb, waId, nomePerfil);
  const row: Record<string, unknown> = {
    id: wamid,
    cliente_id: cliente.id,
    vendedor_carteira: cliente.carteira ?? null,
    enviada_por: "customer",
    tipo: "mensagem",
    conteudo: extrairConteudo(msg),
    is_reply: Boolean(msg.context?.id) || null,
    resposta_a: msg.context?.id ? String(msg.context.id) : null,   // qual mensagem foi citada
    status: "success",
    criada_em: new Date(Number(msg.timestamp) * 1000).toISOString(),
    linha_id: linhaId ?? null,
    ...(await processarMidia(sb, msg, wamid, cliente.id)),
    ...extrairLocalizacao(msg),
  };
  let { error } = await sb.from("mensagens").upsert(row, { onConflict: "id" });

  // ⚠️ A coluna `localizacao` nasce na 0115. Se o deploy chegar antes da
  // migration, o upsert INTEIRO falha — e como este webhook engole erro para
  // sempre responder 200 (§16.1), a mensagem da cliente é **perdida em
  // silêncio**. Não degradada: perdida. A Meta reenvia, falha igual e desiste.
  //
  // Medido ao vivo em 27/08 antes de existir esta rede: três localizações
  // enviadas, três respostas 200, zero linhas gravadas.
  //
  // Por isso a segunda tentativa sem o campo: perder o ponto no mapa é ruim,
  // perder a mensagem é inaceitável. Mesmo padrão de `encaminhada_de` (0111).
  if (error && /localizacao/i.test(error.message)) {
    const { localizacao, ...semLocal } = row as any;
    console.warn("[wa-webhook] coluna localizacao ausente (aplicar 0115) — gravando sem o ponto");
    ({ error } = await sb.from("mensagens").upsert(semLocal, { onConflict: "id" }));
  }
  if (error) throw new Error(`upsert mensagens: ${error.message}`);

  // conversa volta pra fila: cliente falou => reabre (status aberta/resolvida, §18 item 4)
  await sb.from("chat_conversa").upsert(
    { cliente_id: cliente.id, status: "aberta", atualizado_em: new Date().toISOString() },
    { onConflict: "cliente_id" },
  );

  // aviso de fora do horário (nasce desligado; não repete na mesma rajada).
  // Depois do upsert de propósito: se falhar, a mensagem da cliente já está salva.
  await avisarForaDeHorario(sb, cliente.id, waId);

  // A cliente mandou o CPF? Entao o contato pode se ligar ao ERP sozinho (0117).
  // Depois do upsert, pela mesma razao: nada aqui pode custar a mensagem dela.
  await tentarVincularPeloCpf(sb, cliente.id, extrairConteudo(msg));

  // ---- push com o app fechado (0096) --------------------------------------
  // Último passo do fluxo, de propósito: a mensagem já está salva e a conversa
  // já reabriu. `avisar` NUNCA lança (ver lib/chatPush.ts) — o webhook precisa
  // responder 200 a qualquer custo, porque a Meta reenvia eternamente o que
  // não recebe 200 (§16.1), e um push falho não pode virar reentrega infinita.
  //
  // Vai só para quem atende esta carteira. Admin e home ficam de fora: eles
  // veem todas as carteiras e receberiam um push por mensagem da empresa
  // inteira — notificação que toca o tempo todo é desligada no primeiro dia.
  try {
    const paraQuem = await destinatarios(sb, cliente.carteira ?? null);
    if (paraQuem.length) {
      const texto = String(row.conteudo ?? "").trim();
      await avisar(sb, paraQuem, {
        // o nome do perfil é o que a cliente escolheu no WhatsApp; sem ele, o
        // telefone — nunca "cliente desconhecido", que não ajuda a decidir se
        // vale abrir agora
        titulo: nomePerfil || waId,
        // recorta: a notificação do sistema trunca sozinha, mas num aparelho
        // de tela bloqueada é melhor nós decidirmos onde corta
        corpo: texto.length > 120 ? `${texto.slice(0, 117)}…` : (texto || "enviou uma mensagem"),
        cliente_id: cliente.id,
        url: "/chat",
      });
    }
  } catch { /* nunca derruba o webhook */ }
}

const TIPOS_MIDIA = ["image", "audio", "video", "document", "sticker"] as const;

/**
 * Baixa a mídia da mensagem e guarda no bucket privado `wa-midia`, devolvendo as
 * colunas de mídia para o upsert.
 *
 * Falha aqui NUNCA derruba a mensagem: se o download ou o upload falharem, a
 * mensagem é gravada mesmo assim, com `midia_tipo` e `midia_id` preenchidos —
 * o que permite tentar de novo depois (o media_id da Meta vale ~30 dias).
 */
async function processarMidia(
  sb: any, msg: any, wamid: string, clienteId: string,
): Promise<Record<string, unknown>> {
  const tipo = String(msg?.type ?? "");
  if (!TIPOS_MIDIA.includes(tipo as any)) return {};
  const midia = msg[tipo] ?? {};
  const mediaId = String(midia.id ?? "");
  if (!mediaId) return {};

  const base: Record<string, unknown> = {
    midia_tipo: tipo,
    midia_id: mediaId,
    midia_nome: midia.filename ?? null,
  };

  try {
    const { bytes, mime } = await baixarMidia(mediaId);
    // chave do Storage: ano-mês / cliente / wamid.ext — sanitizada (o wamid é
    // base64 e pode trazer '/' e '+', que quebrariam o caminho)
    const limpo = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
    const mes = new Date().toISOString().slice(0, 7);
    const path = `${mes}/${limpo(clienteId)}/${limpo(wamid)}.${extensaoDoMime(mime)}`;

    const { error } = await sb.storage.from("wa-midia").upload(path, bytes, {
      contentType: mime,
      upsert: true,
    });
    if (error) throw new Error(error.message);

    return { ...base, midia_path: path, midia_mime: mime };
  } catch (e: any) {
    console.error(`[wa-webhook] mídia ${tipo} (${mediaId}) não baixada:`, e?.message ?? e);
    return base; // mensagem entra sem o arquivo; dá para reprocessar pelo midia_id
  }
}

// Texto puro quando existir. Para mídia, o `conteudo` é a legenda (ou um rótulo
// legível) — o arquivo em si vai para o Storage via processarMidia(). O rótulo
// importa porque o CARD do board mostra `ultima_mensagem`: "📷 Foto" comunica,
// "" não comunicaria nada.
function extrairConteudo(msg: any): string {
  switch (msg.type) {
    case "text":
      return String(msg.text?.body ?? "");
    case "button":
      return String(msg.button?.text ?? "[botão]");
    case "interactive": {
      // Resposta ao pedido de autorização de ligação (Calling API): a cliente
      // tocou em Permitir / Não permitir. É mensagem de verdade — aparece no
      // WhatsApp dela —, então entra na thread como as outras respostas de botão
      // que já tratamos aqui. A permissão em si quem guarda é a Meta; isto é só
      // o registro visível para o vendedor saber o que aconteceu.
      const perm = msg.interactive?.call_permission_reply?.response;
      if (perm) {
        return String(perm).toLowerCase() === "accept"
          ? "✅ Autorizou receber nossas ligações"
          : "🚫 Não autorizou receber ligações";
      }
      return String(
        msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "[interativo]",
      );
    }
    case "reaction":
      return `[reação] ${msg.reaction?.emoji ?? ""}`.trim();
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker": {
      const rotulos: Record<string, string> = {
        image: "📷 Foto", video: "🎬 Vídeo", audio: "🎤 Áudio",
        document: "📎 Documento", sticker: "🙂 Figurinha",
      };
      const m = msg[msg.type] ?? {};
      return String(m.caption || m.filename || rotulos[msg.type] || `[${msg.type}]`);
    }
    case "location": {
      // O rótulo antigo era literalmente "[localização]" — a cliente mandava
      // onde fica o salão dela e o CRM guardava a palavra. Agora o conteúdo é
      // o que dá para LER na lista de conversas, onde não há cartão nenhum:
      // o nome e o endereço, se ela os enviou; as coordenadas, se não.
      const l = msg.location ?? {};
      const partes = [l.name, l.address].filter(Boolean);
      if (partes.length) return `📍 ${partes.join(" — ")}`;
      // ⚠️ Validar o par TAMBÉM aqui, e não só em `extrairLocalizacao`. Um
      // payload torto rendia literalmente "📍 abc, null" na lista de conversas
      // (visto no teste): `!= null` aceita a string "abc". Sem coordenada
      // legível, o rótulo genérico é o honesto.
      const la = Number(l.latitude), lo = Number(l.longitude);
      return Number.isFinite(la) && Number.isFinite(lo) ? `📍 ${la}, ${lo}` : "📍 Localização";
    }
    case "contacts":
      return "[contato compartilhado]";
    default:
      return `[${msg.type ?? "desconhecido"}]`;
  }
}

/**
 * O ponto no mapa, quando a mensagem é de localização (0115).
 *
 * Isto vinha sendo DESCARTADO: o payload da Meta traz latitude, longitude,
 * name, address e url, e o webhook guardava só a palavra "[localização]".
 *
 * `name` e `address` são opcionais — a cliente que compartilha a posição do
 * aparelho manda só as coordenadas. Por isso nada aqui é obrigatório além do
 * par lat/lng, e a bolha sabe desenhar o cartão sem endereço.
 */
function extrairLocalizacao(msg: any): { localizacao?: Record<string, unknown> } {
  if (msg?.type !== "location") return {};
  const l = msg.location ?? {};
  const lat = Number(l.latitude), lng = Number(l.longitude);
  // Sem par válido não há cartão a desenhar. Gravar `{lat: NaN}` faria a bolha
  // renderizar um pino apontando para lugar nenhum — pior que não renderizar.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  return {
    localizacao: {
      lat, lng,
      nome: l.name ? String(l.name) : null,
      endereco: l.address ? String(l.address) : null,
      url: l.url ? String(l.url) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Vínculo mensagem ↔ cliente (match por tel8, criação se não existir)
// ---------------------------------------------------------------------------
/**
 * A cliente digitou o CPF na conversa — liga o contato ao cliente do ERP.
 *
 * Pedido do usuário (28/08/2026): *"se a cliente digitar o cpf e este for o
 * mesmo do winthor, então o processo acontece automaticamente?"*. Acontece —
 * com um freio: o automático só vale quando o **nome também bate**.
 *
 * Sem esse freio, qualquer CPF válido que chegasse pela conversa vincularia
 * este contato ao cadastro daquele CPF: a cliente manda o do marido, o da
 * sócia, ou erra um dígito de um jeito que ainda passe no verificador, e a
 * conversa herda o histórico de compra e o RCA de outra pessoa. Com o nome
 * batendo, são dois sinais independentes concordando — o sistema confirma uma
 * hipótese que já tinha, em vez de confiar no que um estranho digitou.
 *
 * Quando divergem, ninguém é vinculado: vira nota na conversa e o consultor
 * decide. Nota, e não mensagem — o que entra em `mensagens` move card de etapa
 * e abre espera no indicador (§21.2).
 */
async function tentarVincularPeloCpf(sb: any, clienteId: string, texto: string): Promise<void> {
  try {
    const cpf = acharCpfNoTexto(texto);
    if (!cpf) return;
    const r = await ligarPorCpf(sb, {
      cliente_id: clienteId, cpf, por: null,
      origem: "cpf_confirmado", exigirNomeIgual: true,
    });
    const recado = recadoDoVinculo(r);
    if (recado) {
      await sb.from("chat_nota").insert({
        cliente_id: clienteId, autor: "sistema", texto: recado,
      });
    }
  } catch (e) {
    // Nunca derruba o webhook: a mensagem da cliente vale mais que o vínculo.
    console.warn("[wa-webhook] vinculo por cpf falhou:", (e as Error)?.message);
  }
}

async function acharOuCriarCliente(
  sb: any,
  waId: string,
  nomePerfil?: string,
): Promise<{ id: string; carteira: string | null }> {
  const tel8 = waId.replace(/\D/g, "").slice(-8);

  // match pelos 8 últimos dígitos — cobre RD (12 dígitos, sem o nono) e Meta (13)
  //
  // ⚠️ `order by id` NÃO é enfeite. Sem ordem, o Postgres devolve as linhas na
  // ordem que quiser, e a versão anterior escolhia "a primeira que tiver
  // carteira" — ou seja, a mesma cliente podia cair em linhas DIFERENTES entre
  // uma mensagem e outra. Medido em 27/08/2026: 38 telefones com mais de um
  // cadastro, 80 linhas, TODOS ambíguos aqui, e 16 com a conversa já partida em
  // duas. É a mesma família do defeito de paginação do board (§61): consulta
  // sem desempate não é "quase determinística", é instável.
  const { data: candidatos } = await sb
    .from("clientes")
    .select("id,carteira,telefone")
    .like("telefone", `%${tel8}`)
    .order("id")
    .limit(20);

  if (candidatos?.length === 1) {
    return { id: candidatos[0].id, carteira: candidatos[0].carteira ?? null };
  }

  if (candidatos?.length) {
    // Com mais de um cadastro, o critério certo não é "tem carteira": é ONDE A
    // CONVERSA MORA. A cliente vê UM histórico no aparelho dela; o cadastro que
    // já carrega esse histórico é o que a consultora precisa ver crescer. Jogar
    // a mensagem no cadastro vazio parte a conversa em duas telas.
    //
    // Uma consulta só, e apenas no caso raro (38 de ~4.800 contatos): a linha
    // mais recente entre os candidatos diz qual cadastro está vivo.
    const ids = candidatos.map((c: any) => c.id);

    // O NUMERO NOVO GANHA DO RD, e nao e preferencia estetica.
    //
    // "A mensagem mais recente" sozinha tem um furo que so aparece com o tempo:
    // o ETL do RD continua alimentando o banco (§44), entao um cadastro antigo
    // pode receber mensagem NOVA do RD depois de a cliente ja ter migrado para o
    // nosso numero. A conversa da Cloud seria roubada de volta pelo cadastro do
    // RD, e partiria outra vez -- justamente o defeito que este bloco conserta.
    //
    // Medido em 27/08/2026: risco 0 hoje (nenhum duplicado tem irmao com Cloud
    // vencendo pela data). Mas ele cresce exatamente na direcao da migracao, e a
    // decisao do usuario e clara: o que ficou no RD ficou para tras.
    const maisRecente = async (soCloud: boolean) => {
      let q = sb.from("mensagens").select("cliente_id")
        .in("cliente_id", ids).neq("tipo", "evento_sistema");
      if (soCloud) q = q.like("id", "wamid%");
      const { data } = await q.order("criada_em", { ascending: false }).limit(1);
      return data?.[0]?.cliente_id ?? null;
    };

    // Consulta a mais SO no caso raro (38 de ~4.800 contatos) e so quando nenhum
    // dos candidatos tem conversa no numero novo.
    const alvo = (await maisRecente(true)) ?? (await maisRecente(false));
    const vivo = alvo ? candidatos.find((c: any) => c.id === alvo) : null;

    // Sem nenhuma mensagem em nenhum deles, cai no desempate estável: quem tem
    // carteira primeiro, e `candidatos` já vem ordenado por id — então duas
    // execuções seguidas escolhem o MESMO, que é o ponto.
    const escolhido = vivo ?? candidatos.find((c: any) => c.carteira) ?? candidatos[0];
    return { id: escolhido.id, carteira: escolhido.carteira ?? null };
  }

  // contato novo, sem histórico no RD — id sintético estável por wa_id
  const novo = {
    id: `wa:${waId}`,
    nome_completo: nomePerfil ?? waId,
    telefone: waId,
    carteira: null,
    canal: "whatsapp",
  };
  const { error } = await sb.from("clientes").upsert(novo, { onConflict: "id" });
  if (error) throw new Error(`upsert clientes: ${error.message}`);
  return { id: novo.id, carteira: null };
}

// ---------------------------------------------------------------------------
// CHAMADAS DE VOZ (campo `calls` — WhatsApp Business Calling API, migration 0087)
//
// Este bloco é a metade "de fora" do WebRTC. O navegador do vendedor produz o
// SDP local; o SDP da OUTRA ponta chega aqui, num processo que não tem acesso
// nenhum àquela aba. Por isso o SDP é GRAVADO em `chat_ligacao`, e o trigger da
// 0087 toca a campainha pelo Realtime levando só o `call_id` — o navegador então
// busca o resto por /api/chat/ligacao/acao, que autoriza no servidor.
//
// Três eventos importam:
//   · connect   — BUSINESS_INITIATED: a cliente aceitou, vem o `answer` da nossa
//                 oferta. USER_INITIATED: a cliente está LIGANDO, vem o `offer`.
//   · statuses  — RINGING / ACCEPTED / REJECTED (type: 'call')
//   · terminate — acabou; traz duração e se foi COMPLETED ou FAILED
// ---------------------------------------------------------------------------
async function processarChamadas(sb: any, value: any): Promise<void> {
  const linhaId: string | null = value?.metadata?.phone_number_id
    ? String(value.metadata.phone_number_id) : null;
  const nomes = new Map<string, string>();
  for (const c of value.contacts ?? []) {
    if (c?.wa_id && c?.profile?.name) nomes.set(c.wa_id, c.profile.name);
  }

  for (const call of value.calls ?? []) {
    try {
      await processarChamada(sb, call, linhaId, nomes.get(String(call?.from ?? "")));
    } catch (e: any) {
      console.error("[wa-webhook] chamada não processada:", e?.message ?? e);
    }
  }

  // RINGING / ACCEPTED / REJECTED da chamada que NÓS originamos
  for (const st of value.statuses ?? []) {
    if (st?.type !== "call") continue;
    const mapa: Record<string, string> = {
      RINGING: "tocando", ACCEPTED: "em_curso", REJECTED: "recusada",
    };
    const novo = mapa[String(st.status ?? "").toUpperCase()];
    if (!novo) continue;
    const patch: Record<string, unknown> = { status: novo };
    if (novo === "em_curso") patch.atendida_em = new Date().toISOString();
    if (novo === "recusada") patch.encerrada_em = new Date().toISOString();
    // só avança quem ainda está viva: um RINGING atrasado não pode ressuscitar
    // uma chamada já encerrada (a Meta reentrega eventos)
    const { error } = await sb.from("chat_ligacao").update(patch)
      .eq("call_id", String(st.id ?? "")).in("status", ["discando", "tocando", "em_curso"]);
    if (error) console.error("[wa-webhook] status de chamada:", error.message);
  }
}

async function processarChamada(
  sb: any, call: any, linhaId: string | null, nomePerfil?: string,
): Promise<void> {
  const callId = String(call?.id ?? "");
  const evento = String(call?.event ?? "");
  if (!callId) return;
  const entrante = String(call?.direction ?? "") === "USER_INITIATED";
  const waId = String((entrante ? call.from : call.to) ?? "").replace(/\D/g, "");

  // ---- terminate: fecha o registro ----------------------------------------
  if (evento === "terminate") {
    const lig = await acharLigacao(sb, call, waId);
    if (!lig) return;
    const falhou = String(call?.status ?? "").toUpperCase() === "FAILED";
    // "atendeu e acabou" ≠ "tocou e ninguém atendeu": a duração da Meta é o
    // tempo FALADO, então 0/ausente sem atendida_em é chamada não atendida
    const daMeta = Number.isFinite(Number(call?.duration)) ? Number(call.duration) : null;
    const atendeu = Boolean(lig.atendida_em) || (daMeta ?? 0) > 0;
    const fim = call?.end_time ? new Date(Number(call.end_time) * 1000) : new Date();
    // a duração da Meta manda; sem ela, calcula do atendimento local
    const duracao = daMeta ?? (lig.atendida_em
      ? Math.max(0, Math.round((fim.getTime() - new Date(lig.atendida_em).getTime()) / 1000))
      : null);
    const { error } = await sb.from("chat_ligacao").update({
      status: falhou ? "falhou" : atendeu ? "concluida" : "nao_atendida",
      encerrada_em: fim.toISOString(),
      duracao_seg: duracao,
      sdp_remoto: null, sdp_tipo: null,
      ...(call?.errors?.[0]?.message ? { erro: String(call.errors[0].message).slice(0, 500) } : {}),
    }).eq("id", lig.id);
    if (error) throw new Error(`update terminate: ${error.message}`);
    return;
  }

  if (evento !== "connect") return;   // 'call_created' é do fluxo SIP; não usamos
  const sdp = String(call?.session?.sdp ?? "");
  const sdpTipo = String(call?.session?.sdp_type ?? "");

  // ---- chamada RECEBIDA: a cliente está ligando ---------------------------
  if (entrante) {
    const cliente = await acharOuCriarCliente(sb, waId, nomePerfil);
    // upsert por call_id: a Meta reentrega o mesmo evento se não receber 200
    const { error } = await sb.from("chat_ligacao").upsert({
      call_id: callId,
      cliente_id: cliente.id,
      canal: "whatsapp",
      direcao: "entrada",
      status: "tocando",
      carteira: cliente.carteira ?? null,
      telefone: waId,
      linha_id: linhaId,
      iniciada_em: call?.timestamp
        ? new Date(Number(call.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
      sdp_remoto: sdp || null,
      sdp_tipo: sdp ? "offer" : null,
    }, { onConflict: "call_id" });
    if (error) throw new Error(`upsert chamada entrante: ${error.message}`);
    return;
  }

  // ---- chamada NOSSA aceita: chegou o `answer` ----------------------------
  const lig = await acharLigacao(sb, call, waId);
  if (!lig) {
    console.error("[wa-webhook] connect sem ligação correspondente:", callId);
    return;
  }
  const { error } = await sb.from("chat_ligacao").update({
    call_id: callId,
    status: "em_curso",
    atendida_em: lig.atendida_em ?? new Date().toISOString(),
    sdp_remoto: sdp || null,
    sdp_tipo: sdpTipo === "offer" ? "offer" : "answer",
    ...(linhaId ? { linha_id: linhaId } : {}),
  }).eq("id", lig.id);
  if (error) throw new Error(`update connect: ${error.message}`);
}

/**
 * Acha a linha de `chat_ligacao` desta chamada.
 *
 * Três caminhos porque há uma CORRIDA real: o webhook do `connect` pode chegar
 * antes de a resposta HTTP do Graph voltar e a rota gravar o `call_id`. São
 * processos distintos e a ordem não é garantida.
 *   1. call_id — o caso normal;
 *   2. `biz_opaque_callback_data` = "lig:<id>", que mandamos ao discar e a Meta
 *      devolve nos eventos — imune à corrida;
 *   3. último recurso: a chamada viva mais recente para o mesmo telefone.
 */
async function acharLigacao(
  sb: any, call: any, waId: string,
): Promise<{ id: number; atendida_em: string | null } | null> {
  const callId = String(call?.id ?? "");
  const cols = "id,atendida_em";

  const { data: porId } = await sb.from("chat_ligacao").select(cols).eq("call_id", callId).maybeSingle();
  if (porId) return porId;

  const rastro = String(call?.biz_opaque_callback_data ?? "");
  const m = /^lig:(\d+)$/.exec(rastro);
  if (m) {
    const { data } = await sb.from("chat_ligacao").select(cols).eq("id", Number(m[1])).maybeSingle();
    if (data) return data;
  }

  const { data: recente } = await sb.from("chat_ligacao").select(cols)
    .eq("telefone", waId).eq("direcao", "saida")
    .in("status", ["discando", "tocando", "em_curso"])
    .gt("iniciada_em", new Date(Date.now() - 5 * 60_000).toISOString())
    .order("iniciada_em", { ascending: false }).limit(1).maybeSingle();
  return recente ?? null;
}

// ---------------------------------------------------------------------------
// Status de mensagem ENVIADA por nós (sent → delivered → read; ou failed)
// ---------------------------------------------------------------------------
async function atualizarStatus(sb: any, st: any): Promise<void> {
  const wamid = String(st.id ?? "");
  const status = String(st.status ?? "");
  if (!wamid || !status) return;
  // Mapeia para o vocabulário que o banco já usa (herdado do RD):
  // wait = só enviada · success = entregue · read = lida
  const mapa: Record<string, string> = {
    sent: "wait",
    delivered: "success",
    read: "read",
    failed: "failed",
  };
  // O motivo da falha vai para o BANCO, não só para o log (migration 0091).
  // Ficava em console.error: a explicação da Meta vivia na Vercel, some com o
  // tempo, e na tela sobrava "falhou" sem causa. Em erro fora da documentação
  // pública — a maioria destes — o texto da Meta é a única pista que existe.
  //
  // Junta todos os campos que a Meta manda, filtrando vazios: `title` costuma
  // ser genérico, `details` é onde mora a causa, e às vezes um deles vem como
  // string VAZIA (§22.6.1) — por isso concatenar, nunca `??`.
  const e0 = (st.errors ?? [])[0] ?? null;
  const explicacao = e0
    ? [e0.code ? `Meta ${e0.code}` : "", e0.title, e0.message, e0.error_data?.details]
        .map((p: unknown) => String(p ?? "").trim())
        .filter(Boolean)
        .join(" — ")
        .slice(0, 500)
    : null;

  const { error } = await sb
    .from("mensagens")
    .update({
      status: mapa[status] ?? status,
      // limpa o erro anterior quando a mensagem volta a andar (reenvio bem
      // sucedido não pode continuar exibindo a falha de antes)
      ...(status === "failed" ? { erro: explicacao ?? "falha sem detalhe da Meta" } : { erro: null }),
    })
    .eq("id", wamid);
  if (error) throw new Error(`update status: ${error.message}`);
  if (status === "failed") {
    console.error("[wa-webhook] envio falhou:", JSON.stringify(st.errors ?? st));
  }
}
