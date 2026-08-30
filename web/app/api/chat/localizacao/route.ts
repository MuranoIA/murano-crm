import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { sendLocation, sendLocationRequest, canalDeResposta, linhaDaConversa } from "../../../../lib/whatsapp";
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
// POST -> envia um deles para a conversa, OU pede a localização da cliente
//
// ---- "localização em tempo real" (0115) -----------------------------------
//
// `{pedir: true}` manda o botão que abre, no aparelho da cliente, a tela de
// compartilhar localização. A posição do momento volta pelo webhook como um
// `location` comum.
//
// É o mais perto de "tempo real" que existe aqui, e a diferença importa: a live
// location do WhatsApp — a que fica atualizando sozinha por 15 min, 1 h ou 8 —
// **não é entregue por esta API**. Verificado em 27/08/2026 na referência de
// webhook da Meta (que descreve só o pino estático: latitude, longitude, name,
// address, url) e na documentação de BSP, que afirma o mesmo. Uma imitação
// mostraria um ponto parado com cara de rastreamento, que é pior que não ter —
// por isso o texto da tela diz "posição do momento", não "ao vivo".
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
  const pedir = b?.pedir === true;
  if (!cliente_id) return Response.json({ error: "cliente_id ausente" }, { status: 400 });

  const db = sb();

  // ---- pedir a localização atual da cliente -------------------------------
  if (pedir) {
    const { data: c } = await db.from("clientes").select("telefone").eq("id", cliente_id).maybeSingle();
    const t = String((c as any)?.telefone ?? "").replace(/[^0-9]/g, "");
    if (!t) return Response.json({ error: "cliente sem telefone" }, { status: 400 });
    if ((await canalDeResposta(db, cliente_id)) !== "whatsapp") {
      return Response.json({
        error: "esta conversa não corre pelo número próprio — o pedido de localização só existe lá",
      }, { status: 422 });
    }
    const texto = String(b?.texto ?? "").trim()
      || "Pode compartilhar sua localização? Assim consigo confirmar o endereço.";
    try {
      const linha = await linhaDaConversa(sb, cliente_id);
      const { wamid } = await sendLocationRequest(t, texto, linha);
      // Espelha o PEDIDO na thread. Sem isso o vendedor não vê que já pediu e
      // pede de novo — o mesmo cuidado do cartão de permissão de chamada
      // (§22.6), espelhado pela mesma razão.
      await db.from("mensagens").upsert({
        id: wamid, cliente_id, enviada_por: "operator", tipo: "mensagem",
        conteudo: "📍 " + texto,
        status: "wait", criada_em: new Date().toISOString(), linha_id: linha,
      }, { onConflict: "id" });
      return Response.json({ ok: true, id: wamid, pedido: true });
    } catch (e: any) {
      return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
    }
  }
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
    const linha = await linhaDaConversa(sb, cliente_id);
    const { wamid } = await sendLocation(tel, local, linha);
    // A mensagem JÁ FOI para a cliente neste ponto. Se o espelho falhar, ela
    // recebeu um mapa que não existe na thread — o vendedor manda de novo. Por
    // isso a segunda tentativa sem `localizacao`, para o caso de a 0115 ainda
    // não estar aplicada: perder o cartão é ruim, perder o registro do que foi
    // enviado é pior.
    // Espelha na thread. O conteúdo é o endereço em texto: quem abre a conversa
    // amanhã precisa ler O QUE foi mandado, e um rótulo "[localização]" não diz.
    const espelho = async (comPonto: boolean) => db.from("mensagens").upsert({
      id: wamid, cliente_id, enviada_por: "operator", tipo: "mensagem",
      conteudo: `📍 ${local.nome}\n${local.endereco}`,
      // o mesmo cartão de mapa que a bolha recebida desenha (0115): o que NÓS
      // mandamos precisa aparecer igual ao que ELA manda, senão a thread conta
      // duas histórias visuais para a mesma coisa
      ...(comPonto
        ? { localizacao: { lat: local.lat, lng: local.lng, nome: local.nome, endereco: local.endereco, url: null } }
        : {}),
      status: "wait", criada_em: new Date().toISOString(), linha_id: linha,
    }, { onConflict: "id" });

    const r1 = await espelho(true);
    if (r1.error && /localizacao/i.test(r1.error.message)) await espelho(false);
    return Response.json({ ok: true, id: wamid, local: local.nome });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}
