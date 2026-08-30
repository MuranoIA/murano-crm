import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { sendText, sendMedia, canalDeResposta, linhaDaConversa, tipoDoMime } from "../../../../lib/whatsapp";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Encaminhar uma mensagem para outro contato (0111).
//
// ⚠️ A Cloud API NÃO TEM "forward". Encaminhar aqui é **reenviar o mesmo
// conteúdo** para outra pessoa — e isso muda o que a cliente vê: ela recebe uma
// mensagem normal, sem o selo "Encaminhada" que o WhatsApp põe. A tela diz isso
// antes de confirmar; prometer o selo seria mentir sobre o que chega do lado de
// lá.
//
// Do NOSSO lado a origem fica gravada (`mensagens.encaminhada_de`), senão a
// thread finge que o consultor escreveu aquele texto do zero — e três semanas
// depois ninguém responde "de onde veio isto?".
//
// A janela de 24h vale para o DESTINO, não para a origem: encaminhar é começar
// a falar com outra pessoa.
// ---------------------------------------------------------------------------

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const mensagem_id = String(b?.mensagem_id ?? "");
  const para = String(b?.para ?? "");
  if (!mensagem_id || !para) return Response.json({ error: "informe a mensagem e o destino" }, { status: 400 });

  const db = sb();

  const { data: msg } = await db
    .from("mensagens")
    .select("id,cliente_id,conteudo,midia_path,midia_mime,midia_tipo")
    .eq("id", mensagem_id).maybeSingle();
  if (!msg) return Response.json({ error: "mensagem não encontrada" }, { status: 404 });
  if ((msg as any).cliente_id === para) {
    return Response.json({ error: "essa é a própria conversa" }, { status: 400 });
  }

  const { data: dest } = await db.from("clientes").select("telefone,nome_completo").eq("id", para).maybeSingle();
  const tel = String((dest as any)?.telefone ?? "").replace(/\D/g, "");
  if (!tel) return Response.json({ error: "o contato de destino não tem telefone" }, { status: 400 });

  // Reenviar conteúdo livre exige janela aberta NO DESTINO. Fora dela, o
  // caminho é template — e template não carrega o texto encaminhado.
  if ((await canalDeResposta(db, para)) !== "whatsapp") {
    return Response.json({
      error: "essa conversa não corre pelo número próprio — só de lá dá para encaminhar",
    }, { status: 422 });
  }

  // A linha é a do DESTINO, não a da conversa de origem: encaminhar é começar
  // a falar com outra pessoa, e é o número em que ELA escreve que vale.
  const linha = await linhaDaConversa(db, para);

  const comum = {
    cliente_id: para, enviada_por: "operator", tipo: "mensagem",
    status: "wait", criada_em: new Date().toISOString(),
    linha_id: linha,
    encaminhada_de: (msg as any).cliente_id,
  };

  /**
   * Grava, e se a coluna `encaminhada_de` ainda não existir (migration 0111 não
   * aplicada), grava sem ela.
   *
   * Sem isto o botão ↪ apareceria em produção e falharia até alguém rodar o SQL
   * — um botão quebrado é pior que um botão ausente. Perder a origem degrada a
   * qualidade do registro; não impedir o envio é o que importa para quem está
   * com a cliente na frente.
   */
  async function gravar(linha: Record<string, unknown>) {
    const { error } = await db.from("mensagens").upsert(linha, { onConflict: "id" });
    if (error && /encaminhada_de/.test(error.message ?? "")) {
      const { encaminhada_de: _fora, ...semColuna } = linha as any;
      await db.from("mensagens").upsert(semColuna, { onConflict: "id" });
    }
  }

  try {
    const path = (msg as any).midia_path as string | null;
    if (path) {
      // A mídia já está no nosso bucket privado. Baixamos os bytes e
      // reenviamos — e não por URL assinada: `sendMedia` sobe o arquivo para a
      // Meta, o que evita expor um link do bucket, mesmo temporário.
      const { data: arq, error: errArq } = await db.storage.from("wa-midia").download(path);
      if (errArq || !arq) return Response.json({ error: "não consegui ler o arquivo original" }, { status: 500 });
      const mime = String((msg as any).midia_mime ?? arq.type ?? "application/octet-stream");
      const bytes = await arq.arrayBuffer();
      const nome = path.split("/").pop() || "arquivo";
      const { wamid } = await sendMedia(tel, bytes, mime, nome, (msg as any).conteudo ?? undefined, linha);
      await gravar({
        ...comum, id: wamid,
        conteudo: (msg as any).conteudo ?? null,
        midia_path: path, midia_mime: mime, midia_tipo: (msg as any).midia_tipo ?? tipoDoMime(mime),
      });
      return Response.json({ ok: true, id: wamid, para: (dest as any)?.nome_completo ?? para });
    }

    const texto = String((msg as any).conteudo ?? "").trim();
    if (!texto) return Response.json({ error: "não há o que encaminhar nesta mensagem" }, { status: 400 });
    const { wamid } = await sendText(tel, texto, linha);
    await gravar({ ...comum, id: wamid, conteudo: texto });
    return Response.json({ ok: true, id: wamid, para: (dest as any)?.nome_completo ?? para });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}
