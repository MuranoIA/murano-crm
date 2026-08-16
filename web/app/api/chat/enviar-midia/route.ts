import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { canalDeResposta, sendMedia, tipoDoMime, extensaoDoMime, linhaDeEnvio } from "../../../../lib/whatsapp";
import { ehWebm, webmParaOgg, mp4ComOpus } from "../../../../lib/opusOgg";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // upload + envio: mais folga que o texto

// Envio de mídia pelo chat (P0 item 2). Recebe multipart do navegador, manda pela
// Cloud API e espelha em `mensagens` — inclusive guardando o arquivo no bucket
// `wa-midia`, para a bolha renderizar igual à mídia recebida.
//
// SÓ canal Cloud: o RD tem outro endpoint de anexo e será aposentado; conversa que
// ainda vive no RD recebe 501 com instrução, em vez de falhar silenciosamente.
const LIMITE_BYTES = 16 * 1024 * 1024; // 16 MB — teto prático do WhatsApp p/ vídeo

export async function POST(req: Request) {
  if (!cookies().get("crm_sessao")?.value) {
    return Response.json({ error: "não autenticado" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "body inválido (esperado multipart)" }, { status: 400 });
  }
  const cliente_id = String(form.get("cliente_id") ?? "");
  const legenda = String(form.get("legenda") ?? "").trim();
  const arquivo = form.get("arquivo");
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  if (!(arquivo instanceof File)) return Response.json({ error: "arquivo ausente" }, { status: 400 });
  if (arquivo.size > LIMITE_BYTES) {
    return Response.json({ error: "arquivo acima de 16 MB" }, { status: 413 });
  }

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

  let mime = arquivo.type || "application/octet-stream";
  let bytes: ArrayBuffer | Uint8Array = await arquivo.arrayBuffer();
  let nome = arquivo.name || `arquivo.${extensaoDoMime(mime)}`;
  const tipo = tipoDoMime(mime);

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
        return Response.json({
          error: "Não consegui converter este áudio para o formato que o WhatsApp aceita. Tente gravar de novo ou envie um MP3.",
        }, { status: 422 });
      }
      bytes = ogg;
      mime = "audio/ogg";
      nome = nome.replace(/\.[^.]+$/, "") + ".ogg";
    } else if (mp4ComOpus(bytes)) {
      // recusa explícita: seria aceito no upload e nunca entregue
      return Response.json({
        error: "Este áudio está em MP4 com codec Opus, que o WhatsApp aceita mas não entrega. Grave de novo pelo botão de microfone ou envie um MP3.",
      }, { status: 422 });
    }
  }

  let wamid: string;
  try {
    ({ wamid } = await sendMedia(to, bytes, mime, nome, legenda));
  } catch (e: any) {
    if (e?.foraDaJanela) {
      return Response.json({
        error: "Fora da janela de 24h — envie um template para reabrir a conversa.",
        foraDaJanela: true,
      }, { status: 422 });
    }
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }

  // guarda o arquivo (mesmo caminho da mídia recebida) para a bolha renderizar
  let midia_path: string | null = null;
  try {
    const limpo = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
    const mes = new Date().toISOString().slice(0, 7);
    const path = `${mes}/${limpo(cli.id)}/${limpo(wamid)}.${extensaoDoMime(mime)}`;
    const { error } = await sb.storage.from("wa-midia").upload(path, bytes, { contentType: mime, upsert: true });
    if (!error) midia_path = path;
  } catch { /* mensagem já foi enviada; sem o espelho local a bolha só perde o preview */ }

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
    midia_path,
    midia_mime: mime,
    midia_nome: nome || null,
    linha_id: linhaDeEnvio(),
  }, { onConflict: "id" });

  return Response.json({ ok: true, wamid, tipo });
}

const rotulo = (t: string) =>
  ({ image: "📷 Foto", audio: "🎤 Áudio", video: "🎬 Vídeo", document: "📎 Documento" }[t] ?? "Arquivo");
