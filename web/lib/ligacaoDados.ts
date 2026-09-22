// ---------------------------------------------------------------------------
// O QUE UMA LIGAÇÃO É — tipos, estados vivos, desfechos e formatação.
//
// Separado de `lib/ligacaoChat.ts` (que é COMO ela é conduzida: microfone,
// WebRTC, sinalização, campainha) por uma razão de peso, não de arrumação: o
// marco da ligação aparece DENTRO da thread, que é código da primeira pintura.
// Se ele importasse o hook, o `RTCPeerConnection` e o `getUserMedia` viriam
// junto no mesmo pedaço de JS — e quem só lê conversas baixaria a máquina de
// telefonia inteira para desenhar uma pílula de "chamada recebida · 0:42".
//
// Aqui não há React, não há `window`, não há import nenhum. É o que permite
// que as duas telas do chat e o servidor leiam a mesma definição.
// ---------------------------------------------------------------------------

export type Ligacao = {
  id: number; canal: "whatsapp"; direcao: "saida" | "entrada";
  status: string; call_id: string | null; carteira: string | null; por: string | null;
  telefone?: string | null;
  iniciada_em: string; atendida_em: string | null; encerrada_em: string | null;
  duracao_seg: number | null; motivo: string | null; observacao: string | null;
  cliente_id?: string;
};

export type Chamada = Ligacao & { cliente_id: string; cliente_nome?: string };

export const VIVOS = ["discando", "tocando", "em_curso"];
export const ligacaoViva = (l: Ligacao | null | undefined) => !!l && VIVOS.includes(l.status);

// Desfecho da ligação — a nossa tabulação por voz. Espelha os motivos de
// encerramento da conversa (§18 item 4) porque a pergunta é a mesma: no que deu?
export const DESFECHOS: { v: string; rotulo: string }[] = [
  { v: "venda_realizada", rotulo: "✅ Venda realizada" },
  { v: "follow_up", rotulo: "🕗 Follow-up agendado" },
  { v: "sem_interesse", rotulo: "🚫 Sem interesse" },
  { v: "nao_atendeu", rotulo: "📵 Não atendeu" },
  { v: "caixa_postal", rotulo: "📼 Caixa postal" },
  { v: "outro", rotulo: "• Outro" },
];

export const duracaoBR = (seg: number | null | undefined) => {
  if (seg == null) return null;
  const m = Math.floor(seg / 60), s = seg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const horaBR = (iso: string) =>
  new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16);
