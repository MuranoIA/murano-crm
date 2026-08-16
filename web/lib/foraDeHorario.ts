import type { SupabaseClient } from "@supabase/supabase-js";
import { sendText, linhaDeEnvio } from "./whatsapp";

// ---------------------------------------------------------------------------
// Resposta automática fora do horário de atendimento.
//
// Substitui o que o chatbot externo fazia: avisar a cliente que ninguém vai
// responder agora, em vez de deixá-la no vácuo de madrugada.
//
// Três cuidados que definem o comportamento:
//  1. NASCE DESLIGADA. `chat_horario_atendimento.ativo` só é ligado por decisão
//     explícita — isto envia mensagem para cliente real.
//  2. NÃO REPETE. Uma cliente que manda cinco mensagens às 2h recebe UM aviso,
//     não cinco (janela `intervalo_horas`).
//  3. NUNCA DERRUBA O WEBHOOK. Qualquer falha aqui é engolida e logada: perder
//     a mensagem recebida por causa de um aviso automático seria muito pior.
//
// A mensagem enviada é gravada com `tipo = 'auto'` — aparece na conversa (o
// vendedor precisa ver o que foi dito em seu nome), mas é excluída do indicador
// de tempo de resposta: robô não é atendimento.
// ---------------------------------------------------------------------------

type Config = {
  ativo: boolean;
  inicio: string;          // "08:00:00"
  fim: string;             // "18:00:00"
  dias_semana: number[];   // 0=domingo … 6=sábado
  mensagem: string;
  intervalo_horas: number;
};

/** Estamos fora do horário de atendimento AGORA? Horário local de Belém (UTC-3). */
export function foraDoHorario(cfg: Config, agora = new Date()): boolean {
  // deslocamento fixo: o Brasil não tem mais horário de verão, então -3 basta e
  // evita depender de base de fusos no runtime da Vercel
  const local = new Date(agora.getTime() - 3 * 3600_000);
  const diaSemana = local.getUTCDay();
  if (!cfg.dias_semana.includes(diaSemana)) return true;

  const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
  const [hi, mi] = cfg.inicio.split(":").map(Number);
  const [hf, mf] = cfg.fim.split(":").map(Number);
  return minutos < hi * 60 + mi || minutos >= hf * 60 + mf;
}

/**
 * Envia o aviso de fora do horário, se for o caso. Chamada pelo webhook depois
 * de gravar a mensagem recebida. Devolve true se enviou.
 */
export async function avisarForaDeHorario(
  sb: SupabaseClient, clienteId: string, telefone: string | null,
): Promise<boolean> {
  try {
    const { data: cfg } = await sb
      .from("chat_horario_atendimento")
      .select("ativo,inicio,fim,dias_semana,mensagem,intervalo_horas")
      .eq("id", 1)
      .maybeSingle();
    if (!cfg?.ativo) return false;
    if (!foraDoHorario(cfg as Config)) return false;

    const destino = String(telefone ?? clienteId.replace(/^wa:/, "")).replace(/\D/g, "");
    if (!destino) return false;

    // já avisamos esta cliente há pouco? (não repete a cada mensagem da rajada)
    const desde = new Date(Date.now() - (cfg.intervalo_horas ?? 12) * 3600_000).toISOString();
    const { count } = await sb
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("tipo", "auto")
      .gte("criada_em", desde);
    if ((count ?? 0) > 0) return false;

    const { wamid } = await sendText(destino, cfg.mensagem);

    await sb.from("mensagens").upsert({
      id: wamid,
      cliente_id: clienteId,
      enviada_por: "operator",
      tipo: "auto",                    // fora do indicador de tempo de resposta
      conteudo: cfg.mensagem,
      status: "wait",
      criada_em: new Date().toISOString(),
      linha_id: linhaDeEnvio(),
    }, { onConflict: "id" });

    return true;
  } catch (e: any) {
    // nunca derruba o webhook: a mensagem da cliente já foi gravada e é o que importa
    console.error("[fora-de-horario] não avisei:", e?.message ?? e);
    return false;
  }
}
