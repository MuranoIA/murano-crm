import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { canalDeResposta } from "../../../../../lib/whatsapp";
import { extensaoDoMime, limiteDe, recadoDeLimite } from "../../../../../lib/midia";

export const dynamic = "force-dynamic";

/**
 * Primeiro passo do envio de arquivo: devolve um endereço no Storage e um token
 * de escrita de uso único, para o NAVEGADOR subir o arquivo direto no Supabase.
 *
 * ⚠️ Isto existe por causa de um limite da plataforma, não de gosto: a Vercel
 * corta o CORPO de qualquer requisição em 4,5 MB, com `413
 * FUNCTION_PAYLOAD_TOO_LARGE`, ANTES da função rodar. Medido na produção em
 * 29/08/2026 — 4,0 MB chegava, 6,0 MB voltava 413. Era isso que fazia PDF
 * pequeno passar e PDF grande falhar, sem nada de errado no nosso código nem na
 * Meta. Mandar o arquivo pelo nosso servidor é, portanto, um beco: o caminho
 * tem que desviar dele.
 *
 * As checagens caras ficam TODAS aqui, antes de um byte subir. Recusar depois
 * de 40 MB enviados — que é o que a rota de envio fazia com o 501 do RD — é o
 * oposto de ajudar.
 */
export async function POST(req: Request) {
  if (!cookies().get("crm_sessao")?.value) {
    return Response.json({ error: "não autenticado" }, { status: 401 });
  }

  const b = await req.json().catch(() => null);
  const cliente_id = String(b?.cliente_id ?? "");
  const mime = String(b?.mime || "application/octet-stream");
  const nome = String(b?.nome ?? "");
  const tamanho = Number(b?.tamanho ?? 0);
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });
  if (!(tamanho > 0)) return Response.json({ error: "arquivo vazio" }, { status: 400 });
  if (tamanho > limiteDe(mime)) {
    return Response.json({ error: recadoDeLimite(mime, tamanho) }, { status: 413 });
  }

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ error: "Supabase envs ausentes" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: cli } = await sb
    .from("clientes").select("id").eq("id", cliente_id).maybeSingle();
  if (!cli) return Response.json({ error: "cliente não encontrado" }, { status: 404 });

  // canal ANTES do upload: conversa que ainda vive no RD não recebe arquivo por
  // aqui, e descobrir isso depois da subida seria gastar a paciência de quem
  // esperou o arquivo inteiro para ouvir "não".
  if ((await canalDeResposta(sb, cliente_id)) !== "whatsapp") {
    return Response.json({
      error: "Esta conversa ainda está no RD Conversas — envio de arquivo só pelo canal WhatsApp direto.",
    }, { status: 501 });
  }

  // caminho novo a cada envio: o wamid (que a mídia recebida usa como nome) só
  // existe DEPOIS do envio, e aqui o arquivo sobe antes. `upsert` fica ligado
  // porque o navegador pode repetir a subida do mesmo token após uma queda.
  const limpo = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
  const mes = new Date().toISOString().slice(0, 7);
  const path = `${mes}/${limpo(cli.id as string)}/${cru()}.${extensaoDoMime(mime)}`;

  const { data, error } = await sb.storage
    .from("wa-midia").createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.token) {
    return Response.json({ error: error?.message ?? "falha ao assinar o upload" }, { status: 500 });
  }

  return Response.json({ path: data.path ?? path, token: data.token, nome, mime });
}

const cru = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
