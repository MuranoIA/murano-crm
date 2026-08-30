// -----------------------------------------------------------------------------
// Ensaio de equipe: seis consultores atendendo ao mesmo tempo.
//
// O que este arquivo é: as peças compartilhadas do ensaio — quem são os
// consultores, quais são os clientes fictícios, como um cliente "escreve",
// como se mede latência de verdade, e como TUDO isso é removido no fim.
//
// ⚠️ RODA CONTRA O BANCO DE PRODUÇÃO (testes/README.md). Três travas:
//
//  1. Os clientes fictícios vivem numa faixa de telefone RESERVADA
//     (5591 9 000000NN). Conferido no banco antes de escolher: zero colisão de
//     tel8 em `clientes` e em `wth_carteira`. Colidir significaria escrever
//     dentro da conversa de uma cliente real — o pior erro possível aqui.
//
//  2. O envio é interceptado por `SIMULACAO_ENVIO=1` (web/lib/simulacaoEnvio.ts):
//     nada sai para essa faixa, aconteça o que acontecer no laço.
//
//  3. Tudo o que o ensaio escreve é apagado por `limparEnsaio()`, que varre por
//     PREFIXO e não por lista guardada em memória — se o processo morrer no
//     meio, a limpeza da próxima rodada ainda acha o lixo da anterior.
// -----------------------------------------------------------------------------
import { randomUUID } from "node:crypto";
import { BASE } from "./api.mjs";
import { ENV } from "./db.mjs";

/** Os seis consultores (papel `vendedor` em `acesso`, slug = cookie). */
export const CONSULTORES = ["anne", "kamilly", "luana", "milene", "thamires", "thiago"];

/** Os dois supervisores que ficam olhando enquanto os seis trabalham. */
export const SUPERVISORES = [
  { rotulo: "romulo (admin)", sessao: { crm_sessao: "admin", crm_email: "romuloalbuquerque@muranoprofessional.com.br" } },
  { rotulo: "jonatas (admin)", sessao: { crm_sessao: "admin", crm_email: "jonatassilva@muranoprofessional.com.br" } },
];

/** A linha em uso (Murano Professional). É o que o webhook carimba em `linha_id`. */
export const LINHA = "1264458800091787";

/** Prefixo do telefone fictício. NÃO MUDAR sem reconferir colisão de tel8. */
const RAIZ_FICTICIA = "55919";

/** Telefone fictício nº i, formato E.164 sem '+', 13 dígitos como a Meta manda. */
export const telefoneFicticio = (i) => `${RAIZ_FICTICIA}${String(i).padStart(8, "0")}`;

/** O id que o webhook cria para ele (§16.3: `wa:<wa_id>`). */
export const idFicticio = (i) => `wa:${telefoneFicticio(i)}`;

/** Casa qualquer cliente do ensaio, para a limpeza. */
export const PADRAO_ID_FICTICIO = `wa:${RAIZ_FICTICIA}0000%`;

export const sessaoDe = (slug) => ({ crm_sessao: slug, crm_email: `${slug}@muranoprofessional.com.br` });

export const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// O cliente fictício escrevendo — um POST no webhook, no mesmo formato da Meta.
//
// Localmente a assinatura X-Hub-Signature-256 não é exigida (o webhook aceita
// sem validar quando WHATSAPP_APP_SECRET não existe, e ele não existe nesta
// máquina). É por isso que o ensaio roda contra `next start` local e NÃO contra
// crm.muranoprofessional.com.br: lá a assinatura é obrigatória e o segredo é
// write-only na Vercel — não há como forjar entrada em produção.
// ---------------------------------------------------------------------------

/** wamid de entrada, no formato da Meta (só para ser um id estável e único). */
export const wamidEntrada = () => `wamid.SIM${randomUUID().replace(/-/g, "").toUpperCase()}`;

function envelope(mensagem, nomePerfil, waId) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "1568370048121307",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5591816600019", phone_number_id: LINHA },
          contacts: [{ profile: { name: nomePerfil }, wa_id: waId }],
          messages: [mensagem],
        },
      }],
    }],
  };
}

