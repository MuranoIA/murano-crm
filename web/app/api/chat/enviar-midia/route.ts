import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { canalDeResposta, sendMedia, linhaDeEnvio } from "../../../../lib/whatsapp";
import { tipoDoMime, extensaoDoMime, limiteDe, recadoDeLimite, emMB } from "../../../../lib/midia";
import { ehWebm, webmParaOgg, mp4ComOpus } from "../../../../lib/opusOgg";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // baixar do Storage + subir na Meta: mais folga que o texto

// Envio de mídia pelo chat (P0 item 2). Manda pela Cloud API e espelha em
// `mensagens`, com o arquivo no bucket `wa-midia` para a bolha renderizar igual
// à mídia recebida.
//
// ⚠️ O ARQUIVO NÃO PASSA MAIS POR AQUI. Quem sobe é o navegador, direto no
// Storage, com o token de `enviar-midia/assinar` — porque a Vercel corta o corpo
// da requisição em 4,5 MB (`413 FUNCTION_PAYLOAD_TOO_LARGE`) antes da função
// rodar, e era isso que fazia PDF grande falhar (medido em 29/08/2026). Esta
// rota recebe só o CAMINHO do arquivo já guardado, baixa os bytes e repassa.
//
// SÓ canal Cloud: o RD tem outro endpoint de anexo e será aposentado; conversa
// que ainda vive no RD recebe 501 com instrução — normalmente já em `assinar`,
// antes de o arquivo subir.

