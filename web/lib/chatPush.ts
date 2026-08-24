import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

// Web Push do chat (migration 0096): notificação com o app FECHADO.
//
// O que a página já fazia — bipe, contador no título, Notification API — só
// vale com a aba aberta. Isto é a outra metade: o navegador guarda uma
// inscrição no servidor de push do fabricante (FCM, Mozilla, Apple) e nós
// entregamos ali, assinando com VAPID. Nada nosso roda no aparelho além do
// service worker.

export type Inscricao = { id: number; endpoint: string; p256dh: string; auth: string };

/** Chave pública VAPID, que o navegador precisa para se inscrever. */
export const chavePublica = () => (process.env.VAPID_PUBLIC_KEY ?? "").trim();

/**
 * Configura o web-push. Devolve false quando as chaves não estão no ambiente —
 * e nesse caso NADA falha em cascata: sem VAPID o recurso simplesmente não
 * existe, o chat segue inteiro e o webhook segue respondendo 200.
 *
 * Sanitiza os valores pelo mesmo motivo que `lib/whatsapp.ts` sanitiza o token
 * (§16.4, armadilha 1): um espaço ou quebra de linha colado junto do segredo na
 * Vercel é invisível na tela e derruba a assinatura com erro que não menciona
 * espaço nenhum.
 */
let pronto: boolean | null = null;
export function configurar(): boolean {
  if (pronto !== null) return pronto;
  const pub = chavePublica();
  const priv = (process.env.VAPID_PRIVATE_KEY ?? "").replace(/[^\x21-\x7E]/g, "");
  // `mailto:` é exigido pela especificação: é o contato que o serviço de push
  // usa para reclamar de abuso. Sem um válido, alguns provedores recusam.
  const assunto = (process.env.VAPID_SUBJECT ?? "mailto:ia@muranoprofessional.com.br").trim();
  if (!pub || !priv) { pronto = false; return pronto; }
  try {
    webpush.setVapidDetails(assunto, pub, priv);
    pronto = true;
  } catch {
    pronto = false;
  }
  return pronto;
}

/**
 * Manda uma notificação para todas as inscrições dos usuários indicados.
 *
 * Devolve quantas foram entregues e quantas inscrições mortas foram removidas.
 * NUNCA lança: quem chama é o webhook da Meta, que precisa responder 200 a
 * qualquer custo — a Meta reenvia eternamente o que não recebe 200 (§16.1), e
 * um push que falhou não pode virar uma tempestade de reentregas.
 */
export async function avisar(
  sb: SupabaseClient,
  usuarios: string[],
  carga: { titulo: string; corpo: string; cliente_id?: string; url?: string },
): Promise<{ enviadas: number; removidas: number }> {
  const zero = { enviadas: 0, removidas: 0 };
  if (!configurar() || !usuarios.length) return zero;

  try {
    const { data } = await sb
      .from("chat_push_inscricao")
      .select("id,endpoint,p256dh,auth")
      .in("usuario", usuarios);
    const inscricoes = (data ?? []) as Inscricao[];
    if (!inscricoes.length) return zero;

    const texto = JSON.stringify(carga);
    const mortas: number[] = [];
    let enviadas = 0;

    // Em paralelo: são poucas inscrições (uma por aparelho de quem atende) e o
    // webhook não pode ficar esperando uma fila sequencial.
    await Promise.all(inscricoes.map(async (i) => {
      try {
        await webpush.sendNotification(
          { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
          texto,
          { TTL: 3600 }, // uma hora: aviso de mensagem não vale mais que isso
        );
        enviadas++;
      } catch (e: any) {
        // 404/410 = inscrição morta (app desinstalado, permissão revogada).
        // Não se conserta, só se remove — deixá-la ali faria toda mensagem
        // futura gastar uma tentativa condenada.
        const st = e?.statusCode;
        if (st === 404 || st === 410) mortas.push(i.id);
      }
    }));

    if (mortas.length) await sb.from("chat_push_inscricao").delete().in("id", mortas);
    if (enviadas) {
      await sb.from("chat_push_inscricao")
        .update({ usada_em: new Date().toISOString() })
        .in("id", inscricoes.filter((i) => !mortas.includes(i.id)).map((i) => i.id));
    }
    return { enviadas, removidas: mortas.length };
  } catch {
    return zero;
  }
}

/**
 * Quem deve ser avisado de uma mensagem nesta conversa.
 *
 * A régua é a mesma do escopo do chat: quem VÊ a conversa é quem é avisado dela
 * — senão o push contaria a um vendedor sobre a cliente de outro, que é
 * vazamento de PII por notificação, num aparelho de tela bloqueada.
 *
 * Admin e home NÃO entram: eles enxergam todas as carteiras, e receberiam um
 * push por mensagem da empresa inteira. Quem quiser acompanhar assim abre a
 * tela; notificação que toca o tempo todo é desligada no primeiro dia e nunca
 * mais religada. (Medido em 24/08/2026: 8 dos 15 acessos ativos não têm
 * carteira. Avisá-los seria avisar mais da metade da empresa de tudo.)
 *
 * ⚠️ CONSEQUÊNCIA A CONHECER: conversa SEM carteira não avisa ninguém. É o
 * caso do número desconhecido que escreve pela primeira vez e cai na fila de
 * espera (§21) — ela aparece na tela para todos, mas em silêncio.
 *
 * Foi mantido assim de propósito, e é reversível numa linha: avisar todo mundo
 * significa 7 celulares tocando a cada mensagem de desconhecido, que é o
 * caminho mais curto para a equipe desligar os avisos e perder também os que
 * importam. Se a fila de espera crescer a ponto de justificar, o certo é uma
 * regra própria (um plantão, um horário), não abrir para todos.
 */
export async function destinatarios(sb: SupabaseClient, carteira: string | null): Promise<string[]> {
  if (!carteira) return [];
  try {
    const { data } = await sb
      .from("acesso")
      .select("email")
      .eq("carteira", carteira)
      .eq("ativo", true);
    return (data ?? []).map((a: any) => a.email).filter(Boolean);
  } catch {
    return [];
  }
}
