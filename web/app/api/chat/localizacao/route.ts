import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { sendLocation, canalDeResposta, linhaDeEnvio } from "../../../../lib/whatsapp";
import { lerLocais, type Local } from "../../../../lib/locais";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Enviar localização (0111).
//
// Endereços SALVOS, não a posição do navegador. Duas razões, e a segunda é
// técnica e dura: (1) o que a cliente pergunta é "onde fica a loja", não "onde
// você está agora" — e mandar a posição do celular do consultor num sábado à
// noite é um dado pessoal dele que ninguém pediu; (2) a tela vive dentro de
// iframe (o hub embute o CRM, o board embute o chat), e em iframe cross-origin
// o padrão do navegador para `geolocation` é `self` — sem delegação no `allow`
// de CADA nível o pedido é recusado **sem prompt**, que é a armadilha do
// microfone da §22.5, e exigiria mexer no repositório do hub.
//
// GET  -> os endereços cadastrados (vazio = a tela nem mostra o botão)
// POST -> envia um deles para a conversa
// ---------------------------------------------------------------------------

function sb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase envs ausentes");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });
  const { data } = await sb().from("crm_config").select("locais").eq("id", 1).maybeSingle();
  return Response.json({ locais: lerLocais((data as any)?.locais) });
}

export async function POST(req: Request) {
  const sessao = cookies().get("crm_sessao")?.value;
  if (!sessao) return Response.json({ error: "não autenticado" }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "body inválido" }, { status: 400 }); }
  const cliente_id = String(b?.cliente_id ?? "");
  const idx = Number(b?.local);
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const db = sb();
  const { data: cfg } = await db.from("crm_config").select("locais").eq("id", 1).maybeSingle();
  const locais: Local[] = lerLocais((cfg as any)?.locais);
  const local = locais[idx];
  if (!local) return Response.json({ error: "endereço não encontrado" }, { status: 400 });

  const { data: cli } = await db.from("clientes").select("telefone").eq("id", cliente_id).maybeSingle();
  const tel = String((cli as any)?.telefone ?? "").replace(/\D/g, "");
  if (!tel) return Response.json({ error: "cliente sem telefone" }, { status: 400 });

  // Localização é mensagem LIVRE: fora da janela de 24h a Meta recusa, e nenhum
  // template carrega um mapa. Recusar aqui, com o nome do problema, evita a
  // falha chegar minutos depois pelo webhook, sem contexto.
  if ((await canalDeResposta(db, cliente_id)) !== "whatsapp") {
    return Response.json({
      error: "esta conversa não corre pelo número próprio — só de lá dá para enviar localização",
    }, { status: 422 });
  }

  try {
    const { wamid } = await sendLocation(tel, local);
    // Espelha na thread. O conteúdo é o endereço em texto: quem abre a conversa
    // amanhã precisa ler O QUE foi mandado, e um rótulo "[localização]" não diz.
    await db.from("mensagens").upsert({
      id: wamid, cliente_id, enviada_por: "operator", tipo: "mensagem",
      conteudo: `📍 ${local.nome}\n${local.endereco}`,
      status: "wait", criada_em: new Date().toISOString(), linha_id: linhaDeEnvio(),
    }, { onConflict: "id" });
    return Response.json({ ok: true, id: wamid, local: local.nome });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}