export async function POST(req: Request) {
  if (!cookies().get("crm_sessao")?.value) {
    return Response.json({ error: "não autenticado" }, { status: 401 });
  }

  const b = await req.json().catch(() => null);
  const cliente_id = String(b?.cliente_id ?? "");
  const path = String(b?.path ?? "");
  const legenda = String(b?.legenda ?? "").trim();
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  if (!path) return Response.json({ error: "path ausente" }, { status: 400 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: cli } = await sb
    .from("clientes").select("id,nome_completo,telefone,carteira").eq("id", cliente_id).maybeSingle();
  if (!cli) return Response.json({ error: "cliente não encontrado" }, { status: 404 });

  if ((await canalDeResposta(sb, cliente_id)) !== "whatsapp") {
    return Response.json({
      error: "Esta conversa ainda está no RD Conversas — envio de arquivo só pelo canal WhatsApp direto.",
    }, { status: 501 });
  }

  const to = String(cli.telefone ?? cliente_id.replace(/^wa:/, "")).replace(/\D/g, "");
  if (!to) return Response.json({ error: "cliente sem telefone" }, { status: 400 });

  // ⚠️ o caminho vem do navegador, então é conferido contra o dono: sem isto,
  // uma sessão qualquer poderia mandar o arquivo de OUTRA conversa (o bucket é
  // privado, mas o caminho carrega o id do cliente e é adivinhável).
  const limpo = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!path.includes(`/${limpo(cli.id as string)}/`)) {
    return Response.json({ error: "arquivo não pertence a esta conversa" }, { status: 403 });
  }

  const baixado = await sb.storage.from("wa-midia").download(path);
  if (baixado.error || !baixado.data) {
    return Response.json({
      error: "Não achei o arquivo que subiu — tente enviar de novo.",
    }, { status: 404 });
  }

  let mime = String(b?.mime || baixado.data.type || "application/octet-stream");
  let nome = String(b?.nome ?? "") || `arquivo.${extensaoDoMime(mime)}`;
  let bytes: ArrayBuffer | Uint8Array = await baixado.data.arrayBuffer();
  const tipo = tipoDoMime(mime);
  let caminho = path;

  // o limite já foi conferido em `assinar`, mas o token de upload não amarra
  // tamanho: quem subiu pode ter mandado mais do que declarou.
  const tamanho = bytes.byteLength;
  if (tamanho > limiteDe(mime)) {
    await apagar(sb, caminho);
    return Response.json({ error: recadoDeLimite(mime, tamanho) }, { status: 413 });
  }

  // ÁUDIO: o WhatsApp só aceita Opus dentro de Ogg. O MediaRecorder do Chrome
  // entrega Opus dentro de WebM (ou de MP4, se pedirem `audio/mp4`), e a Graph
  // API ACEITA o upload nos dois casos — olhando só o container — para falhar
  // depois na entrega, com wamid válido e `status: failed` chegando pelo
  // webhook. Foi o que derrubou o primeiro teste de áudio (16/08). Aqui o
  // container é reescrito antes de sair; o áudio em si não é tocado.
  if (tipo === "audio") {
    if (ehWebm(bytes)) {
      const ogg = webmParaOgg(bytes);
      if (!ogg) {
        await apagar(sb, caminho);
        return Response.json({
          error: "Não consegui converter este áudio para o formato que o WhatsApp aceita. Tente gravar de novo ou envie um MP3.",
        }, { status: 422 });
      }
      bytes = ogg;
      mime = "audio/ogg";
      nome = nome.replace(/\.[^.]+$/, "") + ".ogg";
      // troca o arquivo guardado pelo convertido: o que a bolha toca tem que ser
      // o mesmo que a cliente recebeu, senão o player pede um formato e recebe outro.
      caminho = await regravar(sb, caminho, ogg, mime);
    } else if (mp4ComOpus(bytes)) {
      // recusa explícita: seria aceito no upload e nunca entregue
      await apagar(sb, caminho);
      return Response.json({
        error: "Este áudio está em MP4 com codec Opus, que o WhatsApp aceita mas não entrega. Grave de novo pelo botão de microfone ou envie um MP3.",
      }, { status: 422 });
    }
  }

  let wamid: string;
  const t0 = Date.now();
  try {
    ({ wamid } = await sendMedia(to, bytes, mime, nome, legenda));
  } catch (e: any) {
    // o arquivo já está no bucket e a mensagem não saiu: sem apagar, cada
    // tentativa fora da janela deixaria um órfão que ninguém nunca vê.
    await apagar(sb, caminho);
    if (e?.foraDaJanela) {
      return Response.json({
        error: "Fora da janela de 24h — envie um template para reabrir a conversa.",
        foraDaJanela: true,
      }, { status: 422 });
    }
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
  // fica no log da Vercel: é a medida que diz se o teto de 50 MB do documento
  // (lib/midia.ts) está folgado ou apertado contra o maxDuration desta rota.
  console.log(`[enviar-midia] ${tipo} ${emMB(tamanho)} em ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await sb.from("mensagens").upsert({
    id: wamid,
    cliente_id: cli.id,
    vendedor_carteira: cli.carteira ?? null,
    enviada_por: "operator",
    tipo: "mensagem",
    // áudio não leva legenda e o nome do arquivo é lixo gerado ("audio-173…ogg"):
    // vale o rótulo, igual ao que o webhook grava no áudio RECEBIDO. Este texto
    // não fica só na bolha — é o que o board e a `vw_funil` mostram como última
    // mensagem da conversa.
    conteudo: legenda || (tipo === "audio" ? rotulo(tipo) : nome || rotulo(tipo)),
    status: "wait",
    criada_em: new Date().toISOString(),
    midia_tipo: tipo,
    midia_path: caminho,
    midia_mime: mime,
    midia_nome: nome || null,
    linha_id: linhaDeEnvio(),
  }, { onConflict: "id" });

  return Response.json({ ok: true, wamid, tipo });
}

/** Some com o arquivo quando a mensagem não saiu — o bucket não é lixeira. */
async function apagar(sb: SupabaseClient, path: string) {
  try { await sb.storage.from("wa-midia").remove([path]); } catch { /* órfão custa bytes, não a mensagem */ }
}

/** Regrava o arquivo convertido na extensão certa e some com o original. */
async function regravar(
  sb: SupabaseClient, path: string, bytes: Uint8Array, mime: string,
): Promise<string> {
  const novo = path.replace(/\.[^./]+$/, "") + "." + extensaoDoMime(mime);
  const { error } = await sb.storage
    .from("wa-midia").upload(novo, bytes, { contentType: mime, upsert: true });
  // falhar aqui não impede o envio: a cliente recebe o áudio, só a nossa bolha
  // fica com o arquivo antes da conversão (que o navegador também toca).
  if (error) return path;
  if (novo !== path) await apagar(sb, path);
  return novo;
}

const rotulo = (t: string) =>
  ({ image: "📷 Foto", audio: "🎤 Áudio", video: "🎬 Vídeo", document: "📎 Documento" }[t] ?? "Arquivo");