/** Quantos reenvios o ensaio precisou fazer — é medida, não detalhe. */
export const reenvios = { total: 0, desistiu: 0 };

async function entregarWebhook(corpo) {
  const t0 = Date.now();
  // A Meta reenvia com espera crescente o evento que não recebe 200. O
  // simulador precisa fazer o mesmo, senão ele mede um sistema mais frágil do
  // que o real — e, pior, esconderia justamente a correção que faz o webhook
  // pedir reenvio em vez de perder a mensagem em silêncio.
  let r, texto = "";
  for (let tent = 0; tent < 5; tent++) {
    r = await fetch(`${BASE}/api/whatsapp/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    texto = await r.text();
    if (r.status !== 503) break;
    reenvios.total++;
    await espera(300 * (tent + 1));
  }
  if (r.status === 503) reenvios.desistiu++;
  return { status: r.status, ms: Date.now() - t0, texto };
}

/** A cliente manda um texto. */
export function clienteEscreve(i, texto, nome) {
  const waId = telefoneFicticio(i);
  const id = wamidEntrada();
  return entregarWebhook(envelope({
    from: waId, id, timestamp: String(Math.floor(Date.now() / 1000)),
    type: "text", text: { body: texto },
  }, nome ?? `Cliente Ensaio ${i}`, waId)).then((r) => ({ ...r, wamid: id }));
}

/** A cliente manda uma foto/áudio. `media_id` não é baixável — o webhook grava
 *  a mensagem mesmo assim e deixa `midia_id` para reprocessar (§18 P0). */
export function clienteMandaMidia(i, tipo, nome) {
  const waId = telefoneFicticio(i);
  const id = wamidEntrada();
  const mime = tipo === "image" ? "image/jpeg" : tipo === "audio" ? "audio/ogg" : "application/pdf";
  const conteudo = { id: `midiaSIM${randomUUID().slice(0, 8)}`, mime_type: mime };
  if (tipo === "document") conteudo.filename = "orcamento-ensaio.pdf";
  return entregarWebhook(envelope({
    from: waId, id, timestamp: String(Math.floor(Date.now() / 1000)),
    type: tipo, [tipo]: conteudo,
  }, nome ?? `Cliente Ensaio ${i}`, waId)).then((r) => ({ ...r, wamid: id }));
}

/** A cliente responde CITANDO uma mensagem nossa (is_reply / resposta_a). */
export function clienteResponde(i, texto, wamidCitado) {
  const waId = telefoneFicticio(i);
  const id = wamidEntrada();
  return entregarWebhook(envelope({
    from: waId, id, timestamp: String(Math.floor(Date.now() / 1000)),
    type: "text", text: { body: texto }, context: { id: wamidCitado },
  }, `Cliente Ensaio ${i}`, waId)).then((r) => ({ ...r, wamid: id }));
}

/** Recibo de entrega/leitura, como a Meta manda depois de um envio nosso. */
export function reciboDe(wamid, estado, i) {
  return entregarWebhook({
    object: "whatsapp_business_account",
    entry: [{
      id: "1568370048121307",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5591816600019", phone_number_id: LINHA },
          statuses: [{
            id: wamid, status: estado, timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_id: telefoneFicticio(i),
          }],
        },
      }],
    }],
  });
}

// ---------------------------------------------------------------------------
// Arquivos de ensaio.
//
// São mínimos de propósito: o que está sob teste é o CAMINHO (rota, bucket,
// espelho, bolha), não o codec. Mas o mime importa — `enviar-midia` reescreve
// container de áudio e RECUSA webm/mp4-opus (§ do próprio route), então o áudio
// aqui é ogg de verdade, para exercitar o caminho que o consultor vai usar.
// ---------------------------------------------------------------------------
export function arquivosDeEnsaio() {
  // JPEG 1x1 válido
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
  // Ogg mínimo (cabeçalho OggS + Opus). Não toca; serve para provar o caminho.
  const ogg = Buffer.concat([
    Buffer.from("OggS", "ascii"),
    Buffer.from([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 19]),
    Buffer.from("OpusHead", "ascii"),
    Buffer.from([1, 1, 56, 1, 128, 187, 0, 0, 0, 0, 0]),
  ]);
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 99]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n", "latin1");
  return {
    imagem: { bytes: jpeg, mime: "image/jpeg", nome: "foto-ensaio.jpg" },
    audio: { bytes: ogg, mime: "audio/ogg", nome: "audio-ensaio.ogg" },
    documento: { bytes: pdf, mime: "application/pdf", nome: "orcamento-ensaio.pdf" },
  };
}

/**
 * Envia mídia pelo caminho REAL, em três passos — o mesmo que o navegador faz
 * desde o PR #150.
 *
 * ⚠️ O arquivo NÃO passa mais pelo nosso servidor: a Vercel corta o corpo de
 * qualquer requisição em 4,5 MB antes de a função rodar, e era isso que fazia
 * PDF pequeno passar e PDF grande falhar. Então:
 *
 *   1. `enviar-midia/assinar` devolve `{path, token}` (e confere a conversa)
 *   2. os bytes vão DIRETO para o Storage, com esse token
 *   3. `enviar-midia` recebe só o caminho, baixa e repassa para a Meta
 *
 * Um teste que mandasse FormData para a rota exercitaria um contrato que não
 * existe mais — foi exatamente o que aconteceu aqui em 30/08 e devolveu
 * `400 cliente_id ausente` em 36 envios seguidos.
 */
export async function enviarMidia(chamar, sessao, cliente_id, arquivo, legenda) {
  const ass = await chamar("/api/chat/enviar-midia/assinar", {
    metodo: "POST", sessao,
    corpo: { cliente_id, nome: arquivo.nome, mime: arquivo.mime, tamanho: arquivo.bytes.length },
  });
  if (ass.status !== 200 || !ass.json?.path) return ass;

  const base = ENV_STORAGE();
  const url = `${base}/storage/v1/object/upload/sign/wa-midia/${ass.json.path}?token=${encodeURIComponent(ass.json.token)}`;
  const put = await fetch(url, {
    method: "PUT",
    headers: { "content-type": arquivo.mime, "x-upsert": "true" },
    body: arquivo.bytes,
  });
  if (!put.ok) {
    return { status: put.status, json: { error: `falha ao subir para o Storage: ${await put.text()}` }, texto: "", ms: 0 };
  }

  return chamar("/api/chat/enviar-midia", {
    metodo: "POST", sessao,
    corpo: {
      cliente_id, path: ass.json.path,
      mime: ass.json.mime ?? arquivo.mime, nome: ass.json.nome ?? arquivo.nome,
      ...(legenda ? { legenda } : null),
    },
  });
}

/** A URL do Storage — a mesma que o navegador usa. */
function ENV_STORAGE() {
  const v = ENV.NEXT_PUBLIC_SUPABASE_URL || ENV.SUPABASE_URL;
  if (v) return v;
  throw new Error("SUPABASE_URL ausente — o ensaio de mídia precisa falar com o Storage");
}

// ---------------------------------------------------------------------------
// Medição.
//
// Guarda CADA chamada, não uma média corrente: a média esconde exatamente o que
// interessa num ensaio de simultaneidade, que é a cauda. O relatório sai em
// p50/p90/máximo — e a p90 é a que diz se o consultor vai sentir.
// ---------------------------------------------------------------------------
export class Metricas {
  constructor() { this.amostras = []; }

  registrar(rota, ms, status, quem, erro) {
    this.amostras.push({ rota, ms, status, quem, erro: erro ?? null, em: Date.now() });
  }

  /** Envolve uma chamada de `api.mjs` e registra o tempo e o status. */
  async medir(rota, quem, fn) {
    const t0 = Date.now();
    try {
      const r = await fn();
      const erro = r.status >= 400 ? (r.json?.error ?? r.texto ?? "").slice(0, 160) : null;
      this.registrar(rota, Date.now() - t0, r.status, quem, erro);
      return r;
    } catch (e) {
      this.registrar(rota, Date.now() - t0, 0, quem, String(e.message ?? e).slice(0, 160));
      throw e;
    }
  }

  porRota() {
    const mapa = new Map();
    for (const a of this.amostras) {
      if (!mapa.has(a.rota)) mapa.set(a.rota, []);
      mapa.get(a.rota).push(a);
    }
    const linhas = [];
    for (const [rota, lista] of mapa) {
      const ms = lista.map((x) => x.ms).sort((a, b) => a - b);
      const pc = (p) => ms[Math.min(ms.length - 1, Math.floor((ms.length - 1) * p))];
      const ruins = lista.filter((x) => x.status === 0 || x.status >= 400);
      linhas.push({
        rota, n: lista.length,
        p50: pc(0.5), p90: pc(0.9), max: ms[ms.length - 1],
        erros: ruins.length,
        // até 3 exemplos distintos — mais que isso vira ruído no relatório
        exemplos: [...new Set(ruins.map((x) => `${x.status} ${x.erro ?? ""}`.trim()))].slice(0, 3),
      });
    }
    return linhas.sort((a, b) => b.p90 - a.p90);
  }

  get total() { return this.amostras.length; }
  get falhas() { return this.amostras.filter((a) => a.status === 0 || a.status >= 400).length; }

  /** Pico real de simultaneidade: maior nº de chamadas iniciadas no mesmo segundo. */
  picoPorSegundo() {
    const s = new Map();
    for (const a of this.amostras) {
      const k = Math.floor(a.em / 1000);
      s.set(k, (s.get(k) ?? 0) + 1);
    }
    return Math.max(0, ...s.values());
  }
}

// ---------------------------------------------------------------------------
// Limpeza.
//
// Varre por PREFIXO, não por lista em memória. Se o processo morrer no meio, a
// próxima rodada ainda acha e remove o que ficou — que é a diferença entre uma
// suíte segura e uma que só é segura quando dá tudo certo.
// ---------------------------------------------------------------------------
export async function limparEnsaio(sb) {
  const relato = [];
  const conta = (r) => (r.error ? `ERRO ${r.error.message}` : `${r.count ?? 0}`);

  const { data: alvos } = await sb.from("clientes").select("id").like("id", PADRAO_ID_FICTICIO);
  const ids = (alvos ?? []).map((c) => c.id);
  relato.push(`clientes fictícios encontrados: ${ids.length}`);

  // arquivos do bucket antes das linhas — depois de apagar `mensagens` não há
  // mais como saber quais objetos eram do ensaio
  let arquivos = 0;
  for (const id of ids) {
    const mes = new Date().toISOString().slice(0, 7);
    const pasta = `${mes}/${id.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const { data: lista } = await sb.storage.from("wa-midia").list(pasta, { limit: 200 });
    const nomes = (lista ?? []).map((o) => `${pasta}/${o.name}`);
    if (nomes.length) {
      await sb.storage.from("wa-midia").remove(nomes);
      arquivos += nomes.length;
    }
  }
  relato.push(`arquivos removidos do bucket wa-midia: ${arquivos}`);

  if (ids.length) {
    for (const tabela of ["chat_nota", "chat_transferencia", "chat_leitura", "chat_resolucao", "chat_conversa", "cadastro_cliente", "mensagens"]) {
      const r = await sb.from(tabela).delete({ count: "exact" }).in("cliente_id", ids);
      relato.push(`${tabela}: ${conta(r)}`);
    }
    const rc = await sb.from("clientes").delete({ count: "exact" }).in("id", ids);
    relato.push(`clientes: ${conta(rc)}`);
  }

  // rede de segurança: qualquer mensagem com wamid simulado que tenha escapado
  // para um cliente REAL (só aconteceria se a lista de destinos reais estivesse
  // errada). Zero é o esperado; diferente de zero é achado de relatório.
  const rs = await sb.from("mensagens").delete({ count: "exact" }).like("id", "sim.%");
  relato.push(`mensagens com wamid simulado fora da faixa: ${conta(rs)}`);

  return relato;
}
