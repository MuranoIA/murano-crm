import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { carteiraDe, veTudo } from "./papel";
import { usuarioDaSessao } from "./chatUsuario";
import { carregarAtribuicoes, donoEfetivo } from "./chatEscopo";
import { canalDeResposta } from "./whatsapp";

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
 * A ligação existe SÓ onde a conversa já corre na Cloud API — não há canal
 * alternativo, não há discagem pelo celular, não há registro de ligação feita
 * fora daqui (decisão do usuário em 17/08/2026, e ela simplifica o desenho).
 *
 * O QUE MUDOU: essa pergunta agora é respondida por `canalDeResposta()`, a
 * mesma função que decide por onde a MENSAGEM sai. Antes havia uma régua
 * própria aqui, e ela ficou para trás em dois pontos:
 *
 *  - não olhava `crm_config.numero_envio` (0102). Com o admin fixando "cloud",
 *    toda conversa é respondida pela Cloud — menos a ligação, que continuava
 *    procurando prova no histórico;
 *  - a prova que ela procurava era uma mensagem RECEBIDA com id `wamid`. Quem
 *    NUNCA escreveu para nós não tem nenhuma, então caía em `false`. Ou seja:
 *    ausência de prova virava prova de RD — o mesmo erro de leitura que o `??`
 *    já causou três vezes neste projeto (§62.5).
 *
 * O sintoma, depois da migração do número oficial (09/09/2026): cliente com o
 * chip "Murano Professional", `canal_envio: whatsapp` e linha de envio Murano
 * Professional — e mesmo assim "esta conversa ainda corre pelo RD Conversas" ao
 * tentar ligar. Duas verdades sobre a mesma conversa, que é exatamente o que
 * este projeto evita em toda parte (§29.3).
 *
 * A cláusula do `WHATSAPP_ENVIO_PADRAO` sai porque `canalDeResposta()` já a
 * cobre por config, sem depender de env nem de deploy.
 *
 * ⚠️ Isto NÃO promete que a chamada vai completar: a Meta ainda exige permissão
 * da cliente (138006, que a tela resolve com "Pedir autorização") e meio de
 * pagamento na conta (131044). Ganha-se o erro CERTO no lugar de um "fora do
 * piloto" que nomeia um sistema que não existe mais (§44).
 */
export async function conversaNaCloud(
  sb: SupabaseClient,
  clienteId: string,
): Promise<boolean> {
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) return false;
  return (await canalDeResposta(sb, clienteId)) === "whatsapp";
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
