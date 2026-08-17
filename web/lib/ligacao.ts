import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe, veTudo } from "./papel";
import { usuarioDaSessao } from "./chatUsuario";
import { carregarAtribuicoes, donoEfetivo } from "./chatEscopo";

// ---------------------------------------------------------------------------
// Peças comuns às rotas de ligação (/api/chat/ligacao e /ligacao/acao).
//
// A régua de quem pode operar uma ligação é a MESMA de quem pode operar a
// conversa: dono efetivo (transferência vigente ?? carteira do funil), ou
// admin/home. Fica aqui, num lugar só, pelo motivo já registrado no
// chatEscopo.ts: régua duplicada acaba divergindo entre rotas, e aí uma
// conversa transferida apareceria numa e sumiria da outra.
// ---------------------------------------------------------------------------

export type Sessao = {
  sb: SupabaseClient;
  usuario: string;
  carteira: string | null;   // null = admin/home (vê tudo)
  tudo: boolean;
};

export type Falha = { erro: Response };

export function sessaoDeLigacao(): Sessao | Falha {
  const sessao = cookies().get("crm_sessao")?.value ?? null;
  const usuario = usuarioDaSessao();
  if (!sessao || !usuario) {
    return { erro: Response.json({ error: "não autenticado" }, { status: 401 }) };
  }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { erro: Response.json({ error: "Supabase envs ausentes" }, { status: 500 }) };
  }
  return {
    sb: createClient(url, key, { auth: { persistSession: false } }),
    usuario,
    carteira: carteiraDe(sessao),
    tudo: veTudo(sessao),
  };
}

export const falhou = (x: Sessao | Falha): x is Falha => "erro" in x;

/**
 * Dono efetivo da conversa + se esta sessão pode operá-la.
 *
 * `dono === null` é conversa SEM DONO (contato novo, na fila): qualquer um pode
 * atuar — é assim que a fila de não atribuídos funciona (§21). Vale especialmente
 * para ligação RECEBIDA: se só o dono pudesse atender, chamada de contato novo
 * tocaria para ninguém.
 */
export async function donoDaConversa(
  s: Sessao,
  clienteId: string,
): Promise<{ dono: string | null; pode: boolean }> {
  const [{ data: linha }, atrib] = await Promise.all([
    s.sb.from("vw_funil").select("cliente_id,vendedor").eq("cliente_id", clienteId).maybeSingle(),
    carregarAtribuicoes(s.sb),
  ]);
  const dono = donoEfetivo(clienteId, (linha?.vendedor as string) ?? null, atrib);
  return { dono, pode: s.tudo || dono === null || dono === s.carteira };
}

/**
 * Telefone do cliente em E.164 sem '+', como a Meta espera.
 *
 * O `55` só é acrescentado quando o número tem cara de brasileiro sem DDI (10 ou
 * 11 dígitos). Números do RD costumam vir com 12 dígitos (DDI + DDD sem o nono)
 * e passam direto — mesma tolerância do link wa.me que o chat já usa.
 */
export function telefoneE164(bruto: string | null | undefined, clienteId?: string): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (!d && clienteId?.startsWith("wa:")) d = clienteId.slice(3).replace(/\D/g, "");
  if (!d) return null;
  if (d.length <= 11) d = `55${d}`;
  return d;
}

/**
 * A ligação existe SÓ onde a conversa já corre na Cloud API — hoje, a linha
 * piloto. Conversa do RD/Tallos não tem ligação: `false` aqui, e o botão nem
 * aparece na tela.
 *
 * Decisão do usuário em 17/08/2026, e ela simplifica o desenho: não há canal
 * alternativo, não há discagem pelo celular, não há registro de ligação feita
 * fora daqui. O escopo da voz é o escopo do piloto.
 *
 * A cláusula do `WHATSAPP_ENVIO_PADRAO` é o caminho da Fase C: no dia em que o
 * número oficial migrar para a Cloud e o interruptor for ligado, a ligação passa
 * a valer para todo mundo pelo mesmo código, sem deploy.
 */
export async function conversaNaCloud(
  sb: SupabaseClient,
  clienteId: string,
): Promise<boolean> {
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) return false;
  if (clienteId.startsWith("wa:")) return true;
  if (process.env.WHATSAPP_ENVIO_PADRAO === "true") return true;
  const { data } = await sb
    .from("mensagens")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("enviada_por", "customer")
    .order("criada_em", { ascending: false })
    .limit(1);
  return typeof data?.[0]?.id === "string" && data[0].id.startsWith("wamid");
}

/** Colunas devolvidas ao front — `sdp_remoto` fica de fora aqui de propósito (é grande). */
export const COLS_LIGACAO =
  "id,cliente_id,canal,direcao,status,call_id,linha_id,carteira,por,telefone," +
  "iniciada_em,atendida_em,encerrada_em,duracao_seg,motivo,observacao,erro";

/** Estados em que a chamada ainda está viva. */
export const VIVOS = ["discando", "tocando", "em_curso"] as const;

/**
 * Fecha a ligação com um desfecho, calculando a duração FALADA.
 *
 * Duração conta de `atendida_em`, não de `iniciada_em`: os segundos de chamando
 * não são conversa. Chamada não atendida fica com duração NULA, não zero — "não
 * atendeu" e "atendeu e desligou na hora" são resultados diferentes, e um zero
 * apagaria essa diferença no indicador.
 */
export function encerramento(
  atual: { atendida_em: string | null },
  status: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const agora = new Date();
  const duracao = atual.atendida_em
    ? Math.max(0, Math.round((agora.getTime() - new Date(atual.atendida_em).getTime()) / 1000))
    : null;
  return { status, encerrada_em: agora.toISOString(), duracao_seg: duracao, ...extras };
}
